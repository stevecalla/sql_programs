'use strict';
// CLI over the read + AI engine. Needs SF creds + an AI API key in .env.
// Non-interactive: queues | statuses | emails <queueId> [status] | thread <caseId>
//                  draft <caseId> [provider] | ask <caseId> "q" [provider]
// Interactive (no IDs needed): assist
const path = require('path');
const readline = require('readline');

(function load_env() {
  const fs = require('fs');
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../../../.env'), 'utf8');
    raw.split(/\r?\n/).forEach(function (l) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (!m) return;
      let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    });
  } catch (e) { /* ignore */ }
})();

const sf = require('../sf');
const ai = require('../ai');
const faq = require('../ai/faq');
const corrections = require('../store/corrections');

// ── colors ──
const R = '\x1b[0m', B = '\x1b[1m';
const GRN = '\x1b[32m', YEL = '\x1b[33m', CYN = '\x1b[36m', GRY = '\x1b[90m', BLU = '\x1b[34m', MAG = '\x1b[35m';
function col(c, s) { return c + s + R; }
function key(c, s) { return B + c + s + R; }  // bold + color for hotkeys
function status_color(s) {
  s = String(s || '').toLowerCase();
  if (s.indexOf('clos') >= 0) return GRY;
  if (s.indexOf('wait') >= 0) return YEL;
  if (s.indexOf('new') >= 0) return CYN;
  return '';
}

function ask(rl, q) { return new Promise(function (res) { rl.question(q, res); }); }
function clean(s) { return String(s || '').trim().replace(/^["']|["']$/g, ''); }

async function get_conn() {
  const cfg = sf.sf_config({ is_test: false });
  const ck = sf.check_sf_config(cfg);
  if (!ck.ok) throw new Error('Salesforce not configured: ' + ck.missing.join(', '));
  return sf.make_connection(cfg);
}

async function case_status_values(conn) {
  const meta = await conn.sobject('Case').describe();
  const f = (meta.fields || []).filter(function (x) { return x.name === 'Status'; })[0];
  return ((f && f.picklistValues) || []).filter(function (v) { return v.active; }).map(function (v) { return { value: v.value, default: !!v.defaultValue }; });
}

function print_thread_compact(t) {
  t.forEach(function (m, i) {
    const tag = m.incoming ? col(CYN, 'IN  ') : (m.automated ? col(GRY, 'AUTO') : col(GRN, 'OUT '));
    console.log('  ' + col(B, '[' + (i + 1) + ']') + ' ' + tag + ' ' + (m.message_date_mtn || '') + (m.has_attachment ? col(CYN, '  [attach]') : ''));
    const body = String(m.text_new || '').replace(/\s+/g, ' ').trim();
    if (body) console.log(col(GRY, '      ' + body.slice(0, 200) + (body.length > 200 ? ' ...' : '')));
  });
}

function print_verdict(r) {
  const vcol = r.verdict === 'draft' ? GRN : YEL;
  console.log('\n' + col(B, col(vcol, 'VERDICT: ' + r.verdict.toUpperCase())) + col(GRY, '   (sender ' + r.sender_email + ', ' + r.messages + ' msgs)'));
  console.log(col(GRY, '---'));
  console.log(r.body);
}

async function assist() {
  const c = await get_conn();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const provider_in = clean(await ask(rl, col(B, 'AI provider [openai]/anthropic: ')));
    const provider = provider_in || 'openai';
    console.log(col(GRY, '  -> using ' + provider + (provider_in ? '' : ' (default)')));
    const queues = await sf.list_queues(c, { with_open_counts: true });
    if (!queues.length) { console.log('No queues visible to this user.'); return; }
    const status_values = await case_status_values(c).catch(function () { return []; });

    for (;;) {
      console.log(col(B, '\nQUEUES:'));
      queues.forEach(function (q, i) { console.log('  ' + col(B, '[' + (i + 1) + ']') + ' ' + q.name + col(GRY, '  (' + (q.open_count != null ? q.open_count : '?') + ' open)')); });
      const qa = clean(await ask(rl, 'Pick a queue # (q to quit): ')).toLowerCase();
      if (qa === 'q') break;
      const q = queues[Number(qa) - 1];
      if (!q) { console.log('  (no such number)'); continue; }
      console.log(col(CYN, '  -> queue: ' + q.name));

      const counts = await sf.status_counts(c, q.id).catch(function () { return { by_status: {}, total: 0 }; });
      const st_opts = [{ label: 'Open only', value: 'open', n: (q.open_count != null ? q.open_count : null) }, { label: 'All statuses', value: 'all', n: counts.total }]
        .concat(status_values.map(function (v) { return { label: v.value + (v.default ? ' (default)' : ''), value: v.value, n: counts.by_status[v.value] || 0 }; }));
      console.log(col(B, 'Filter by status:'));
      st_opts.forEach(function (o, i) { const cnt = (o.n != null ? col(GRY, '  (' + o.n + ')') : ''); console.log('  ' + col(B, '[' + (i + 1) + ']') + ' ' + col(status_color(o.value), o.label) + cnt); });
      const sc = clean(await ask(rl, 'Pick a status # [Enter = Open only]: '));
      const chosen = st_opts[Number(sc) - 1] || st_opts[0];
      let status = chosen.value;
      let status_label = chosen.label;
      let cases = await sf.list_queue_cases(c, { queue_id: q.id, status: status, limit: 15 });
      if (!cases.length && status === 'open') { status_label = 'recent'; cases = await sf.list_queue_cases(c, { queue_id: q.id, status: 'all', limit: 15 }); }
      if (!cases.length) { console.log('No cases in ' + q.name + '.'); continue; }
      const att = await sf.cases_with_attachments(c, cases.map(function (x) { return x.case_id; }));
      const mc = await sf.message_counts(c, cases.map(function (x) { return x.case_id; }));

      for (;;) {
        console.log(col(B, '\n' + q.name + ' - ' + status_label + ' cases') + col(GRY, '   (') + col(CYN, '[A]') + col(GRY, '=attachment, ') + col(GRY, 'Nm=messages)'));
        cases.forEach(function (cs, i) {
          const flag = att[cs.case_id] ? col(CYN, '[A]') : '   ';
          const nmsg = col(GRY, (String((mc[cs.case_id] || 0)) + 'm').padStart(3));
          const st = col(status_color(cs.status), String(cs.status || '').padEnd(20));
          console.log('  ' + col(B, '[' + (i + 1) + ']') + ' ' + flag + ' ' + nmsg + ' ' + col(GRY, String(cs.modified_mtn || '').padEnd(22)) + ' ' + st + ' ' + String(cs.subject || '(no subject)').slice(0, 52));
        });
        const ca = clean(await ask(rl, 'Pick a case # (b=back, q=quit): ')).toLowerCase();
        if (ca === 'q') return;
        if (ca === 'b') break;
        const cs = cases[Number(ca) - 1];
        if (!cs) { console.log('  (no such number)'); continue; }
        console.log(col(CYN, '  -> case: ' + cs.case_number + ' - ' + String(cs.subject || '').slice(0, 60)));

        console.log(col(B, '\nThread for case ' + cs.case_number) + col(GRY, ' (' + cs.case_id + '):'));
        const thread = await sf.get_thread(c, cs.case_id);
        console.log(col(GRY, '  (' + thread.length + ' message(s))'));
        if (!thread.length) {
          try {
            const dbg = await sf.run_soql(c, "SELECT COUNT(Id) cnt FROM EmailMessage WHERE ParentId = '" + cs.case_id + "'");
            const n = (dbg[0] && (dbg[0].cnt != null ? dbg[0].cnt : dbg[0].expr0)) || 0;
            console.log(col(GRY, '  diagnostic: EmailMessage count = ' + n + (n > 0 ? '  (exist but not returned - report this)' : '  (no email on this case - try another)')));
          } catch (e) { console.log(col(GRY, '  diagnostic failed: ' + ((e && e.message) || e))); }
        }
        print_thread_compact(thread);

        for (;;) {
          const bar = '\n' + col(GRY, '--- actions ' + '-'.repeat(40)) + '\n  '
            + key(GRN, '[d]') + 'raft reply    '
            + key(CYN, '[a]') + 'sk a question    '
            + key(BLU, '[t]') + ' full thread    '
            + key(MAG, '[c]') + 'orrection    '
            + key(YEL, '[b]') + 'ack    '
            + key(GRY, '[q]') + 'uit\n> ';
          const act = clean(await ask(rl, bar)).toLowerCase();
          if (act === 'q') return;
          if (act === 'b') break;
          if (act === 'c') {
            const note = clean(await ask(rl, 'Correction / guidance to remember: ')); if (!note) continue;
            const scope = (clean(await ask(rl, 'Scope [global]/me: ')).toLowerCase() === 'me') ? 'me' : 'global';
            corrections.add({ note: note, scope: scope, queue: q.name, case_id: cs.case_id });
            console.log(col(GRN, 'Saved. It will ground future drafts and answers.'));
            continue;
          }
          if (act === 't') {
            if (!thread.length) { console.log('(no messages to show for this case)'); continue; }
            thread.forEach(function (m, i) {
              // Each message gets a role color: customer=cyan, agent=green, auto-reply=gray.
              const rc = m.incoming ? CYN : (m.automated ? GRY : GRN);
              const who = m.incoming ? 'CUSTOMER' : (m.automated ? 'AUTO-REPLY' : 'AGENT');
              const head = '== [' + (i + 1) + '/' + thread.length + '] ' + who + ' == ' + (m.message_date_mtn || '') + (m.from_address ? '  <' + m.from_address + '>' : '');
              console.log('\n' + key(rc, head));
              // Colored left gutter groups every line of this message together.
              String(m.text_raw || m.text_new || '(empty body)').split('\n').forEach(function (ln) { console.log(col(rc, '| ') + ln); });
              if (m.attachments && m.attachments.length) {
                console.log(col(rc, '| ') + col(GRY, '[attachments: ' + m.attachments.map(function (a) { return a.title + '.' + a.file_extension; }).join(', ') + ']'));
              }
            });
            console.log(col(GRY, '\n(legend: ') + col(CYN, 'customer') + col(GRY, ' / ') + col(GRN, 'agent') + col(GRY, ' / ') + col(GRY, 'auto-reply') + col(GRY, ')'));
            continue;
          }
          if (act === 'd') {
            console.log(col(GRY, '\n...thinking (' + provider + ')...'));
            try { print_verdict(await ai.respond_to_case({ conn: c, case_id: cs.case_id, provider: provider, fetch_attachments: true, faq: await faq.load_knowledge(q.name), corrections: corrections.grounding_lines(12) })); }
            catch (e) { console.log(col(YEL, 'AI error: ' + ((e && e.message) || e))); }
            continue;
          }
          if (act === 'a') {
            const qq = clean(await ask(rl, 'Your question: ')); if (!qq) continue;
            console.log(col(GRY, '\n...thinking (' + provider + ')...'));
            try { const r = await ai.ask_about_case({ conn: c, case_id: cs.case_id, question: qq, provider: provider, faq: await faq.load_knowledge(q.name), corrections: corrections.grounding_lines(12) }); console.log('\n' + r.answer); }
            catch (e) { console.log(col(YEL, 'AI error: ' + ((e && e.message) || e))); }
            continue;
          }
        }
      }
    }
  } finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'assist') { await assist(); return; }
  if (!cmd) { console.log('commands: assist | queues | statuses | corrections | context | emails <queueId> [status] | thread <caseId> | draft <caseId> [provider] | ask <caseId> "q" [provider]'); return; }
  const c = await get_conn();
  if (cmd === 'queues') {
    const qs = await sf.list_queues(c, { with_open_counts: true });
    qs.forEach(function (q) { console.log((q.open_count != null ? String(q.open_count).padStart(4) : '   ?') + '  ' + q.id + '  ' + q.name); });
  } else if (cmd === 'statuses') {
    const vals = await case_status_values(c);
    console.log(col(B, 'Case Status picklist values (this org):'));
    vals.forEach(function (v) { console.log('  - ' + v.value + (v.default ? col(GRY, '  (default)') : '')); });
  } else if (cmd === 'emails') {
    const rows = await sf.list_queue_cases(c, { queue_id: args[1], status: args[2] || 'open', limit: 25 });
    rows.forEach(function (r) { console.log(r.case_id + '  ' + (r.status || '').padEnd(20) + '  ' + (r.modified_mtn || '') + '  ' + r.subject); });
  } else if (cmd === 'thread') {
    print_thread_compact(await sf.get_thread(c, args[1]));
  } else if (cmd === 'draft') {
    print_verdict(await ai.respond_to_case({ conn: c, case_id: args[1], provider: args[2], fetch_attachments: true }));
  } else if (cmd === 'ask') {
    const r = await ai.ask_about_case({ conn: c, case_id: args[1], question: args[2], provider: args[3] });
    console.log(r.answer);
  } else if (cmd === 'context') {
    const files = await faq.load_context_files(args[1] || '');
    const cdir = await faq.context_dir();
    console.log(col(B, 'Context files for ' + (args[1] || '(global only)') + ':'));
    if (!files.length) console.log(col(GRY, '  (none) - drop files in ' + cdir + '/_global or /<queue_slug>'));
    files.forEach(function (x) { console.log('  - ' + x.name + col(GRY, '  (' + x.text.length + ' chars)')); });
  } else if (cmd === 'corrections') {
    const rows = corrections.list(false);
    if (!rows.length) { console.log('(no corrections yet)'); }
    rows.forEach(function (r) { console.log((r.active ? col(GRN, '[on] ') : col(GRY, '[off]')) + ' ' + col(GRY, r.created_at) + '  ' + r.note + (r.queue ? col(GRY, '  (' + r.queue + ')') : '')); });
  } else { console.log('unknown command: ' + cmd); }
}

main().catch(function (e) { console.error('ERROR: ' + ((e && e.message) || e)); process.exit(1); });

'use strict';
// verify_sf_access.js — READ-ONLY Salesforce access check for the email-queue POC.
// Confirms the integration user can read EmailMessage bodies/headers, can see the
// Coaching queue's cases, how often Cases resolve a Contact, the 3-month volume,
// and pulls ONE sample thread (bodies are NEVER printed — only lengths/booleans;
// email addresses are masked). No DML, no writes.
//
// Usage:  node verify_sf_access.js [prod|sandbox]   (default: prod)
//
// Reuses race_results_transform/sf so we exercise the SAME code path the app will.

const fs = require('fs');
const path = require('path');

// --- tiny .env loader (repo root), no dependency on the dotenv package ---------
(function load_env() {
  const env_path = path.join(__dirname, '../../.env');
  try {
    const raw = fs.readFileSync(env_path, 'utf8');
    raw.split(/\r?\n/).forEach(function (line) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    });
  } catch (e) { console.error('Could not read .env at ' + env_path + ': ' + e.message); }
})();

const sf = require('../race_results_transform/sf');

const QUEUE = 'cfg_Coaching';        // DeveloperName; we also match display Name 'Coaching'
const QUEUE_DISPLAY = 'Coaching';

function mask_email(s) {
  s = String(s || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '***' : '';
  const user = s.slice(0, at), dom = s.slice(at + 1);
  const u = user.slice(0, 2) + '***';
  const d = dom.replace(/^[^.]+/, function (x) { return x.slice(0, 1) + '***'; });
  return u + '@' + d;
}
function soql_str(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function line() { console.log('-'.repeat(72)); }

// Crude HTML -> text for previews (TextBody preferred; HtmlBody only as fallback).
function strip_html(h) {
  return String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
}
function preview_text(m, n) {
  if (!m) return '(no message body)';
  let t = m.TextBody && String(m.TextBody).trim();
  if (!t && m.HtmlBody) t = strip_html(m.HtmlBody);
  t = (t || '').replace(/\s+/g, ' ').trim();
  const max = n || 200;
  return t ? (t.slice(0, max) + (t.length > max ? ' …' : '')) : '(empty body)';
}

async function count(conn, soql) {
  // COUNT(Id) aliased so we can read it off the returned record.
  const rows = await sf.run_soql(conn, soql);
  const r = (rows && rows[0]) || {};
  return Number(r.cnt != null ? r.cnt : (r.expr0 != null ? r.expr0 : 0));
}

async function main() {
  const arg = (process.argv[2] || 'prod').toLowerCase();
  const is_test = arg === 'sandbox' || arg === 'dev' || arg === 'test';

  console.log('');
  console.log('=== SF EMAIL-QUEUE ACCESS VERIFICATION (READ-ONLY) ===');
  console.log('Target org : ' + (is_test ? 'SANDBOX / DEV (SF_DEV_*)' : 'PRODUCTION (SF_PROD_*)'));
  console.log('Queue      : ' + QUEUE_DISPLAY + ' (' + QUEUE + ')');
  line();

  const cfg = sf.sf_config({ is_test: is_test });
  const check = sf.check_sf_config(cfg);
  if (!check.ok) { console.error('Missing config: ' + check.missing.join(', ')); process.exit(1); }

  let conn;
  try {
    conn = await sf.make_connection(cfg);
    console.log('[ok] logged in as ' + cfg.username + '  (API v' + cfg.api_version + ')');
  } catch (e) { console.error('[FAIL] login: ' + (e && e.message)); process.exit(1); }

  // 1) FLS / field visibility on EmailMessage --------------------------------
  line(); console.log('1) EmailMessage field visibility (describe = fields this user can read)');
  const want = ['TextBody', 'HtmlBody', 'Headers', 'Incoming', 'Status', 'MessageDate',
    'ParentId', 'FromAddress', 'FromName', 'ToAddress', 'CcAddress', 'BccAddress', 'HasAttachment'];
  try {
    const desc = await sf.describe_object(conn, 'EmailMessage');
    const have = new Set((desc.fields || []).map(function (f) { return f.name; }));
    want.forEach(function (f) { console.log('   ' + (have.has(f) ? '[visible] ' : '[MISSING] ') + f); });
  } catch (e) { console.log('   [FAIL] describe EmailMessage: ' + (e && e.message)); }

  // 2) Resolve the Coaching queue -------------------------------------------
  line(); console.log('2) Resolve Coaching queue (Group, Type=Queue)');
  let qid = '';
  try {
    const grp = await sf.run_soql(conn,
      "SELECT Id, Name, DeveloperName FROM Group WHERE Type='Queue' AND " +
      "(DeveloperName='" + soql_str(QUEUE) + "' OR Name='" + soql_str(QUEUE_DISPLAY) + "') LIMIT 1");
    if (grp && grp[0]) { qid = grp[0].Id; console.log('   [ok] ' + grp[0].Name + '  id=' + qid + '  dev=' + grp[0].DeveloperName); }
    else { console.log('   [FAIL] queue not found / not visible to this user'); }
  } catch (e) { console.log('   [FAIL] queue lookup: ' + (e && e.message)); }
  if (!qid) { console.log('\nCannot continue without a queue id.'); return; }

  // 3) Case counts + contact resolution rate --------------------------------
  line(); console.log('3) Cases owned by the queue + Contact resolution');
  try {
    const total = await count(conn, "SELECT COUNT(Id) cnt FROM Case WHERE OwnerId='" + qid + "'");
    const open = await count(conn, "SELECT COUNT(Id) cnt FROM Case WHERE OwnerId='" + qid + "' AND IsClosed=false");
    console.log('   cases total=' + total + '  open(IsClosed=false)=' + open);
    const recent = await sf.run_soql(conn,
      "SELECT Id, ContactId, SuppliedEmail, Origin FROM Case WHERE OwnerId='" + qid + "' ORDER BY CreatedDate DESC LIMIT 50");
    const n = recent.length;
    const withContact = recent.filter(function (c) { return !!c.ContactId; }).length;
    const withSupplied = recent.filter(function (c) { return !!c.SuppliedEmail; }).length;
    console.log('   recent sample n=' + n + '  ContactId populated=' + withContact +
      '  SuppliedEmail populated=' + withSupplied);
    const origins = {};
    recent.forEach(function (c) { const o = c.Origin || '(blank)'; origins[o] = (origins[o] || 0) + 1; });
    console.log('   case origins: ' + JSON.stringify(origins));
  } catch (e) { console.log('   [FAIL] case counts: ' + (e && e.message)); }

  // 4) 3-month EmailMessage volume ------------------------------------------
  line(); console.log('4) EmailMessage volume in this queue, last 3 months');
  try {
    const vol = await count(conn,
      "SELECT COUNT(Id) cnt FROM EmailMessage WHERE Parent.OwnerId='" + qid + "' AND MessageDate >= LAST_N_MONTHS:3");
    const inbound = await count(conn,
      "SELECT COUNT(Id) cnt FROM EmailMessage WHERE Parent.OwnerId='" + qid + "' AND MessageDate >= LAST_N_MONTHS:3 AND Incoming=true");
    console.log('   emails(3mo)=' + vol + '  inbound=' + inbound + '  outbound=' + (vol - inbound));
  } catch (e) { console.log('   [FAIL] volume (note: Parent.OwnerId traversal may be the issue): ' + (e && e.message)); }

  // 5) Sample ONE thread — lengths/booleans only, addresses masked ----------
  line(); console.log('5) Sample thread (bodies NOT printed — only lengths/flags; emails masked)');
  try {
    const newest = await sf.run_soql(conn,
      "SELECT ParentId FROM EmailMessage WHERE Parent.OwnerId='" + qid + "' AND ParentId != null ORDER BY MessageDate DESC LIMIT 1");
    const pid = newest && newest[0] && newest[0].ParentId;
    if (!pid) { console.log('   (no emails found for this queue)'); }
    else {
      const thread = await sf.run_soql(conn,
        "SELECT Id, Incoming, MessageDate, Status, Subject, FromAddress, ToAddress, TextBody, HtmlBody, HasAttachment " +
        "FROM EmailMessage WHERE ParentId='" + pid + "' ORDER BY MessageDate ASC");
      console.log('   case=' + pid + '  messages=' + thread.length);
      thread.forEach(function (m, i) {
        const tlen = m.TextBody ? String(m.TextBody).length : 0;
        const hlen = m.HtmlBody ? String(m.HtmlBody).length : 0;
        console.log('   [' + (i + 1) + '] ' + (m.Incoming ? 'IN ' : 'OUT') +
          ' ' + (m.MessageDate || '') +
          ' textLen=' + tlen + ' htmlLen=' + hlen +
          ' attach=' + (m.HasAttachment ? 'y' : 'n') +
          ' from=' + mask_email(m.FromAddress) +
          ' subjLen=' + (m.Subject ? String(m.Subject).length : 0));
      });
    }
  } catch (e) { console.log('   [FAIL] sample thread: ' + (e && e.message)); }

  // 6) Headers populated? (Headers is selectable but NOT filterable, so we
  //    select it from recent emails and check non-null in JS.)
  line(); console.log('6) Headers field populated?');
  try {
    const h = await sf.run_soql(conn,
      "SELECT Id, Headers FROM EmailMessage WHERE Parent.OwnerId='" + qid + "' ORDER BY MessageDate DESC LIMIT 10");
    const populated = (h || []).filter(function (m) { return m.Headers && String(m.Headers).trim(); }).length;
    console.log('   checked ' + (h ? h.length : 0) + ' recent emails; Headers populated on ' + populated +
      ' (optional — we order by MessageDate regardless)');
  } catch (e) { console.log('   [note] Headers check failed: ' + (e && e.message)); }

  // 7) Most recent 10 threads — date / status / subject / body excerpt /
  //    answered? / who responded.  (NOTE: prints a short excerpt of real body.)
  line(); console.log('7) Most recent 10 threads (preview + response info)');
  console.log('   NOTE: this prints a short excerpt of REAL email body text.');
  try {
    const cases = await sf.run_soql(conn,
      "SELECT Id, CaseNumber, Subject, Status, CreatedDate, LastModifiedDate " +
      "FROM Case WHERE OwnerId='" + qid + "' ORDER BY LastModifiedDate DESC LIMIT 10");
    if (!cases.length) { console.log('   (no cases found for this queue)'); }
    else {
      const in_ids = cases.map(function (c) { return "'" + soql_str(c.Id) + "'"; }).join(',');
      const msgs = await sf.run_soql(conn,
        "SELECT Id, ParentId, Incoming, MessageDate, Status, TextBody, HtmlBody, HasAttachment, " +
        "FromAddress, FromName, CreatedById, CreatedBy.Name " +
        "FROM EmailMessage WHERE ParentId IN (" + in_ids + ") ORDER BY MessageDate ASC");
      const by_case = new Map();
      (msgs || []).forEach(function (m) {
        if (!by_case.has(m.ParentId)) by_case.set(m.ParentId, []);
        by_case.get(m.ParentId).push(m);
      });

      // Resolve actual attachment files for messages flagged HasAttachment, using the
      // SAME ContentDocumentLink -> ContentVersion hop the app will use (sf_email.js).
      const att_by_email = new Map();   // EmailMessage Id -> [{ Id(Title,FileExtension,ContentSize) }]
      const att_msg_ids = (msgs || []).filter(function (m) { return m.HasAttachment; }).map(function (m) { return m.Id; });
      if (att_msg_ids.length) {
        try {
          const in_email = att_msg_ids.map(function (id) { return "'" + soql_str(id) + "'"; }).join(',');
          const links = await sf.run_soql(conn,
            "SELECT ContentDocumentId, LinkedEntityId FROM ContentDocumentLink WHERE LinkedEntityId IN (" + in_email + ")");
          const doc_to_email = new Map();
          const doc_ids = [];
          (links || []).forEach(function (l) {
            if (l.ContentDocumentId && !doc_to_email.has(l.ContentDocumentId)) {
              doc_to_email.set(l.ContentDocumentId, l.LinkedEntityId);
              doc_ids.push(l.ContentDocumentId);
            }
          });
          if (doc_ids.length) {
            const in_docs = doc_ids.map(function (id) { return "'" + soql_str(id) + "'"; }).join(',');
            const vers = await sf.run_soql(conn,
              "SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize FROM ContentVersion " +
              "WHERE IsLatest = true AND ContentDocumentId IN (" + in_docs + ")");
            (vers || []).forEach(function (v) {
              const email_id = doc_to_email.get(v.ContentDocumentId);
              if (!email_id) return;
              if (!att_by_email.has(email_id)) att_by_email.set(email_id, []);
              att_by_email.get(email_id).push(v);
            });
          }
        } catch (e) { console.log('   [note] attachment lookup failed: ' + (e && e.message)); }
      }

      cases.forEach(function (c, i) {
        const list = by_case.get(c.Id) || [];
        const inbound = list.filter(function (m) { return m.Incoming; });
        const outbound = list.filter(function (m) { return !m.Incoming; });
        const first_in = inbound[0] || list[0] || null;
        const last_out = outbound.length ? outbound[outbound.length - 1] : null;
        const when = c.LastModifiedDate ? sf.datetime_in_time_zone(c.LastModifiedDate, sf.DEFAULT_TZ) : '';
        let responder = '(none yet)';
        let auto_flag = '';
        if (last_out) {
          const who = (last_out.CreatedBy && last_out.CreatedBy.Name) || last_out.FromName || '';
          const addr = mask_email(last_out.FromAddress);
          const at = last_out.MessageDate ? sf.datetime_in_time_zone(last_out.MessageDate, sf.DEFAULT_TZ) : '';
          // CreatedBy 'Automated Process'/'System' => sent by a flow/auto-response rule, not a human.
          const is_auto = /automated|^\s*system\s*$/i.test(who);
          auto_flag = is_auto ? '  [AUTOMATED — not a human reply]' : '  [human agent]';
          responder = (who || addr || 'unknown') + (addr ? ' <' + addr + '>' : '') + (at ? '  @ ' + at : '');
        }
        console.log('');
        console.log('   [' + (i + 1) + '] ' + (c.CaseNumber || '') + '   ' + when + '   status=' + (c.Status || ''));
        console.log('       case id    : ' + c.Id + '   (EmailMessage.ParentId — paste into Workbench)');
        console.log('       subject    : ' + String(c.Subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 100));
        console.log('       thread     : ' + list.length + ' msg(s), ' + inbound.length + ' in / ' + outbound.length + ' out  -> ' +
          (outbound.length ? 'ANSWERED' : 'NOT answered yet'));
        // Attachments across the whole thread.
        const has_att = list.some(function (m) { return m.HasAttachment; });
        const case_atts = [];
        list.forEach(function (m) { (att_by_email.get(m.Id) || []).forEach(function (v) { case_atts.push(v); }); });
        console.log('       attachment : ' + (has_att ? (case_atts.length || '?') + ' file(s)' : 'none'));
        case_atts.forEach(function (v) {
          const ext = String(v.FileExtension || '').toLowerCase();
          console.log('          - ' + String(v.Title || '(untitled)') + (ext ? '.' + ext : '') +
            '  (' + (v.ContentSize || 0) + ' bytes)  ContentVersionId=' + v.Id);
          console.log('            GET /services/data/v' + cfg.api_version + '/sobjects/ContentVersion/' + v.Id + '/VersionData');
        });
        console.log('       from       : ' + mask_email(first_in && first_in.FromAddress));
        console.log('       question   : ' + preview_text(first_in, 220));
        console.log('       answered by: ' + responder + auto_flag);
        console.log('       response   : ' + (last_out ? preview_text(last_out, 220) : '(no response yet)'));
      });
    }
  } catch (e) { console.log('   [FAIL] recent threads: ' + (e && e.message)); }

  line(); console.log('Done. (read-only; nothing was written)');
}

main().catch(function (e) { console.error('UNCAUGHT: ' + (e && e.stack || e)); process.exit(1); });

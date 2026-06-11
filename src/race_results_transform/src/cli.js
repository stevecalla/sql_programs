#!/usr/bin/env node
/**
 * cli.js — scriptable race-results -> template converter.
 *
 * Usage:
 *   node cli.js convert <input.xlsx> [-o out] [--format csv|xlsx] [--profile file.json] [--quiet]
 *   node cli.js inspect <input.xlsx>          # show detected headers + auto-mapping, no write
 *   node cli.js batch   <folder> [-o outdir]  # convert every .xlsx in a folder
 *   node cli.js help
 *
 * Prints the same scorecard the web app shows. Exits non-zero when a required
 * column is missing (scorecard band = red) so it is safe in cron / pipelines.
 *
 * No processing happens on any server — this is the same engine the browser runs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const io = require('./io');
const pipe = require('./pipeline');
const mapping = require('./mapping');
const data_dir = require('./data_dir');
const metrics = require('../metrics/metrics_report');   // usage analytics (stats/size/cleanup)

// ---- tiny ANSI helpers (match menu.js house style) ------------------------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m'
};
const supports_color = process.stdout.isTTY;
function col(c, s) { return supports_color ? c + s + C.reset : s; }
function band_color(band) { return band === 'green' ? C.green : (band === 'amber' ? C.yellow : C.red); }

function status_icon(status) {
  return ({ complete: col(C.green, '✓ complete'),
            partial:  col(C.yellow, '~ partial'),
            review:   col(C.yellow, '! review'),
            missing:  col(C.red, '_ missing') })[status] || status;
}

function print_scorecard(report, label) {
  const sc = report.scorecard;
  console.log('');
  console.log(col(C.bold, label));
  console.log('  rows: ' + report.rows.in + ' in -> ' + report.rows.out + ' out'
              + (report.rows.skipped.length ? col(C.gray, '  (' + report.rows.skipped.length + ' divider/blank rows skipped)') : ''));
  const bc = band_color(sc.band);
  console.log('  score: ' + col(bc + C.bold, sc.pct + '%  ' + sc.band.toUpperCase()) + '  ' + col(C.dim, sc.verdict));
  console.log(col(C.bold, '  columns:'));
  sc.per_column.forEach(function (p) {
    const from = p.mapped_from ? col(C.gray, ' <- ' + p.mapped_from) : col(C.gray, ' <- (none)');
    const counts = col(C.gray, '  [' + p.filled + '/' + p.total + (p.flagged ? ', ' + p.flagged + ' flagged' : '') + ']');
    console.log('    ' + p.target.padEnd(16) + ' ' + status_icon(p.status) + from + counts);
  });
  // preservation
  const pres = report.preservation.filter(function (x) { return x.mapped; });
  const bad = pres.filter(function (x) { return !x.ok; });
  if (pres.length) {
    if (bad.length === 0) console.log('  ' + col(C.green, 'value check: Name/Email/Zip fully preserved'));
    else console.log('  ' + col(C.red, 'value check: ' + bad.map(function (b) { return b.target + ' missing ' + b.missing; }).join(', ')));
  }
}

function confirm(prompt) {
  return new Promise(function (resolve) {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, function (ans) { rl.close(); resolve(/^y(es)?$/i.test(String(ans).trim())); });
  });
}

function parse_args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') out.out = argv[++i];
    else if (a === '--profile') out.profile = argv[++i];
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--days') out.days = argv[++i];
    else if (a === '--provider') out.provider = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--n') out.n = argv[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--q') out.q = argv[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--date') out.date = argv[++i];
    else if (a === '--start') out.start = argv[++i];
    else if (a === '--end') out.end = argv[++i];
    else if (a === '--field') out.field = argv[++i];
    else if (a === '--limit') out.limit = argv[++i];
    else if (a === '--strategy') out.strategy = argv[++i];
    else if (a === '--format' || a === '--fmt') out.format = argv[++i];
    else if (a === '--today') out.today = true;
    else if (a === '--test') out.test = true;
    else out._.push(a);
  }
  return out;
}

function out_format(opts) { return String((opts && opts.format) || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx'; }

async function default_out_name(input, fmt) {
  // Generated files go to the data/outputs dir (usat/data/...), never the repo.
  const base = path.basename(input).replace(/\.(xlsx|xls|csv)$/i, '');
  const ext = String(fmt).toLowerCase() === 'csv' ? '.csv' : '.xlsx';
  return path.join(await data_dir.outputs(), base + ' - formatted' + ext);
}

async function convert_one(input, out_path, opts) {
  const irs = await io.read_file_to_irs(input);   // every worksheet (CSV -> one)
  let mapping_override_text = null, value_overrides = null;
  if (opts.profile && fs.existsSync(opts.profile)) {
    const prof = JSON.parse(fs.readFileSync(opts.profile, 'utf8'));
    mapping_override_text = prof.mapping || null;
    value_overrides = prof.value_overrides || null;
  }
  const results = irs.map(function (ir) {
    return { ir: ir, res: pipe.convert(ir, { mapping_override_text: mapping_override_text, value_overrides: value_overrides }) };
  });
  const sheets = results.map(function (r) { return { name: r.ir.sheet_name, headers: r.res.result.headers, rows: r.res.result.rows }; });
  const fmt = out_format(opts);
  const outputs = [];
  if (fmt === 'csv') {
    // CSV can't hold multiple tabs: a multi-sheet workbook writes one .csv per sheet.
    const dir = path.dirname(out_path), base = path.basename(out_path).replace(/\.(xlsx|csv)$/i, '');
    if (sheets.length === 1) {
      const p = path.join(dir, base + '.csv');
      fs.writeFileSync(p, io.grid_to_csv(sheets[0].headers, sheets[0].rows)); outputs.push(p);
    } else {
      sheets.forEach(function (sh) {
        const safe = String(sh.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'sheet';
        const p = path.join(dir, base + ' - ' + safe + '.csv');
        fs.writeFileSync(p, io.grid_to_csv(sh.headers, sh.rows)); outputs.push(p);
      });
    }
  } else {
    const buf = await io.grids_to_buffer(sheets);
    fs.writeFileSync(out_path, Buffer.from(buf)); outputs.push(out_path);
  }
  if (!opts.quiet) {
    const suffix = results.length > 1 ? '  (' + results.length + ' sheets)' : '';
    results.forEach(function (r) { print_scorecard(r.res.report, path.basename(input) + ' [' + r.ir.sheet_name + ']  ->  ' + path.basename(outputs[0]) + suffix); });
  }
  return { report: results[0].res.report, outputs: outputs };
}

function print_inspect(input) {
  return io.read_file_to_ir(input).then(function (ir) {
    const res = pipe.convert(ir, {});
    console.log(col(C.bold, '\nDetected headers (' + res.parsed.headers.length + '):'));
    res.parsed.headers.forEach(function (h, i) { console.log('  [' + i + '] ' + h); });
    console.log(col(C.bold, '\nAuto-mapping:'));
    res.result.schema.forEach(function (cdef) {
      const m = res.mapping[cdef.key];
      console.log('  ' + cdef.target.padEnd(16) + ' <- ' + (m.source || col(C.gray, '(none)'))
                  + col(C.gray, '  [' + m.confidence + (m.score ? ' ' + m.score : '') + ']'));
    });
    const drops = res.report.ledger.filter(function (l) { return l.disposition !== 'mapped'; });
    if (drops.length) {
      console.log(col(C.bold, '\nDropped source columns:'));
      drops.forEach(function (d) { console.log('  ' + col(C.gray, d.disposition) + '  ' + d.header); });
    }
  });
}

function help() {
  console.log([
    '',
    col(C.bold, 'race_results_transform — CLI'),
    '',
    '  node cli.js convert <input.xlsx> [-o out] [--format csv|xlsx] [--profile p.json] [--quiet]',
    '  node cli.js inspect <input.xlsx>',
    '  node cli.js batch   <folder> [-o outdir] [--format csv|xlsx]',
    '                                              # --format defaults to xlsx; csv writes one .csv per sheet',
    '  node cli.js stats          [--days 7]      # usage analytics summary',
    '  node cli.js ask "<question>" [--provider openai|claude] [--model <id>]  # AI: ask the usage data (read-only)',
    '  node cli.js ask:models                       # list selectable AI models',
    '  node cli.js ask:log [--n 20]                 # recent AI questions + answers (audit)',
    '  node cli.js ask:sql "<SELECT ...>"           # run read-only SQL directly (guarded, no AI)',
    '  node cli.js ask:corrections [--n 20] [--all]   # list operator clarifications used as grounding',
    '  node cli.js ask:uncorrect <id>              # deactivate a correction so it stops being applied',
    '  node cli.js ask:correct "<note>" [--q "<question>"]  # add an operator correction (grounding)',
    '  node cli.js ask:test:corrections            # guided steps to verify a correction is applied (G2)',
    '  node cli.js ask:test:threads                # guided steps to verify follow-up threads (B1)',
    '  node cli.js ask:eval [--provider --model]   # run review scenarios vs the live model; records a report',
    '  node cli.js sf:list [--today|--date YYYY-MM-DD|--start A --end B] [--field LastModifiedDate|CreatedDate] [--limit N] [--test]',
    '                                              # list Race Results Doc files in Salesforce (Mountain Time)',
    '  node cli.js sf:pull <sf:list opts> [-o <dir>] [--strategy add_new|replace|wipe_all]',
    '                                              # download those files (snake_case names) into a folder',
    '  node cli.js sf:describe <Object> [--field <substr>] [--test]   # list an sObject’s fields (confirm API names)',
    '  node cli.js sf:soql "<SELECT ...>" [--limit N] [--test]        # run a read-only SOQL SELECT (discovery)',
    '  node cli.js metrics:size                   # events table size + rows/year',
    '  node cli.js metrics:cleanup [--yes]        # purge years beyond current+prior',
    '  node cli.js metrics:purge-test [--yes]     # delete only test rows (is_test=1) — keeps real + demo data',
    '  node cli.js metrics:purge-all [--yes]      # delete ALL rows (confirm) — clears test data',
    '  node cli.js help',
    ''
  ].join('\n'));
}

async function main() {
  const args = parse_args(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (!cmd || cmd === 'help') { help(); return; }
    if (cmd === 'inspect') {
      if (!args._[1]) { help(); process.exit(2); }
      await print_inspect(args._[1]);
      return;
    }
    if (cmd === 'convert') {
      const input = args._[1];
      if (!input) { help(); process.exit(2); }
      const out = args.out || await default_out_name(input, out_format(args));
      const conv = await convert_one(input, out, args);
      console.log('\nSaved: ' + conv.outputs.join('\n       '));
      process.exit(conv.report.scorecard.band === 'red' ? 1 : 0);
    }
    if (cmd === 'batch') {
      const dir = args._[1];
      if (!dir) { help(); process.exit(2); }
      const outdir = args.out || await data_dir.outputs();
      if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
      const files = fs.readdirSync(dir).filter(function (f) { return /\.(xlsx|xls|csv)$/i.test(f) && !/ - formatted\./i.test(f); });
      const ext = out_format(args) === 'csv' ? '.csv' : '.xlsx';
      let worst = 0, skipped = 0;
      for (const f of files) {
        const out = path.join(outdir, f.replace(/\.(xlsx|xls|csv)$/i, '') + ' - formatted' + ext);
        try {
          const conv = await convert_one(path.join(dir, f), out, args);
          if (conv.report.scorecard.band === 'red') worst = 1;
        } catch (e) {
          // e.g. a legacy .xls without SheetJS — skip and keep going instead of aborting the batch
          console.error(col(C.red, '  skipped ' + f + ': ' + e.message));
          skipped++; worst = 1;
        }
      }
      console.log('\nProcessed ' + (files.length - skipped) + ' file(s)' + (skipped ? ' (' + skipped + ' skipped)' : '') + ' into ' + outdir);
      process.exit(worst);
    }
    if (cmd === 'ask:models') {
      const models = require('../metrics/ask/models').list();
      console.log('\nAvailable models (edit metrics/ask/models.js to add):');
      models.forEach(function (m, i) { console.log('  ' + (i + 1) + ') ' + m.label + '  \u00b7  ' + m.provider + ' \u00b7 ' + m.model); });
      console.log('\nUse: node src/cli.js ask "<q>" --provider ' + models[0].provider + ' --model ' + models[0].model);
      process.exit(0);
    }
    if (cmd === 'ask:log') {
      const ask_log = require('../metrics/ask/ask_log');
      const pool = await metrics.get_pool();
      try {
        const rows = await ask_log.read(pool, args.n ? Number(args.n) : 20);
        if (!rows.length) { console.log('No ask history in ' + ask_log.TABLE + '.'); }
        else rows.forEach(function (r) {
          console.log('');
          console.log(col(C.gray, String(r.created_at_mtn || '')) + '  ' + col(C.bold, '[' + (r.surface || '') + ' \u00b7 ' + (r.provider || '?') + (r.model ? ' \u00b7 ' + r.model : '') + ']') + (r.thread_id ? col(C.gray, '  thread:' + String(r.thread_id).slice(0, 8)) : '') + (r.asker_id ? col(C.gray, ' asker:' + String(r.asker_id).slice(0, 8)) : '') + (r.ok === 0 ? col(C.red, '  (no answer)') : ''));
          console.log(col(C.cyan, 'Q: ') + r.question);
          console.log(col(C.green, 'A: ') + String(r.answer || '').split('\n')[0].slice(0, 160));
        });
      } finally { await pool.end(); }
      process.exit(0);
    }
    if (cmd === 'ask:correct') {
      const note = args._.slice(1).join(' ').trim();
      if (!note) { console.log('Usage: node src/cli.js ask:correct "<note>" [--q "<question>"]'); process.exit(2); }
      const corr = require('../metrics/ask/corrections');
      const pool = await metrics.get_pool();
      try { const id = await corr.append(pool, { note: note, question: args.q || null, author: 'cli' }); console.log(col(C.green, 'Saved correction #' + (id || '?') + ' — it will apply on the next ask.')); }
      finally { await pool.end(); }
      process.exit(0);
    }
    if (cmd === 'ask:test:corrections' || cmd === 'ask:test:threads') {
      const guide = require('../metrics/ask/test_guide');
      console.log(guide.format_guide(cmd === 'ask:test:corrections' ? guide.CORRECTIONS_GUIDE : guide.THREADS_GUIDE));
      process.exit(0);
    }
    if (cmd === 'ask:eval') {
      const { run_eval } = require('../metrics/ask/eval/run_eval');
      const out = await run_eval({ provider: args.provider, model: args.model });
      if (out.skipped) { console.log(col(C.yellow, 'Eval skipped: ' + out.reason + ' (set OPENAI_API_KEY / ANTHROPIC_API_KEY and ensure the DB is reachable).')); process.exit(0); }
      console.log('');
      console.log(col(C.bold, 'AI ask eval — ' + out.passed + ' / ' + out.total + ' passed') + col(C.gray, '  [' + out.provider + (out.model ? ' \u00b7 ' + out.model : '') + ']'));
      out.results.forEach(function (r) { console.log((r.ok ? col(C.green, '  \u2713 ') : col(C.red, '  \u2717 ')) + r.id + col(C.gray, '  (' + r.kind + ')')); });
      if (out.report_path) console.log(col(C.gray, '\n  recorded: ' + out.report_path));
      try { await require('../metrics/ask/db').close_pool(); } catch (e) {}
      process.exit(out.passed === out.total ? 0 : 1);
    }
    if (cmd === 'ask:corrections') {
      const corr = require('../metrics/ask/corrections');
      const pool = await metrics.get_pool();
      try {
        const rows = await corr.read(pool, args.n ? Number(args.n) : 20, !args.all);
        if (!rows.length) { console.log('No corrections in ' + corr.TABLE + '.'); }
        else rows.forEach(function (r) {
          console.log('');
          console.log(col(C.gray, String(r.created_at_mtn || '')) + '  ' + col(C.bold, '#' + r.id) + (r.active ? '' : col(C.gray, ' (inactive)')) + (r.author ? col(C.gray, '  by ' + r.author) : ''));
          if (r.question) console.log(col(C.cyan, 'Q: ') + String(r.question).slice(0, 160));
          console.log(col(C.green, 'Note: ') + String(r.note || ''));
        });
      } finally { await pool.end(); }
      process.exit(0);
    }
    if (cmd === 'ask:uncorrect') {
      const id = args._.slice(1)[0];
      if (!id) { console.log('Usage: node src/cli.js ask:uncorrect <id>'); process.exit(2); }
      const corr = require('../metrics/ask/corrections');
      const pool = await metrics.get_pool();
      try { await corr.set_active(pool, id, false); console.log('Deactivated correction #' + id + ' (no longer applied as grounding).'); }
      finally { await pool.end(); }
      process.exit(0);
    }
    if (cmd === 'ask') {
      const question = args._.slice(1).join(' ').trim();
      if (!question) { console.log('Usage: node src/cli.js ask "<question>" [--provider openai|claude] [--model <id>]'); process.exit(2); }
      const { ask } = require('../metrics/ask/ask');
      const ask_db = require('../metrics/ask/db');
      let live = null, corrections = null;
      try {
        const mpool = await metrics.get_pool();
        live = await require('../metrics/ask/live').live_snapshot(mpool, { days: 30 });            // G1
        corrections = await require('../metrics/ask/corrections').grounding_text(mpool, 12);       // G2
      } catch (e) { /* grounding is optional */ }
      try {
        const r = await ask(question, { provider: args.provider, model: args.model, live: live, corrections: corrections });
        console.log('');
        console.log(col(C.bold, 'Q: ' + question) + col(C.gray, '   [' + r.provider + (r.model ? ' \u00b7 ' + r.model : '') + ']'));
        console.log(col(C.cyan, '\nA: ') + (r.answer || '(no answer)'));
        if (r.sql) console.log('\n' + col(C.gray, 'SQL: ' + r.sql));
        if (r.truncated) console.log(col(C.yellow, 'note: results truncated to ' + r.rows.length + ' rows'));
        try { await require('../metrics/ask/ask_log').append(await metrics.get_pool(), { surface: 'cli', question: question, provider: r.provider, model: r.model, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: r.answer }); } catch (e) {}
      } finally { try { await ask_db.close_pool(); } catch (e) {} }
      process.exit(0);
    }
    if (cmd === 'ask:sql') {
      const sql = args._.slice(1).join(' ').trim();
      if (!sql) { console.log('Usage: node src/cli.js ask:sql "<SELECT ...>"  # run read-only SQL directly (guarded)'); process.exit(2); }
      const ask_mod = require('../metrics/ask/ask');
      const ask_db = require('../metrics/ask/db');
      try {
        const r = await ask_mod.ask_sql(sql);
        console.log('');
        console.log(col(C.gray, 'SQL: ' + r.sql));
        const rows = r.rows || [];
        if (!rows.length) { console.log(col(C.yellow, '(no rows)')); }
        else {
          const cols = Object.keys(rows[0]);
          console.log(col(C.bold, cols.join('\t')));
          rows.slice(0, 50).forEach(function (row) { console.log(cols.map(function (k) { return row[k] == null ? '' : String(row[k]); }).join('\t')); });
          if (r.truncated || rows.length > 50) console.log(col(C.yellow, 'showing ' + Math.min(rows.length, 50) + ' of ' + r.row_count + (r.truncated ? '+ (capped)' : '') + ' rows'));
        }
        try { await require('../metrics/ask/ask_log').append(await metrics.get_pool(), { surface: 'cli-sql', question: sql, provider: 'sql', model: null, sql: r.sql, ok: r.ok, row_count: r.row_count, answer: '' }); } catch (e) {}
      } catch (e) {
        console.error(col(C.red, 'SQL rejected: ' + e.message));
        try { await require('../metrics/ask/ask_log').append(await metrics.get_pool(), { surface: 'cli-sql', question: sql, provider: 'sql', model: null, sql: sql, ok: false, row_count: 0, answer: e.message }); } catch (e2) {}
        process.exit(1);
      } finally { try { await ask_db.close_pool(); } catch (e) {} }
      process.exit(0);
    }
    if (cmd === 'stats') {
      const pool = await metrics.get_pool();
      try { console.log(await metrics.report_text(pool, { days: args.days ? Number(args.days) : 7 })); }
      finally { await pool.end(); }
      return;
    }
    if (cmd === 'metrics:size') {
      const pool = await metrics.get_pool();
      try {
        const sz = await metrics.size(pool);
        console.log('');
        console.log(col(C.bold, metrics.TABLE));
        console.log('  rows: ' + sz.rows + '    size: ' + sz.mb + ' MB');
        console.log('  range: ' + (sz.min_utc || 'n/a') + '  ->  ' + (sz.max_utc || 'n/a') + '  (UTC)');
        (sz.by_year || []).forEach(function (y) { console.log('  ' + y.yr + ': ' + y.n + ' rows'); });
      } finally { await pool.end(); }
      return;
    }
    if (cmd === 'metrics:cleanup') {
      const pool = await metrics.get_pool();
      const sz = await metrics.size(pool);
      const keep = metrics.cfg.KEEP_YEARS;
      const cutoff = new Date().getFullYear() - (keep - 1);
      const doomed = (sz.by_year || []).filter(function (y) { return y.yr != null && Number(y.yr) < cutoff; });
      const total = doomed.reduce(function (a, y) { return a + Number(y.n); }, 0);
      console.log('');
      console.log(col(C.bold, 'Retention: keep ' + keep + ' calendar years (>= ' + cutoff + '); purge older.'));
      if (!total) { console.log('  Nothing to purge.'); await pool.end(); process.exit(0); }
      console.log('  Will purge ' + total + ' row(s): ' + doomed.map(function (y) { return y.yr + ' (' + y.n + ')'; }).join(', '));
      if (!args.yes && !(await confirm('  Proceed? [y/N] '))) { console.log('  Cancelled.'); await pool.end(); process.exit(0); }
      const r = await metrics.cleanup(pool, {});
      console.log(col(C.green, '  Purged ' + r.deleted + ' row(s).'));
      await pool.end();
      process.exit(0);   // confirm()'s readline can otherwise keep the process alive
    }
    if (cmd === 'metrics:purge-all') {
      const pool = await metrics.get_pool();
      const sz = await metrics.size(pool);
      console.log('');
      if (!sz.rows) { console.log('  Table is already empty.'); await pool.end(); process.exit(0); }
      console.log(col(C.red + C.bold, 'DANGER: deletes ALL ' + sz.rows + ' row(s) from ' + metrics.TABLE + ' — no date filter.'));
      if (!args.yes && !(await confirm('  Type y to delete EVERYTHING [y/N] '))) { console.log('  Cancelled.'); await pool.end(); process.exit(0); }
      const r = await metrics.purge_all(pool);
      console.log(col(C.green, '  Deleted ' + r.deleted + ' row(s). Table is now empty.'));
      await pool.end();
      process.exit(0);
    }
    if (cmd === 'metrics:purge-test') {
      const pool = await metrics.get_pool();
      // count first so the user sees exactly what will go (is_test = 1 only — real + demo rows are safe)
      const [c] = await pool.query('SELECT COUNT(*) AS n FROM `' + metrics.TABLE + '` WHERE is_test = 1');
      const n = (c[0] && c[0].n) || 0;
      console.log('');
      if (!n) { console.log('  No test rows (is_test = 1) to purge.'); await pool.end(); process.exit(0); }
      console.log(col(C.bold, 'Will delete ' + n + ' test row(s) (is_test = 1) from ' + metrics.TABLE + '. Real + demo data is untouched.'));
      if (!args.yes && !(await confirm('  Proceed? [y/N] '))) { console.log('  Cancelled.'); await pool.end(); process.exit(0); }
      const r = await metrics.purge_test(pool);
      console.log(col(C.green, '  Deleted ' + r.deleted + ' test row(s).'));
      await pool.end();
      process.exit(0);
    }
    if (cmd === 'sf:describe' || cmd === 'sf:soql') {
      // Read-only Salesforce discovery, run as the integration user (which can see objects/files a
      // personal Workbench login often can't). sf:describe lists an sObject's field API names;
      // sf:soql runs a single guarded SELECT.
      const sf = require('../sf');
      const cfg = sf.sf_config({ is_test: !!args.test });
      const check = sf.check_sf_config(cfg);
      if (!check.ok) { console.error(col(C.red, 'Salesforce not configured — missing: ' + check.missing.join(', '))); process.exit(2); }
      console.log(col(C.dim, 'Logging into Salesforce (' + cfg.environment_name + ')…'));
      const conn = await sf.make_connection(cfg);
      if (cmd === 'sf:describe') {
        const obj = args._[1];
        if (!obj) { console.log('Usage: node src/cli.js sf:describe <Object> [--field <substr>]'); process.exit(2); }
        const meta = await sf.describe_object(conn, obj);
        let fields = meta.fields;
        if (args.field) { const needle = String(args.field).toLowerCase(); fields = fields.filter(function (fld) { return (fld.name + ' ' + fld.label).toLowerCase().indexOf(needle) >= 0; }); }
        console.log(col(C.bold, '\n' + meta.label + '  (' + meta.name + ') — ' + fields.length + ' field(s):'));
        fields.forEach(function (fld) { console.log('  ' + String(fld.name).padEnd(34) + col(C.gray, String(fld.type).padEnd(14)) + fld.label); });
        console.log('');
        return;
      }
      const soql = args._.slice(1).join(' ').trim();
      if (!soql) { console.log('Usage: node src/cli.js sf:soql "<SELECT ...>" [--limit N]'); process.exit(2); }
      if (!/^\s*select\b/i.test(soql)) { console.error(col(C.red, 'Only read-only SELECT queries are allowed.')); process.exit(2); }
      const recs = await sf.run_soql(conn, soql, args.limit ? Number(args.limit) : undefined);
      console.log(col(C.bold, '\n' + recs.length + ' row(s):'));
      if (recs.length) {
        const cols = Object.keys(recs[0]).filter(function (k) { return k !== 'attributes'; });
        console.log(col(C.bold, cols.join('\t')));
        const cap = args.limit ? Number(args.limit) : 50;
        recs.slice(0, cap).forEach(function (r) {
          console.log(cols.map(function (k) { let v = r[k]; if (v && typeof v === 'object') v = v.Name || v.Type || ''; return v == null ? '' : String(v); }).join('\t'));
        });
        if (recs.length > cap) console.log(col(C.yellow, 'showing ' + cap + ' of ' + recs.length + ' rows'));
      }
      console.log('');
      return;
    }
    if (cmd === 'sf:list' || cmd === 'sf:pull') {
      const sf = require('../sf');
      const cfg = sf.sf_config({ is_test: !!args.test });
      const check = sf.check_sf_config(cfg);
      if (!check.ok) { console.error(col(C.red, 'Salesforce not configured — missing: ' + check.missing.join(', '))); process.exit(2); }
      const mode = args.today ? 'today' : (args.date ? 'specific' : ((args.start || args.end) ? 'range' : 'all'));
      const filter = { mode: mode, field: args.field || 'LastModifiedDate', date: args.date, start: args.start, end: args.end, tz: sf.DEFAULT_TZ };
      console.log(col(C.dim, 'Logging into Salesforce (' + cfg.environment_name + ')…'));
      const conn = await sf.make_connection(cfg);
      let files = await sf.list_race_results_files(conn, { filter: filter });
      if (args.limit) files = files.slice(0, Number(args.limit));
      console.log(col(C.bold, '\n' + files.length + ' Race Results Doc file(s):'));
      files.forEach(function (f, i) {
        console.log('  ' + String(i + 1).padStart(3) + '. ' + f.target_name +
          col(C.gray, '  · sanction ' + (f.sanction_id || '—') + ' · ' + (f.program_name || '—') + ' · ' + (f.owner_name || '—') + ' · ' + f.modified_mtn_full));
      });
      if (cmd === 'sf:list') { console.log(''); return; }
      // sf:pull -> download to a folder (same snake_case names as the web app)
      const out_dir = args.out || path.join(process.cwd(), 'sf_race_result_downloads');
      const strategy = args.strategy || 'add_new';   // add_new | replace | wipe_all
      fs.mkdirSync(out_dir, { recursive: true });
      if (strategy === 'wipe_all') {
        fs.readdirSync(out_dir).forEach(function (fn) { if (/\.(xlsx|xls|csv)$/i.test(fn)) { try { fs.unlinkSync(path.join(out_dir, fn)); } catch (e) { /* ignore */ } } });
      }
      let saved = 0, skipped = 0;
      for (const f of files) {
        const dest = path.join(out_dir, f.target_name);
        if (strategy === 'add_new' && fs.existsSync(dest)) { skipped++; continue; }
        const buf = await sf.fetch_content_version_bytes(conn, f.content_version_id);
        fs.writeFileSync(dest, buf);
        saved++;
        console.log(col(C.green, '  saved ') + f.target_name);
      }
      console.log(col(C.bold, '\nDownloaded ' + saved + ' file(s)' + (skipped ? ', skipped ' + skipped + ' existing' : '') + ' to ' + out_dir));
      return;
    }
    console.log('Unknown command: ' + cmd);
    help();
    process.exit(2);
  } catch (e) {
    console.error(col(C.red, 'Error: ' + e.message));
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { convert_one: convert_one };
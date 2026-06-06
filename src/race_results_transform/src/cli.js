#!/usr/bin/env node
/**
 * cli.js — scriptable race-results -> template converter.
 *
 * Usage:
 *   node cli.js convert <input.xlsx> [-o out.xlsx] [--profile file.json] [--quiet]
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
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--strict') out.strict = true;
    else out._.push(a);
  }
  return out;
}

async function default_out_name(input) {
  // Generated files go to the data/outputs dir (usat/data/...), never the repo.
  const base = path.basename(input).replace(/\.(xlsx|xls|csv)$/i, '');
  return path.join(await data_dir.outputs(), base + ' - formatted.xlsx');
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
  const buf = await io.grids_to_buffer(sheets);
  fs.writeFileSync(out_path, Buffer.from(buf));
  if (!opts.quiet) {
    const suffix = results.length > 1 ? '  (' + results.length + ' sheets)' : '';
    results.forEach(function (r) { print_scorecard(r.res.report, path.basename(input) + ' [' + r.ir.sheet_name + ']  ->  ' + path.basename(out_path) + suffix); });
  }
  return results[0].res.report;
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
    '  node cli.js convert <input.xlsx> [-o out.xlsx] [--profile p.json] [--quiet]',
    '  node cli.js inspect <input.xlsx>',
    '  node cli.js batch   <folder> [-o outdir]',
    '  node cli.js stats          [--days 7]      # usage analytics summary',
    '  node cli.js metrics:size                   # events table size + rows/year',
    '  node cli.js metrics:cleanup [--yes]        # purge years beyond current+prior',
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
      const out = args.out || await default_out_name(input);
      const report = await convert_one(input, out, args);
      console.log('\nSaved: ' + out);
      process.exit(report.scorecard.band === 'red' ? 1 : 0);
    }
    if (cmd === 'batch') {
      const dir = args._[1];
      if (!dir) { help(); process.exit(2); }
      const outdir = args.out || await data_dir.outputs();
      if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
      const files = fs.readdirSync(dir).filter(function (f) { return /\.(xlsx|xls|csv)$/i.test(f) && !/ - formatted\./i.test(f); });
      let worst = 0;
      for (const f of files) {
        const out = path.join(outdir, f.replace(/\.(xlsx|xls)$/i, '') + ' - formatted.xlsx');
        const report = await convert_one(path.join(dir, f), out, args);
        if (report.scorecard.band === 'red') worst = 1;
      }
      console.log('\nProcessed ' + files.length + ' file(s) into ' + outdir);
      process.exit(worst);
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
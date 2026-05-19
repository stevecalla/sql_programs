#!/usr/bin/env node
/**
 * build_all.js — USAT Sanctioned Event Analysis, master build script.
 *
 * Produces from scratch:
 *   output/2026_event_calendar_analysis_v9f.xlsx
 *   output/event_trends_summary_v3.pptx
 *
 * Usage:
 *   npm run build          (after npm install)
 *   node build_all.js
 *
 * Input CSVs live in data/ — add new year files there and update
 * the csv_25 / csv_26 / csv_create_25 / csv_create_26 constants below.
 */

'use strict';

// Load .env file if present (ANTHROPIC_API_KEY etc.)
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── CLI flags ───────────────────────────────────────────────────────────────
// Universal across shells (PowerShell, cmd, bash, zsh, Git Bash) — no
// shell-specific syntax. Pass as args: `node build_all.js --no-ai`.
//
// One small helper avoids reading process.argv directly in five different
// places below.
function has_flag(...names) {
  return names.some(n => process.argv.includes(n));
}
/**
 * Read a `--name VALUE` (or `--name=VALUE`) CLI option. Returns the string
 * value or null when the flag isn't present. Caller decides type coercion.
 */
function get_arg_value(name) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  const eq = process.argv.find(a => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : null;
}
const FORCE_RULE_BASED = has_flag('--no-ai', '--rule-based');
const FORCE_FRESH_AI   = has_flag('--fresh-ai');
const FORCE_STALE_AI   = has_flag('--stale-ai');
const SKIP_ROSTER_DB   = has_flag('--no-db-roster');
const SUPPRESS_SLACK   = has_flag('--no-slack');

// ── Input config ────────────────────────────────────────────────────────────
const DIR = __dirname;

// All inputs are now pulled live from usat_sales_db.event_data_metrics.
// Default to comparing current year (ANALYSIS_YEAR) vs prior year (BASELINE_YEAR).
// Override at the shell: ANALYSIS_YEAR=2027 BASELINE_YEAR=2026 node build_all.js
// Year scope resolves in priority order: CLI flag → env var → current year.
// CLI flags are the new canonical interface (universal across shells);
// env vars are still honoured because `.env` is where persistent project
// config lives, and the server / ask.js share that same env-var contract.
const ANALYSIS_YEAR = Number(get_arg_value('--analysis-year'))
                   || Number(process.env.ANALYSIS_YEAR)
                   || new Date().getFullYear();
const BASELINE_YEAR = Number(get_arg_value('--baseline-year'))
                   || Number(process.env.BASELINE_YEAR)
                   || (ANALYSIS_YEAR - 1);

// ── Output config ────────────────────────────────────────────────────────────
// Timestamp captured once at script start so every artifact from this run
// shares the same suffix (YYYY-MM-DD_HH-MM-SS, e.g. "2026-05-17_14-30-45").
const BUILD_TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
// OUTPUT_DIR is resolved inside main() because determineOSPath() is async.
// Override at the shell: EVENT_ANALYSIS_OUTPUT_DIR=/custom/path node build_all.js
async function resolve_output_dir() {
  if (process.env.EVENT_ANALYSIS_OUTPUT_DIR) return process.env.EVENT_ANALYSIS_OUTPUT_DIR;
  const os_path = await determineOSPath();
  return path.join(os_path, 'usat_event_analysis_output');
}

// ── Source modules ────────────────────────────────────────────────────────────
const { loadBothYearsFromRows: load_both_years_from_rows } = require('./src/loader');
const { fetch_events_for_years, fetch_creation_for_years } = require('./src/db');
const { runAnalysis: run_analysis } = require('./src/analysis');
const { build_workbook } = require('./src/excel/builder');
const { generate_rule_based, generate_ai } = require('./src/commentary');
const { generate_dashboard } = require('./src/dashboard');
const { buildDeck } = require('./src/pptx/builder');
const { determineOSPath } = require('../../utilities/determineOSPath');
const { ensure_overrides_table } = require('./utilities/ensure_overrides_table');
const { migrate_overrides_json_to_db } = require('./utilities/migrate_overrides_to_db');
const { ensure_roster_table } = require('./utilities/ensure_roster_table');
const { insert_roster_snapshot } = require('./utilities/insert_roster_snapshot');
const { prune_roster_table } = require('./utilities/prune_roster_table');
const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');


// ── Archive + export helpers ──────────────────────────────────────────────────

function archive_outputs(dir, { patterns = [], files = [], keep_last_n = 1 } = {}) {
  if (!fs.existsSync(dir)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const archive_dir = path.join(dir, 'archive', ts);
  let archived = 0;

  // Move every prior file in `dir` whose basename matches one of the regex
  // patterns. Using rename (move) so output/ ends up with only the new run.
  if (patterns.length) {
    for (const name of fs.readdirSync(dir)) {
      if (!patterns.some(rx => rx.test(name))) continue;
      const fp = path.join(dir, name);
      if (!fs.statSync(fp).isFile()) continue;
      fs.mkdirSync(archive_dir, { recursive: true });
      fs.renameSync(fp, path.join(archive_dir, name));
      archived++;
    }
  }

  // Copy any exact-path files (commentary.json, analysis_*.json, dashboard.html)
  // BEFORE the build overwrites them in output/. These give the diff report a
  // prior snapshot to compare against.
  for (const fp of files) {
    if (fs.existsSync(fp)) {
      fs.mkdirSync(archive_dir, { recursive: true });
      fs.copyFileSync(fp, path.join(archive_dir, path.basename(fp)));
      archived++;
    }
  }

  if (archived > 0) console.log(`  Archived ${archived} prior file(s) to output/archive/${ts}/`);

  // Prune older archive subfolders, keeping only the newest `keep_last_n`.
  // Only timestamp-named folders are eligible for deletion — anything a
  // human dropped in there (e.g. `manual_save/`) is left alone.
  const archive_root = path.join(dir, 'archive');
  if (fs.existsSync(archive_root)) {
    const ts_re = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
    const subfolders = fs.readdirSync(archive_root)
      .filter(name => ts_re.test(name) && fs.statSync(path.join(archive_root, name)).isDirectory())
      .sort()
      .reverse();  // newest first (timestamps are ISO-like → lexical sort works)
    const to_delete = subfolders.slice(keep_last_n);
    for (const name of to_delete) {
      fs.rmSync(path.join(archive_root, name), { recursive: true, force: true });
    }
    if (to_delete.length) {
      console.log(`  Pruned ${to_delete.length} older archive folder(s); keeping the ${keep_last_n} most recent.`);
    }
  }
}

function save_json(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  // Atomic write: stage to a temp file, then rename. Prevents readers from
  // seeing a half-written file if the process is interrupted mid-write.
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, fp);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

// ── Build timing ────────────────────────────────────────────────────────────
// Two-level instrumentation: a total wall-clock for the whole build, and a
// list of stages so we can print a bar-chart breakdown at the end. Useful
// both for "what's slow?" diagnosis and for showing the user, on every
// build, how long the work actually took.
//
// `stage_done(label)` records elapsed time since the previous mark (or since
// _build_t0 on the first call) and resets the stopwatch. Placement matters:
// drop the call right after the work that produced the stage's output, so
// the duration captured is what most people would intuitively attribute to
// that step.
const _stages = [];
let _build_t0 = 0;
let _stage_t0 = 0;
function stage_done(label) {
  _stages.push({ label, ms: Date.now() - _stage_t0 });
  _stage_t0 = Date.now();
}
// Collected once at the end of main() (or in the catch block) and sent to
// Slack. Lives at module scope so the cache decision in the commentary
// block + the totals from the loader pass + the timing helper can all
// contribute. Keys are filled in opportunistically; missing ones are
// rendered as '?' in the message.
const _build_summary = {
  commentary_path: null,   // 'cache_hit' | 'ai_fresh' | 'rule_based'
  baseline_total:  null,
  analysis_total:  null,
};

/**
 * Format a one-line success message for Slack. Pure function — pulled out
 * so tests/build.test.js can assert the wire format without spawning the
 * build. Inputs are all caller-supplied so the formatter has no
 * dependency on module-scope state.
 *
 * Sample output:
 *   :white_check_mark: event_analysis build · 7.3s · ai_claude (cached) · 2025→2026 net -12
 */
function format_slack_success({
  total_ms,
  commentary_path,    // 'cache_hit' | 'ai_fresh' | 'rule_based' | null
  baseline_year,
  analysis_year,
  baseline_total,
  analysis_total,
}) {
  const total_s = (Number(total_ms) / 1000).toFixed(1);
  const path_label = commentary_path === 'cache_hit'  ? 'ai_claude (cached)'
                   : commentary_path === 'ai_fresh'   ? 'ai_claude (fresh)'
                   : commentary_path === 'rule_based' ? 'rule_based'
                   :                                    '?';
  const has_totals = baseline_total != null && analysis_total != null;
  const net = has_totals ? analysis_total - baseline_total : null;
  const net_str = !has_totals
    ? ''
    : ` · ${baseline_year}→${analysis_year} net ${net >= 0 ? '+' : ''}${net}`;
  return `:white_check_mark: event_analysis build · ${total_s}s · ${path_label}${net_str}`;
}

/**
 * Format a one-line failure message for Slack. Truncates the error to its
 * first line (rest goes to stderr) and caps at 200 chars so a stack
 * trace can't flood the channel.
 *
 * Sample output:
 *   :x: event_analysis build FAILED · 12.1s · TypeError: foo is undefined
 */
function format_slack_failure({ total_ms, error_message }) {
  const total_s = total_ms ? (Number(total_ms) / 1000).toFixed(1) : '?';
  const first_line = (error_message || 'unknown error').split('\n')[0].slice(0, 200);
  return `:x: event_analysis build FAILED · ${total_s}s · ${first_line}`;
}

/**
 * Post a brief execution summary to Slack. Wrapped so a missing webhook
 * URL or a Slack outage never breaks the build — we just log a warning.
 * Skipped entirely when --no-slack is passed (useful in tests / dev).
 */
async function send_slack(message) {
  if (SUPPRESS_SLACK) return;
  try {
    await slack_message_api(message, 'steve_calla_slack_channel');
  } catch (err) {
    console.warn(`  (Slack notification failed: ${err.message})`);
  }
}

function print_timing_summary() {
  const total = Date.now() - _build_t0;
  console.log('');
  console.log('──────────────────────────────────────────────────────');
  console.log('Build timing (largest first):');
  // Sort by descending duration so the hot spot is at the top — the most
  // useful sort order for "where do I look first to make this faster?"
  for (const s of [..._stages].sort((a, b) => b.ms - a.ms)) {
    const bar_width = total > 0 ? Math.round((s.ms / total) * 28) : 0;
    const bar = '█'.repeat(bar_width);
    console.log(`  ${s.label.padEnd(24)} ${((s.ms / 1000).toFixed(2) + 's').padStart(7)}  ${bar}`);
  }
  console.log(`  ${'─'.repeat(24)} ${'─'.repeat(7)}`);
  console.log(`  ${'TOTAL'.padEnd(24)} ${((total / 1000).toFixed(2) + 's').padStart(7)}`);
  console.log('──────────────────────────────────────────────────────');
}

// ── Commentary cache helpers ───────────────────────────────────────────────
// The AI commentary call is ~71s. The vast majority of rebuilds don't change
// any number commentary reads (segment counts, type breakdown, monthly
// aggregates), so we hash a curated whitelist of fields and reuse the prior
// commentary.json when the hash matches. Override via --fresh-ai (force
// re-call) or --stale-ai (use cache even if inputs drifted).
//
// What's IN the hash: aggregates commentary actually reads — years, segment
// counts, per-type counts/deltas, per-month numeric aggregates, organic
// breakdown, calendar impact, override count, and the rule-based flag.
//
// What's NOT in the hash: individual event names, sanction IDs, confidence
// scores, day-of-week, override row contents, build timestamps, file paths.
// A typo fix in source data won't invalidate the cache; a single event
// flipping segments will.
function compute_commentary_input_hash(results, force_rule_based) {
  // Strip per-month numeric aggregates only — defends against future
  // additions of non-numeric sub-fields that would cause false invalidation.
  const monthly_aggregates = results.monthly
    ? Object.fromEntries(Object.entries(results.monthly).map(([m, d]) => [
        m,
        Object.fromEntries(Object.entries(d).filter(([_, v]) => typeof v === 'number')),
      ]))
    : null;
  const whitelist = {
    years:            results.years,
    segments:         results.segSummary,
    by_type:          results.typeAnnual,
    monthly:          monthly_aggregates,
    organic_by_type:  results.organicByType,
    cal_impact:       results.calImpact,
    override_count:   results.override_summary?.total_applied ?? 0,
    force_rule_based: !!force_rule_based,
  };
  return crypto.createHash('sha256').update(JSON.stringify(whitelist)).digest('hex');
}

function try_load_cached_commentary(output_dir) {
  try {
    const fp = path.join(output_dir, 'commentary.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  _build_t0 = Date.now();
  _stage_t0 = _build_t0;

  const OUTPUT_DIR = await resolve_output_dir();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── Schema check ──────────────────────────────────────────────────────────
  // Idempotent — no-op when the table is already present.
  await ensure_overrides_table({ silent: false });

  // ── Migrate legacy JSON overrides into the DB (one-shot, idempotent) ─────
  // Skipped silently after data/overrides.json is renamed to .migrated.
  await migrate_overrides_json_to_db({ silent: false });

  // ── Ensure the per-build roster snapshot table exists ────────────────────
  // Wrapped so a DB outage logs a warning but doesn't fail the build —
  // the snapshot is a secondary historical record, not a build dependency.
  try { await ensure_roster_table({ silent: false }); }
  catch (e) { console.warn(`  ensure_roster_table failed (non-fatal): ${e.message}`); }
  stage_done('schema + migrations');

  const out_xlsx = path.join(OUTPUT_DIR, `${ANALYSIS_YEAR}_event_calendar_analysis_${BUILD_TS}.xlsx`);
  const out_pptx = path.join(OUTPUT_DIR, `${ANALYSIS_YEAR}_event_trends_summary_${BUILD_TS}.pptx`);

  console.log('');
  console.log('USAT Sanctioned Events -- Build All');
  console.log('====================================');
  console.log(`  Data source         : usat_sales_db.event_data_metrics`);
  console.log(`  Years               : ${BASELINE_YEAR} vs ${ANALYSIS_YEAR}`);
  console.log(`  Output directory    : ${OUTPUT_DIR}`);
  console.log(`  Excel output        : ${out_xlsx}`);
  console.log(`  PowerPoint output   : ${out_pptx}`);
  console.log('');

  // ── Archive prior outputs ──────────────────────────────────────────────────
  archive_outputs(path.join(OUTPUT_DIR), {
    patterns: [
      /^\d{4}_event_calendar_analysis_.+\.xlsx$/,
      /^\d{4}_event_trends_summary_.+\.pptx$/,
    ],
    // JSON sidecars copied so the diff report has a prior snapshot.
    files: [
      path.join(OUTPUT_DIR, 'commentary.json'),
      path.join(OUTPUT_DIR, 'analysis_results.json'),
      path.join(OUTPUT_DIR, 'analysis_state.json'),
      path.join(OUTPUT_DIR, 'dashboard.html'),
    ],
    keep_last_n: 1,
  });
  stage_done('archive prior outputs');

  // ── Fetch from usat_sales_db ──────────────────────────────────────────────
  console.log('Fetching events from usat_sales_db...');
  const events_by_year = await fetch_events_for_years([BASELINE_YEAR, ANALYSIS_YEAR]);
  console.log(`  ${BASELINE_YEAR} rows fetched: ${events_by_year[BASELINE_YEAR].length}  |  ${ANALYSIS_YEAR} rows fetched: ${events_by_year[ANALYSIS_YEAR].length}`);

  console.log('Fetching creation pipeline from usat_sales_db...');
  const creation_by_year = await fetch_creation_for_years([BASELINE_YEAR, ANALYSIS_YEAR]);
  console.log(`  ${BASELINE_YEAR} creation rows: ${creation_by_year[BASELINE_YEAR].length}  |  ${ANALYSIS_YEAR} creation rows: ${creation_by_year[ANALYSIS_YEAR].length}`);
  stage_done('fetch from MySQL');

  // ── Excel ────────────────────────────────────────────────────────────────
  console.log('Building Excel workbook...');
  const loaded = load_both_years_from_rows(events_by_year[BASELINE_YEAR], events_by_year[ANALYSIS_YEAR]);
  loaded.BASELINE_YEAR = BASELINE_YEAR;
  loaded.ANALYSIS_YEAR = ANALYSIS_YEAR;
  console.log(`  ${BASELINE_YEAR} active: ${loaded.baseline_active.length}  |  ${ANALYSIS_YEAR} active: ${loaded.analysis_active.length}`);
  _build_summary.baseline_total = loaded.baseline_active.length;
  _build_summary.analysis_total = loaded.analysis_active.length;
  const results = await run_analysis(loaded);
  results.years = { BASELINE_YEAR: BASELINE_YEAR, ANALYSIS_YEAR: ANALYSIS_YEAR };
  // Attach creation rows so commentary.js can build pipeline narratives.
  results.creation_rows = { BASELINE_YEAR: creation_by_year[BASELINE_YEAR], ANALYSIS_YEAR: creation_by_year[ANALYSIS_YEAR] };
  console.log('  Segments:', JSON.stringify(results.segSummary));
  stage_done('analyze + segment');

  // Export analysis results dataset
  const out_results_json = path.join(OUTPUT_DIR, 'analysis_results.json');
  const results_export = {
    generated_at: new Date().toISOString(),
    years: { BASELINE_YEAR: BASELINE_YEAR, ANALYSIS_YEAR: ANALYSIS_YEAR },
    totals: { BASELINE_YEAR: loaded.baseline_active.length, ANALYSIS_YEAR: loaded.analysis_active.length, net: loaded.analysis_active.length - loaded.baseline_active.length },
    segments: results.segSummary,
    by_type: results.typeAnnual ?? {},
    monthly: Object.fromEntries(Object.entries(results.monthly ?? {}).map(([m, d]) => [m, { n_baseline: d.n_baseline, n_analysis: d.n_analysis, net_delta: d.netDelta, net_shift: d.netShift, organic_delta: results.calImpact?.[Number(m) - 1]?.orgTotal ?? null }])),
    organic_by_type: results.organicByType ?? {},
    shift_flow: results.shiftFlow ?? {},
    calendar_impact: results.calImpact ?? {},
    overrides: results.override_summary ?? { total_applied: 0, applied: [], warnings: [] },
  };
  save_json(out_results_json, results_export);
  console.log(`  Analysis results saved: output/analysis_results.json`);

  // ── Full state snapshot for ask.js (single source of truth for Q&A) ───────
  // Serialize the complete analysis state so ask.js can answer questions
  // straight from the same data the deck was built from. Date objects → ISO.
  const serialize_event = e => e ? {
    sanction_id: e.sanctionId,
    name: e.name,
    type: e.type,
    month: e.month,
    start_date: e.startDate instanceof Date ? e.startDate.toISOString().slice(0, 10) : e.startDate,
    status: e.status,
  } : null;
  const serialize_match = m => ({
    e25: serialize_event(m.e25),
    e26: serialize_event(m.e26),
    confidence: m.confidence ?? null,
    match_type: m.matchType ?? m.match_type ?? null,
  });
  const out_state_json = path.join(OUTPUT_DIR, 'analysis_state.json');
  const state_export = {
    build_meta: {
      build_ts: new Date().toISOString(),
      years: { BASELINE_YEAR: BASELINE_YEAR, ANALYSIS_YEAR: ANALYSIS_YEAR },
      totals: { BASELINE_YEAR: loaded.baseline_active.length, ANALYSIS_YEAR: loaded.analysis_active.length, net: loaded.analysis_active.length - loaded.baseline_active.length },
      data_source: 'usat_sales_db.event_data_metrics',
      exclusion_filter: ['CANCELLED', 'DECLINED', 'DELETED'],
      overrides_applied: results.override_summary?.total_applied ?? 0,
    },
    events: {
      year_a_active:   loaded.baseline_active.map(serialize_event),
      year_b_active:   loaded.analysis_active.map(serialize_event),
      year_a_excluded: loaded.baseline_excluded.map(serialize_event),
      year_b_excluded: loaded.analysis_excluded.map(serialize_event),
    },
    segments: {
      retained:        results.segments.retained.map(serialize_match),
      shifted:         results.segments.shifted.map(serialize_match),
      attrited:        results.segments.attrited.map(serialize_match),
      new:             results.segments.new.map(serialize_match),
      recovered:       results.segments.recovered.map(serialize_match),
      tried_to_return: results.segments.triedToReturn.map(serialize_match),
    },
    counts_by_month_type: {
      BASELINE_YEAR: results.c_baseline ?? {},
      ANALYSIS_YEAR: results.c_analysis ?? {},
    },
    segments_by_month_type: {
      // Keys reflect which year's month is the index (e25.month vs e26.month).
      retained_by_year_a_month:  results.retMt ?? {},
      shifted_by_year_a_month:   results.saMt ?? {},
      shifted_by_year_b_month:   results.suMt ?? {},
      attrited_by_year_a_month:  results.attrMt ?? {},
      tried_to_return_by_year_a_month: results.ttrMt ?? {},
      new_by_year_b_month:       results.newMt ?? {},
      recovered_by_year_b_month: results.recMt ?? {},
    },
    type_annual: results.typeAnnual ?? {},
    organic_by_type: results.organicByType ?? {},
    calendar_impact: results.calImpact ?? [],
    shift_flow: results.shiftFlow ?? {},
    creation_pipeline: {
      BASELINE_YEAR: creation_by_year[BASELINE_YEAR] ?? [],
      ANALYSIS_YEAR: creation_by_year[ANALYSIS_YEAR] ?? [],
    },
    overrides: results.override_summary ?? { total_applied: 0, applied: [], warnings: [] },
  };
  save_json(out_state_json, state_export);
  console.log(`  Analysis state saved:   output/analysis_state.json (${(JSON.stringify(state_export).length / 1024).toFixed(0)} KB)`);

  // ── Generate commentary (rule-based, upgraded to AI if key present) ────────
  // --no-ai (or --rule-based) forces rule-based even when the key is set.
  // --fresh-ai forces a fresh AI call, bypassing the input-hash cache.
  // --stale-ai forces using the cached commentary even when inputs drifted.
  const force_rule_based = FORCE_RULE_BASED;
  const force_fresh_ai   = FORCE_FRESH_AI;
  const force_stale_ai   = FORCE_STALE_AI;
  const api_key = process.env.ANTHROPIC_API_KEY || null;

  // Hash the inputs commentary actually reads. Used to decide whether the
  // prior commentary.json is still good or needs re-running.
  const cache_key = compute_commentary_input_hash(results, force_rule_based);
  const cached    = try_load_cached_commentary(OUTPUT_DIR);
  const cache_hit = !!cached && cached._input_hash === cache_key;

  let commentary = null;

  if (cache_hit && !force_fresh_ai) {
    console.log(`  Commentary cache HIT (hash ${cache_key.slice(0,8)}…) — reusing prior commentary.json, no AI call.`);
    commentary = cached;
    _build_summary.commentary_path = 'cache_hit';
  } else if (force_stale_ai && cached) {
    console.log('  --stale-ai — reusing prior commentary.json even though inputs drifted (hash differs).');
    commentary = cached;
    _build_summary.commentary_path = 'cache_hit';
  } else if (force_rule_based) {
    console.log('  --no-ai (or --rule-based) — skipping AI commentary, using rule-based.');
    _build_summary.commentary_path = 'rule_based';
  } else if (api_key && api_key !== 'sk-ant-your-key-here') {
    if (force_fresh_ai && cache_hit) {
      console.log('  --fresh-ai — bypassing cache, calling Claude even though inputs are unchanged...');
    } else if (cached && !cache_hit) {
      console.log(`  Commentary cache MISS (inputs drifted, hash ${cache_key.slice(0,8)}…) — calling Claude API for insights...`);
    } else {
      console.log('  AI commentary enabled -- calling Claude API for insights...');
    }
    try {
      commentary = await generate_ai(results, api_key);
      if (commentary._ai_generated) {
        console.log('  AI commentary generated successfully.');
        _build_summary.commentary_path = 'ai_fresh';
      }
    } catch (err) {
      console.warn('  AI commentary failed:', err.message, '-- using rule-based fallback');
      commentary = null;
      _build_summary.commentary_path = 'rule_based';
    }
  } else {
    console.log('  Using rule-based commentary (add ANTHROPIC_API_KEY to .env to enable AI insights)');
    _build_summary.commentary_path = 'rule_based';
  }
  // Ensure we always have commentary
  if (!commentary) commentary = generate_rule_based(results);

  // Stamp the input hash so the next build can compare. Survives the
  // commentary.json round-trip below.
  commentary._input_hash = cache_key;

  // Mutate the in-memory commentary so EVERY downstream consumer
  // (dashboard, PowerPoint, Excel narratives) sees the same `mode` field
  // that gets written to commentary.json. Previously `mode` was set only
  // in the saved-file object literal, leaving the in-memory commentary
  // without a mode — which made the dashboard's `cm?.mode ?? 'rule_based'`
  // check always fall back to "Rule-based" regardless of the actual run.
  commentary.mode  = commentary._ai_generated ? 'ai_claude' : 'rule_based';
  commentary.model = commentary._ai_generated ? 'claude-haiku-4-5-20251001' : null;

  // Export commentary dataset
  const out_commentary_json = path.join(OUTPUT_DIR, 'commentary.json');
  save_json(out_commentary_json, {
    generated_at: new Date().toISOString(),
    ...commentary,
  });
  console.log(`  Commentary saved: output/commentary.json (mode: ${commentary.mode})`);
  stage_done(`commentary (${commentary.mode})`);

  // ── Excel (receives commentary for dynamic narrative cells) ───────────────
  await build_workbook(results, out_xlsx, creation_by_year[BASELINE_YEAR], creation_by_year[ANALYSIS_YEAR], commentary);
  console.log('  Excel done.\n');
  stage_done('Excel workbook');

  // ── PowerPoint ────────────────────────────────────────────────────────────
  // ── Auto-append build summary to notes.md ───────────────────────────────────
  try {
    const notes_path = path.join(DIR, 'notes.md');
    let notes_content = '';
    try { notes_content = fs.readFileSync(notes_path, 'utf8'); } catch { /* ok */ }

    // Keep only the last 5 build summaries in notes.md
    const BUILD_TAG = '\n---\n### Build run:';
    const existing_builds = notes_content.split(BUILD_TAG).filter(Boolean);
    const static_part = notes_content.startsWith(BUILD_TAG) ? '' :
      notes_content.slice(0, notes_content.indexOf('\n---\n### Build run:') >= 0
        ? notes_content.indexOf('\n---\n### Build run:') : undefined);

    const new_build = `${BUILD_TAG} ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} | mode: ${commentary._ai_generated ? 'ai_claude' : 'rule_based'}
- Total: ${results.baseline_active.length} (prior) → ${results.analysis_active.length} (current), net ${results.analysis_active.length - results.baseline_active.length}
- Segments: Retained ${results.segSummary.Retained}, Shifted ${results.segSummary.Shifted}, Lost ${results.segSummary.Lost}, New ${results.segSummary.New}
- Top issue: ${commentary.top_decliner ? commentary.top_decliner.type + ' ' + commentary.top_decliner.pct + '%' : 'No clear decliner'}
- Top growth: ${commentary.top_grower ? commentary.top_grower.type + ' +' + commentary.top_grower.pct + '%' : 'None'}
- Worst months: ${commentary.worst_months?.slice(0, 2).map(m => m.label + ' (' + (m.delta >= 0 ? '+' : '') + m.delta + ')').join(', ')}
`;

    const recent_builds = [...existing_builds.slice(-4), new_build.replace(BUILD_TAG, '')];
    const final_notes = (static_part || notes_content.split(BUILD_TAG)[0] || '')
      .trimEnd() + recent_builds.map(b => BUILD_TAG + b).join('');

    fs.writeFileSync(notes_path, final_notes, 'utf8');
    console.log('  Build summary appended to notes.md');
  } catch (err) {
    // Non-fatal — notes.md update failing shouldn't stop the build
  }

  console.log('Building PowerPoint deck...');
  await buildDeck(out_pptx, results, commentary, creation_by_year[BASELINE_YEAR], creation_by_year[ANALYSIS_YEAR]);
  console.log('  PowerPoint done.\n');
  stage_done('PowerPoint deck');

  // ── HTML dashboard ───────────────────────────────────────────────────────
  // Pass the actual built filenames so the dashboard's Download buttons
  // link to files that exist. Previously the template had hardcoded names
  // (`_v9f.xlsx` / `_v3.pptx`) that never matched the timestamped basenames
  // build_all.js writes — every download attempt 404'd.
  const out_dashboard = path.join(OUTPUT_DIR, 'dashboard.html');
  results_export.downloads = {
    xlsx: path.basename(out_xlsx),
    pptx: path.basename(out_pptx),
  };
  generate_dashboard(results_export, commentary, out_dashboard, results.segments);
  console.log(`  Dashboard: ${out_dashboard}`);
  stage_done('dashboard.html');

  // ── Diff report ───────────────────────────────────────────────────────────
  try {
    const archive_dir = path.join(OUTPUT_DIR, 'archive');
    const prior_runs = fs.existsSync(archive_dir) ? fs.readdirSync(archive_dir).sort().reverse() : [];
    const prior_cm_path = prior_runs.length
      ? path.join(archive_dir, prior_runs[0], 'commentary.json')
      : null;
    const prior_cm = prior_cm_path && fs.existsSync(prior_cm_path)
      ? JSON.parse(fs.readFileSync(prior_cm_path, 'utf8'))
      : null;

    if (prior_cm) {
      const diff_lines = [];
      diff_lines.push(`Changes since last build (${prior_runs[0]})`);
      diff_lines.push('='.repeat(60));

      // Compare key metrics
      const metric_keys = ['n_baseline', 'n_analysis', 'net', 'attrited', 'new_ev', 'rec', 'repl_rate'];
      const metric_labels = {
        n_baseline: 'Prior-yr events', n_analysis: 'Current-yr events', net: 'Net change',
        attrited: 'Lost', new_ev: 'New events', rec: 'Recovered', repl_rate: 'Replacement rate %'
      };
      let metrics_changed = 0;
      diff_lines.push('\nKey metrics:');
      for (const k of metric_keys) {
        const old_v = prior_cm[k], new_v = commentary[k];
        if (old_v !== undefined && new_v !== undefined && old_v !== new_v) {
          diff_lines.push(`  ${(metric_labels[k] ?? k).padEnd(22)} ${String(old_v).padStart(6)} → ${String(new_v).padStart(6)}`);
          metrics_changed++;
        }
      }
      if (!metrics_changed) diff_lines.push('  (no metric changes)');

      // Compare narratives
      const narrative_keys = ['slide_2_narrative', 'slide_3_narrative', 'slide_4_narrative',
        'slide_5_narrative', 'slide_6_narrative', 'slide_7_narrative', 'slide_8_narrative'];
      diff_lines.push('\nNarrative changes:');
      let narr_changed = 0;
      for (const k of narrative_keys) {
        if (prior_cm[k] !== commentary[k] && commentary[k]) {
          diff_lines.push(`  ${k}:`);
          diff_lines.push(`    WAS: ${(prior_cm[k] ?? '(none)').slice(0, 120)}...`);
          diff_lines.push(`    NOW: ${commentary[k].slice(0, 120)}...`);
          narr_changed++;
        }
      }
      if (!narr_changed) diff_lines.push('  (no narrative changes)');

      // Mode change
      if (prior_cm.mode !== commentary.mode) {
        diff_lines.push(`\nCommentary mode: ${prior_cm.mode} → ${commentary.mode}`);
      }

      // Overrides
      const prior_ov = prior_cm._ai_generated !== undefined ? 0 : 0;
      if (results.override_summary?.total_applied) {
        diff_lines.push(`\nActive overrides: ${results.override_summary.total_applied}`);
        results.override_summary.applied.forEach(a => diff_lines.push(`  ${a.type}: ${a.sid_baseline ?? ''}${a.sid_analysis ? '/' + a.sid_analysis : ''} → ${a.result}`));
      }

      diff_lines.push('\n' + '='.repeat(60));
      const diff_text = diff_lines.join('\n');
      fs.writeFileSync(path.join(OUTPUT_DIR, 'changes.txt'), diff_text, 'utf8');
      console.log(`  Changes:   output/changes.txt (${metrics_changed} metric change(s), ${narr_changed} narrative change(s))`);
    }
  } catch (err) {
    /* diff is non-fatal */
  }
  stage_done('diff report + notes.md');

  console.log('Done!');
  console.log(`  Excel      : ${out_xlsx}`);
  console.log(`  PowerPoint : ${out_pptx}`);
  console.log(`  Results    : ${out_results_json}`);
  console.log(`  Commentary : ${out_commentary_json}`);

  // ── Roster snapshot to DB ────────────────────────────────────────────────
  // Append-only historical record of every event in this build, tagged with
  // build_at. Same shape as the dashboard's ROSTER. Wrapped helper is
  // already defensive — never throws, returns 0 on any failure.
  //
  // --no-db-roster skips the DB write entirely. Useful for:
  //   - local iteration where you don't want to clutter the table
  //   - one-off builds you don't want in the historical record
  //   - dev environments without DB write access
  // Wired by the "Build (skip roster DB write)" menu option.
  if (SKIP_ROSTER_DB) {
    console.log('  --no-db-roster — skipping roster snapshot + retention pruning.');
    stage_done('roster snapshot + prune (skipped)');
  } else {
    const build_at = new Date();
    await insert_roster_snapshot({
      results, build_at,
      baseline_year: BASELINE_YEAR,
      analysis_year: ANALYSIS_YEAR,
      silent: false,
    });

    // ── Tiered retention pruning ───────────────────────────────────────────
    // 48h full / 30d daily / 90d weekly / monthly forever. Idempotent — only
    // deletes rows that just aged out. Also defensive — never throws.
    await prune_roster_table({ silent: false });
    stage_done('roster snapshot + prune');
  }

  // ── Build timing summary ──────────────────────────────────────────────────
  // Sorted descending by elapsed time so the biggest stage is at the top —
  // useful for "where do I look first if I want to make this faster?"
  print_timing_summary();

  // ── Slack notification ────────────────────────────────────────────────────
  // Brief one-line summary to #steve_calla — execution + timing + commentary
  // path. Skipped when --no-slack is passed. Never breaks the build if Slack fails.
  await send_slack(format_slack_success({
    total_ms:         Date.now() - _build_t0,
    commentary_path:  _build_summary.commentary_path,
    baseline_year:    BASELINE_YEAR,
    analysis_year:    ANALYSIS_YEAR,
    baseline_total:   _build_summary.baseline_total,
    analysis_total:   _build_summary.analysis_total,
  }));
}

// Export pure helpers so tests/build.test.js can verify hash stability,
// hash sensitivity, cache-loader behaviour, and Slack message formatting
// without spawning a full build. Same pattern as menu.js: only run main()
// when invoked directly.
module.exports = {
  compute_commentary_input_hash,
  try_load_cached_commentary,
  format_slack_success,
  format_slack_failure,
};

if (require.main === module) {
  main().catch(async err => {
    console.error('Build failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    // Slack notification on failure. Brief — first line of error to the
    // channel (capped at 200 chars), full stack to local stderr above.
    await send_slack(format_slack_failure({
      total_ms:      _build_t0 ? (Date.now() - _build_t0) : null,
      error_message: err.message || String(err),
    }));
    process.exit(1);
  });
}
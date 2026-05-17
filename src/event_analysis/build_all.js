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

// ── Input config ────────────────────────────────────────────────────────────
const DIR = __dirname;

// All inputs are now pulled live from usat_sales_db.event_data_metrics.
// Default to comparing current year (YEAR_B) vs prior year (YEAR_A).
// Override at the shell: YEAR_B=2027 YEAR_A=2026 node build_all.js
const YEAR_B = Number(process.env.YEAR_B) || new Date().getFullYear();
const YEAR_A = Number(process.env.YEAR_A) || (YEAR_B - 1);

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

async function main() {
  const OUTPUT_DIR = await resolve_output_dir();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out_xlsx = path.join(OUTPUT_DIR, `${YEAR_B}_event_calendar_analysis_${BUILD_TS}.xlsx`);
  const out_pptx = path.join(OUTPUT_DIR, `${YEAR_B}_event_trends_summary_${BUILD_TS}.pptx`);

  console.log('');
  console.log('USAT Sanctioned Events -- Build All');
  console.log('====================================');
  console.log(`  Data source         : usat_sales_db.event_data_metrics`);
  console.log(`  Years               : ${YEAR_A} vs ${YEAR_B}`);
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

  // ── Fetch from usat_sales_db ──────────────────────────────────────────────
  console.log('Fetching events from usat_sales_db...');
  const events_by_year = await fetch_events_for_years([YEAR_A, YEAR_B]);
  console.log(`  ${YEAR_A} rows fetched: ${events_by_year[YEAR_A].length}  |  ${YEAR_B} rows fetched: ${events_by_year[YEAR_B].length}`);

  console.log('Fetching creation pipeline from usat_sales_db...');
  const creation_by_year = await fetch_creation_for_years([YEAR_A, YEAR_B]);
  console.log(`  ${YEAR_A} creation rows: ${creation_by_year[YEAR_A].length}  |  ${YEAR_B} creation rows: ${creation_by_year[YEAR_B].length}`);

  // ── Excel ────────────────────────────────────────────────────────────────
  console.log('Building Excel workbook...');
  const loaded = load_both_years_from_rows(events_by_year[YEAR_A], events_by_year[YEAR_B]);
  loaded.year_a = YEAR_A;
  loaded.year_b = YEAR_B;
  console.log(`  ${YEAR_A} active: ${loaded.y25active.length}  |  ${YEAR_B} active: ${loaded.y26active.length}`);
  const results = run_analysis(loaded);
  results.years = { year_a: YEAR_A, year_b: YEAR_B };
  // Attach creation rows so commentary.js can build pipeline narratives.
  results.creation_rows = { year_a: creation_by_year[YEAR_A], year_b: creation_by_year[YEAR_B] };
  console.log('  Segments:', JSON.stringify(results.segSummary));

  // Export analysis results dataset
  const out_results_json = path.join(OUTPUT_DIR, 'analysis_results.json');
  const results_export = {
    generated_at: new Date().toISOString(),
    years: { year_a: YEAR_A, year_b: YEAR_B },
    totals: { year_a: loaded.y25active.length, year_b: loaded.y26active.length, net: loaded.y26active.length - loaded.y25active.length },
    segments: results.segSummary,
    by_type: results.typeAnnual ?? {},
    monthly: Object.fromEntries(Object.entries(results.monthly ?? {}).map(([m, d]) => [m, { n25: d.n25, n26: d.n26, net_delta: d.netDelta, net_shift: d.netShift, organic_delta: results.calImpact?.[Number(m) - 1]?.orgTotal ?? null }])),
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
      years: { year_a: YEAR_A, year_b: YEAR_B },
      totals: { year_a: loaded.y25active.length, year_b: loaded.y26active.length, net: loaded.y26active.length - loaded.y25active.length },
      data_source: 'usat_sales_db.event_data_metrics',
      exclusion_filter: ['CANCELLED', 'DECLINED', 'DELETED'],
      overrides_applied: results.override_summary?.total_applied ?? 0,
    },
    events: {
      year_a_active:   loaded.y25active.map(serialize_event),
      year_b_active:   loaded.y26active.map(serialize_event),
      year_a_excluded: loaded.y25excluded.map(serialize_event),
      year_b_excluded: loaded.y26excluded.map(serialize_event),
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
      year_a: results.c25 ?? {},
      year_b: results.c26 ?? {},
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
      year_a: creation_by_year[YEAR_A] ?? [],
      year_b: creation_by_year[YEAR_B] ?? [],
    },
    overrides: results.override_summary ?? { total_applied: 0, applied: [], warnings: [] },
  };
  save_json(out_state_json, state_export);
  console.log(`  Analysis state saved:   output/analysis_state.json (${(JSON.stringify(state_export).length / 1024).toFixed(0)} KB)`);

  // ── Generate commentary (rule-based, upgraded to AI if key present) ────────
  const api_key = process.env.ANTHROPIC_API_KEY || null;
  let commentary = null;
  if (api_key && api_key !== 'sk-ant-your-key-here') {
    console.log('  AI commentary enabled -- calling Claude API for insights...');
    try {
      commentary = await generate_ai(results, api_key);
      if (commentary._ai_generated) {
        console.log('  AI commentary generated successfully.');
      }
    } catch (err) {
      console.warn('  AI commentary failed:', err.message, '-- using rule-based fallback');
      commentary = null;
    }
  } else {
    console.log('  Using rule-based commentary (add ANTHROPIC_API_KEY to .env to enable AI insights)');
  }
  // Ensure we always have commentary
  if (!commentary) commentary = generate_rule_based(results);

  // Export commentary dataset
  const out_commentary_json = path.join(OUTPUT_DIR, 'commentary.json');
  save_json(out_commentary_json, {
    generated_at: new Date().toISOString(),
    mode: commentary._ai_generated ? 'ai_claude' : 'rule_based',
    model: commentary._ai_generated ? 'claude-haiku-4-5-20251001' : null,
    ...commentary,
  });
  console.log(`  Commentary saved: output/commentary.json (mode: ${commentary._ai_generated ? 'ai_claude' : 'rule_based'})`);

  // ── Excel (receives commentary for dynamic narrative cells) ───────────────
  await build_workbook(results, out_xlsx, creation_by_year[YEAR_A], creation_by_year[YEAR_B], commentary);
  console.log('  Excel done.\n');

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
- Total: ${results.y25active.length} (prior) → ${results.y26active.length} (current), net ${results.y26active.length - results.y25active.length}
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
  await buildDeck(out_pptx, results, commentary, creation_by_year[YEAR_A], creation_by_year[YEAR_B]);
  console.log('  PowerPoint done.\n');

  // ── HTML dashboard ───────────────────────────────────────────────────────
  const out_dashboard = path.join(OUTPUT_DIR, 'dashboard.html');
  generate_dashboard(results_export, commentary, out_dashboard, results.segments);
  console.log(`  Dashboard: ${out_dashboard}`);

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
      const metric_keys = ['n25', 'n26', 'net', 'attrited', 'new_ev', 'rec', 'repl_rate'];
      const metric_labels = {
        n25: 'Prior-yr events', n26: 'Current-yr events', net: 'Net change',
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
        results.override_summary.applied.forEach(a => diff_lines.push(`  ${a.type}: ${a.sid_25 ?? ''}${a.sid_26 ? '/' + a.sid_26 : ''} → ${a.result}`));
      }

      diff_lines.push('\n' + '='.repeat(60));
      const diff_text = diff_lines.join('\n');
      fs.writeFileSync(path.join(OUTPUT_DIR, 'changes.txt'), diff_text, 'utf8');
      console.log(`  Changes:   output/changes.txt (${metrics_changed} metric change(s), ${narr_changed} narrative change(s))`);
    }
  } catch (err) {
    /* diff is non-fatal */
  }

  console.log('Done!');
  console.log(`  Excel      : ${out_xlsx}`);
  console.log(`  PowerPoint : ${out_pptx}`);
  console.log(`  Results    : ${out_results_json}`);
  console.log(`  Commentary : ${out_commentary_json}`);
}

main().catch(err => {
  console.error('Build failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

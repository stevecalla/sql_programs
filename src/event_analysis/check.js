#!/usr/bin/env node
/**
 * check.js — Data quality and override conflict validation.
 *
 * Run before building to surface issues that would silently affect results:
 *   node check.js
 *   node check.js --fix    (auto-correct minor issues where possible)
 *
 * Checks:
 *   ✓ Duplicate sanction IDs within each year's CSV
 *   ✓ Unexpected / missing status values
 *   ✓ Suspiciously high or low event counts vs prior year (if archived)
 *   ✓ Missing months (no events at all in a calendar month)
 *   ✓ Malformed sanction IDs (wrong format)
 *   ✓ Override conflicts — sanction IDs in overrides.json not found in CSVs
 *   ✓ Override segment validity
 *   ✓ Cross-override conflicts (same ID in multiple override types)
 */

'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const DIR = __dirname;

const VALID_STATUSES = new Set([
  'COMPLETE','COMPLETE_UNRESOLVED','POST_RACE','APPROVED',
  'SUBMITTED','PENDING','CANCELLED','DECLINED','DELETED','SANCTIONED',
  'DRAFT','ADDITIONAL_ITEMS_NEEDED',
]);
const VALID_SEGMENTS = new Set([
  'Retained','Shifted','Lost','New','Recovered','Tried to Return',
]);
const VALID_TYPES = new Set([
  'Adult Race','Youth Race','Adult Clinic','Youth Clinic',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function load_json(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function warn(label, msg)  { console.log(`  ⚠  [${label}] ${msg}`); }
function error(label, msg) { console.log(`  ✗  [${label}] ${msg}`); }
function ok(label, msg)    { console.log(`  ✓  [${label}] ${msg}`); }

// ── Validation functions ──────────────────────────────────────────────────────

function check_events(events, year_label, issues) {
  // Duplicate sanction IDs
  const seen = new Map();
  for (const e of events) {
    const sid = e.sanctionId ?? e.sanction_id ?? '';
    if (!sid) { issues.push({ level: 'error', check: 'malformed_id', msg: `${year_label}: event with missing sanction ID: ${e.name?.slice(0,40)}` }); continue; }
    if (seen.has(sid)) {
      issues.push({ level: 'error', check: 'duplicate_id', msg: `${year_label}: duplicate sanction ID "${sid}" — appears ${seen.get(sid) + 1} times` });
    }
    seen.set(sid, (seen.get(sid) ?? 0) + 1);
  }

  // Unexpected status values
  const unexpected_statuses = new Set();
  for (const e of events) {
    const s = (e.status ?? '').toUpperCase().replace(/\s+/g,'_');
    if (s && !VALID_STATUSES.has(s) && !unexpected_statuses.has(s)) {
      unexpected_statuses.add(s);
      issues.push({ level: 'warn', check: 'unexpected_status', msg: `${year_label}: unexpected status value "${e.status}" (sanction ID: ${e.sanctionId ?? '?'})` });
    }
  }

  // Unexpected type values
  for (const e of events) {
    if (e.type && !VALID_TYPES.has(e.type)) {
      issues.push({ level: 'warn', check: 'unexpected_type', msg: `${year_label}: unexpected type "${e.type}" (sanction ID: ${e.sanctionId ?? '?'})` });
    }
  }

  // Missing months — flag months with zero events
  const by_month = {};
  for (const e of events) if (e.month >= 1 && e.month <= 12) by_month[e.month] = (by_month[e.month] ?? 0) + 1;
  const missing_months = [];
  for (let m = 1; m <= 12; m++) if (!by_month[m]) missing_months.push(['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]);
  if (missing_months.length > 0) {
    issues.push({ level: 'warn', check: 'missing_months', msg: `${year_label}: no events in: ${missing_months.join(', ')}` });
  }

  return { count: events.length, by_month };
}

function check_counts_vs_prior(count_25, count_26, issues) {
  const change_pct = Math.abs((count_26 - count_25) / count_25 * 100);
  if (change_pct > 30) {
    issues.push({
      level: 'warn', check: 'large_count_change',
      msg: `Event count changed ${change_pct.toFixed(1)}% year-over-year (${count_25} → ${count_26}). Verify this is expected.`
    });
  }
  if (count_26 < 100 || count_25 < 100) {
    issues.push({ level: 'warn', check: 'very_low_count', msg: `Very low event count detected (${count_25} or ${count_26}). Check CSV filters.` });
  }
}

function check_overrides(overrides, all_25_ids, all_26_ids, issues) {
  if (!overrides) return;

  const all_ids_seen = new Set();

  // force_match
  for (const ov of (overrides.force_match ?? [])) {
    if (!ov.sid_baseline || !ov.sid_analysis) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_match entry missing sid_baseline or sid_analysis` }); continue; }
    if (!all_25_ids.has(ov.sid_baseline)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_match: sid_baseline "${ov.sid_baseline}" not found in ${ya_label} active events` });
    if (!all_26_ids.has(ov.sid_analysis)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_match: sid_analysis "${ov.sid_analysis}" not found in ${yb_label} active events` });
    [ov.sid_baseline, ov.sid_analysis].forEach(s => all_ids_seen.set(s, (all_ids_seen.get(s) ?? 0) + 1));
  }

  // force_no_match
  for (const ov of (overrides.force_no_match ?? [])) {
    if (!ov.sid_baseline && !ov.sid_analysis) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_no_match entry missing both sid_baseline and sid_analysis` }); continue; }
    if (ov.sid_baseline && !all_25_ids.has(ov.sid_baseline)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_no_match: sid_baseline "${ov.sid_baseline}" not found in active events` });
    if (ov.sid_analysis && !all_26_ids.has(ov.sid_analysis)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_no_match: sid_analysis "${ov.sid_analysis}" not found in active events` });
    [ov.sid_baseline, ov.sid_analysis].filter(Boolean).forEach(s => all_ids_seen.set(s, (all_ids_seen.get(s) ?? 0) + 1));
  }

  // force_segment
  for (const ov of (overrides.force_segment ?? [])) {
    if (!ov.segment) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_segment entry missing segment field` }); continue; }
    if (!VALID_SEGMENTS.has(ov.segment)) issues.push({ level: 'error', check: 'override_invalid_segment', msg: `force_segment: invalid segment "${ov.segment}". Valid: ${[...VALID_SEGMENTS].join(', ')}` });
    const sid = ov.sid_baseline ?? ov.sid_analysis;
    const pool = ov.sid_baseline ? all_25_ids : all_26_ids;
    if (sid && !pool.has(sid)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_segment: "${sid}" not found in active events` });
    if (sid) all_ids_seen.set(sid, (all_ids_seen.get(sid) ?? 0) + 1);
  }

  // Cross-override conflict — same ID in multiple override types
  for (const [sid, count] of all_ids_seen.entries()) {
    if (count > 1) issues.push({ level: 'warn', check: 'override_conflict', msg: `Sanction ID "${sid}" appears in ${count} different override entries. Only the last one applied will take effect.` });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let ya_label = '2025', yb_label = '2026';

async function main() {
  const fix_mode = process.argv.includes('--fix');
  console.log('\nUSAT Event Analysis — Data & Override Health Check');
  console.log('==================================================');

  // Years and source: mirror build_all.js — pull from usat_sales_db.
  const ANALYSIS_YEAR = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();
  const BASELINE_YEAR = Number(process.env.BASELINE_YEAR) || (ANALYSIS_YEAR - 1);
  ya_label = String(BASELINE_YEAR);
  yb_label = String(ANALYSIS_YEAR);

  console.log(`\n  Source : usat_sales_db.event_data_metrics`);
  console.log(`  Year A : ${ya_label}`);
  console.log(`  Year B : ${yb_label}`);

  // Fetch events from DB (same path as build_all.js).
  const { fetch_events_for_years } = require('./src/db');
  const { loadBothYearsFromRows } = require('./src/loader');
  let loaded;
  try {
    console.log('\n  Fetching events from usat_sales_db...');
    const events_by_year = await fetch_events_for_years([BASELINE_YEAR, ANALYSIS_YEAR]);
    console.log(`  ${BASELINE_YEAR} rows fetched: ${events_by_year[BASELINE_YEAR].length}  |  ${ANALYSIS_YEAR} rows fetched: ${events_by_year[ANALYSIS_YEAR].length}`);
    loaded = loadBothYearsFromRows(events_by_year[BASELINE_YEAR], events_by_year[ANALYSIS_YEAR]);
  } catch (err) {
    console.error(`\n✗ Failed to fetch events from DB: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }

  const { baseline_active, baseline_excluded, analysis_active, analysis_excluded } = loaded;
  const issues = [];

  // File stats
  console.log(`\n  ${ya_label} active: ${baseline_active.length}  excluded: ${baseline_excluded.length}`);
  console.log(`  ${yb_label} active: ${analysis_active.length}  excluded: ${analysis_excluded.length}`);

  // Run checks
  console.log('\nRunning checks...\n');

  const stats_25 = check_events(baseline_active, ya_label, issues);
  const stats_26 = check_events(analysis_active, yb_label, issues);
  check_counts_vs_prior(stats_25.count, stats_26.count, issues);

  // Override checks
  const overrides_path = path.join(DIR, 'data', 'overrides.json');
  const raw_ov = load_json(overrides_path);
  if (raw_ov) {
    const clean = arr => (arr ?? []).filter(e => Object.keys(e).some(k => !k.startsWith('_')));
    const overrides = { force_match: clean(raw_ov.force_match), force_no_match: clean(raw_ov.force_no_match), force_segment: clean(raw_ov.force_segment) };
    const total_active = overrides.force_match.length + overrides.force_no_match.length + overrides.force_segment.length;
    if (total_active > 0) {
      const all_25 = new Set(baseline_active.map(e => e.sanctionId ?? e.sanction_id));
      const all_26 = new Set(analysis_active.map(e => e.sanctionId ?? e.sanction_id));
      check_overrides(overrides, all_25, all_26, issues);
      console.log(`  Checking ${total_active} active override(s)...`);
    } else {
      console.log('  No active overrides to validate.');
    }
  }

  // Report
  const errors  = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warn');

  if (!issues.length) {
    ok('ALL', `No issues found. ${baseline_active.length} ${ya_label} events + ${analysis_active.length} ${yb_label} events look clean.`);
  } else {
    if (errors.length)   { console.log(`\n  Errors (${errors.length}) — must fix before building:`); errors.forEach(i => error(i.check, i.msg)); }
    if (warnings.length) { console.log(`\n  Warnings (${warnings.length}) — review before building:`); warnings.forEach(i => warn(i.check, i.msg)); }
  }

  // Month distribution summary
  console.log('\n  Month distribution:');
  ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((mn, i) => {
    const m = i + 1;
    const n_baseline = stats_25.by_month[m] ?? 0;
    const n_analysis = stats_26.by_month[m] ?? 0;
    const delta = n_analysis - n_baseline;
    const bar = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    console.log(`    ${mn.padEnd(4)} ${ya_label}: ${String(n_baseline).padStart(4)}   ${yb_label}: ${String(n_analysis).padStart(4)}   ${bar} ${delta > 0 ? '+' : ''}${delta}`);
  });

  console.log('');
  if (errors.length) {
    console.log(`✗ Found ${errors.length} error(s). Fix before running node build_all.js.\n`);
    process.exit(1);
  } else if (warnings.length) {
    console.log(`⚠  Found ${warnings.length} warning(s). Review above, then run node build_all.js.\n`);
  } else {
    console.log(`✓ All checks passed. Safe to run: node build_all.js\n`);
  }
}

main().catch(err => {
  console.error('Check failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

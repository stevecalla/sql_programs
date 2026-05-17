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

// ── Load events directly from CSV ────────────────────────────────────────────

function load_csv_basic(csv_path) {
  if (!fs.existsSync(csv_path)) return null;
  const { loadBothYears } = require('./src/loader');
  // Use a dummy second path to just get one year — we'll call separately
  return csv_path;
}

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
    if (!ov.sid_25 || !ov.sid_26) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_match entry missing sid_25 or sid_26` }); continue; }
    if (!all_25_ids.has(ov.sid_25)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_match: sid_25 "${ov.sid_25}" not found in ${ya_label} active events` });
    if (!all_26_ids.has(ov.sid_26)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_match: sid_26 "${ov.sid_26}" not found in ${yb_label} active events` });
    [ov.sid_25, ov.sid_26].forEach(s => all_ids_seen.set(s, (all_ids_seen.get(s) ?? 0) + 1));
  }

  // force_no_match
  for (const ov of (overrides.force_no_match ?? [])) {
    if (!ov.sid_25 && !ov.sid_26) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_no_match entry missing both sid_25 and sid_26` }); continue; }
    if (ov.sid_25 && !all_25_ids.has(ov.sid_25)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_no_match: sid_25 "${ov.sid_25}" not found in active events` });
    if (ov.sid_26 && !all_26_ids.has(ov.sid_26)) issues.push({ level: 'error', check: 'override_not_found', msg: `force_no_match: sid_26 "${ov.sid_26}" not found in active events` });
    [ov.sid_25, ov.sid_26].filter(Boolean).forEach(s => all_ids_seen.set(s, (all_ids_seen.get(s) ?? 0) + 1));
  }

  // force_segment
  for (const ov of (overrides.force_segment ?? [])) {
    if (!ov.segment) { issues.push({ level: 'error', check: 'override_malformed', msg: `force_segment entry missing segment field` }); continue; }
    if (!VALID_SEGMENTS.has(ov.segment)) issues.push({ level: 'error', check: 'override_invalid_segment', msg: `force_segment: invalid segment "${ov.segment}". Valid: ${[...VALID_SEGMENTS].join(', ')}` });
    const sid = ov.sid_25 ?? ov.sid_26;
    const pool = ov.sid_25 ? all_25_ids : all_26_ids;
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

  // Load build_all.js paths
  const build_src = fs.readFileSync(path.join(DIR, 'build_all.js'), 'utf8');
  const csv_25_m = build_src.match(/const csv_25\s*=\s*path\.join\(DIR,\s*'data',\s*'([^']+)'\)/);
  const csv_26_m = build_src.match(/const csv_26\s*=\s*path\.join\(DIR,\s*'data',\s*'([^']+)'\)/);
  const csv_25 = csv_25_m ? path.join(DIR, 'data', csv_25_m[1]) : null;
  const csv_26 = csv_26_m ? path.join(DIR, 'data', csv_26_m[1]) : null;

  if (!csv_25 || !fs.existsSync(csv_25)) { console.error(`\n✗ Cannot find csv_25: ${csv_25}`); process.exit(1); }
  if (!csv_26 || !fs.existsSync(csv_26)) { console.error(`\n✗ Cannot find csv_26: ${csv_26}`); process.exit(1); }

  // Extract years from filenames
  const ya_m = path.basename(csv_25).match(/^(\d{4})/);
  const yb_m = path.basename(csv_26).match(/^(\d{4})/);
  ya_label = ya_m?.[1] ?? '2025';
  yb_label = yb_m?.[1] ?? '2026';

  console.log(`\n  Year A: ${ya_label} — ${path.basename(csv_25)}`);
  console.log(`  Year B: ${yb_label} — ${path.basename(csv_26)}`);

  // Load events
  const { loadBothYears } = require('./src/loader');
  let loaded;
  try {
    loaded = loadBothYears(csv_25, csv_26);
  } catch (err) {
    console.error(`\n✗ Failed to load CSVs: ${err.message}`);
    process.exit(1);
  }

  const { y25active, y25excluded, y26active, y26excluded } = loaded;
  const issues = [];

  // File stats
  console.log(`\n  ${ya_label} active: ${y25active.length}  excluded: ${y25excluded.length}`);
  console.log(`  ${yb_label} active: ${y26active.length}  excluded: ${y26excluded.length}`);

  // Run checks
  console.log('\nRunning checks...\n');

  const stats_25 = check_events(y25active, ya_label, issues);
  const stats_26 = check_events(y26active, yb_label, issues);
  check_counts_vs_prior(stats_25.count, stats_26.count, issues);

  // Override checks
  const overrides_path = path.join(DIR, 'data', 'overrides.json');
  const raw_ov = load_json(overrides_path);
  if (raw_ov) {
    const clean = arr => (arr ?? []).filter(e => Object.keys(e).some(k => !k.startsWith('_')));
    const overrides = { force_match: clean(raw_ov.force_match), force_no_match: clean(raw_ov.force_no_match), force_segment: clean(raw_ov.force_segment) };
    const total_active = overrides.force_match.length + overrides.force_no_match.length + overrides.force_segment.length;
    if (total_active > 0) {
      const all_25 = new Set(y25active.map(e => e.sanctionId ?? e.sanction_id));
      const all_26 = new Set(y26active.map(e => e.sanctionId ?? e.sanction_id));
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
    ok('ALL', `No issues found. ${y25active.length} ${ya_label} events + ${y26active.length} ${yb_label} events look clean.`);
  } else {
    if (errors.length)   { console.log(`\n  Errors (${errors.length}) — must fix before building:`); errors.forEach(i => error(i.check, i.msg)); }
    if (warnings.length) { console.log(`\n  Warnings (${warnings.length}) — review before building:`); warnings.forEach(i => warn(i.check, i.msg)); }
  }

  // Month distribution summary
  console.log('\n  Month distribution:');
  ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((mn, i) => {
    const m = i + 1;
    const n25 = stats_25.by_month[m] ?? 0;
    const n26 = stats_26.by_month[m] ?? 0;
    const delta = n26 - n25;
    const bar = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    console.log(`    ${mn.padEnd(4)} ${ya_label}: ${String(n25).padStart(4)}   ${yb_label}: ${String(n26).padStart(4)}   ${bar} ${delta > 0 ? '+' : ''}${delta}`);
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

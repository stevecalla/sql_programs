/**
 * migrate_overrides_to_db.js — one-shot migration that imports any active
 * entries from data/overrides.json into the event_analysis_overrides table.
 *
 * Idempotent. Safe to run any number of times:
 *   - already-present rows in the DB are skipped (matched on type + sid pair + segment)
 *   - if no active entries are found in the JSON, the file is left alone
 *   - after a successful import where at least one entry was processed, the
 *     JSON is renamed to `overrides.json.migrated` so future builds skip it
 *
 * Runs automatically from build_all.js after ensure_overrides_table().
 * Can also be invoked manually:
 *
 *   node src/event_analysis/utilities/migrate_overrides_to_db.js
 *
 * Flags:
 *   --dry-run      report what would happen without inserting or renaming
 *   --no-rename    apply inserts but leave the JSON file in place
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');

const JSON_PATH     = path.join(__dirname, '..', 'data', 'overrides.json');
const MIGRATED_PATH = path.join(__dirname, '..', 'data', 'overrides.json.migrated');

const VALID_SEGMENTS = new Set([
  'Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return',
]);
// Legacy support — the old code used "Attrited" before the rename to "Lost".
const LEGACY_SEGMENT_ALIASES = { 'Attrited': 'Lost' };

// ── JSON parsing helpers ──────────────────────────────────────────────────

/** A JSON entry is "active" if at least one of its keys is NOT prefixed with `_`. */
function is_active_entry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return Object.keys(entry).some(k => !k.startsWith('_'));
}

/** Pull every active entry out of a JSON array, returning normalized objects. */
function extract_active(arr) {
  return (arr ?? []).filter(is_active_entry).map(e => ({
    sid_baseline:  e.sid_baseline  ?? null,
    sid_analysis:  e.sid_analysis  ?? null,
    segment: normalize_segment(e.segment),
    note:    e.note    ?? null,
  }));
}

function normalize_segment(seg) {
  if (!seg) return null;
  const remapped = LEGACY_SEGMENT_ALIASES[seg] ?? seg;
  return VALID_SEGMENTS.has(remapped) ? remapped : remapped;  // pass through; DB ENUM rejects invalid values
}

// ── DB upsert ──────────────────────────────────────────────────────────────

/**
 * Insert a single override into the DB if an equivalent active row doesn't
 * already exist. Returns 'inserted' or 'skipped'.
 */
async function upsert_override(conn, override_type, sid_baseline, sid_analysis, segment, note, baseline_year, analysis_year) {
  // Identity test: same override_type + sid pair (+ segment for force_segment)
  // (+ year scope) and currently active. Year columns are part of the identity
  // so the same pair can exist under different year comparisons.
  const conditions = ['override_type = ?', 'active = 1'];
  const args = [override_type];

  if (sid_baseline === null) conditions.push('sid_baseline IS NULL');
  else { conditions.push('sid_baseline = ?'); args.push(sid_baseline); }

  if (sid_analysis === null) conditions.push('sid_analysis IS NULL');
  else { conditions.push('sid_analysis = ?'); args.push(sid_analysis); }

  if (override_type === 'force_segment') {
    if (segment === null) conditions.push('segment IS NULL');
    else { conditions.push('segment = ?'); args.push(segment); }
  }

  // Year scope — both null → "global" overrides; otherwise must match.
  if (baseline_year === null) conditions.push('baseline_year IS NULL');
  else { conditions.push('baseline_year = ?'); args.push(baseline_year); }

  if (analysis_year === null) conditions.push('analysis_year IS NULL');
  else { conditions.push('analysis_year = ?'); args.push(analysis_year); }

  const [rows] = await conn.query(
    `SELECT id FROM event_analysis_overrides WHERE ${conditions.join(' AND ')} LIMIT 1`,
    args
  );
  if (rows.length > 0) return 'skipped';

  await conn.query(
    `INSERT INTO event_analysis_overrides
       (override_type, sid_baseline, sid_analysis, segment, note, baseline_year, analysis_year, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'json_migration')`,
    [override_type, sid_baseline, sid_analysis, segment, note, baseline_year, analysis_year]
  );
  return 'inserted';
}

// ── Main migration ────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {boolean} [opts.silent=false]    suppress console output (still returns summary)
 * @param {boolean} [opts.dry_run=false]   read + report only; no DB writes, no rename
 * @param {boolean} [opts.rename=true]     rename the JSON file after a successful migration
 * @returns {Promise<{found:number, inserted:number, skipped:number, renamed:boolean}>}
 */
async function migrate_overrides_json_to_db({
  silent  = false,
  dry_run = false,
  rename  = true,
} = {}) {
  // Already migrated previously? Quiet no-op.
  if (!fs.existsSync(JSON_PATH)) {
    if (!silent) {
      if (fs.existsSync(MIGRATED_PATH)) {
        // Don't say anything — this is the steady state after migration.
      } else {
        console.log('  (no data/overrides.json found; nothing to migrate)');
      }
    }
    return { found: 0, inserted: 0, skipped: 0, renamed: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } catch (err) {
    console.warn(`  ⚠ overrides.json is malformed (${err.message}); skipping migration`);
    return { found: 0, inserted: 0, skipped: 0, renamed: false };
  }

  const fm  = extract_active(parsed.force_match);
  const fnm = extract_active(parsed.force_no_match);
  const fs2 = extract_active(parsed.force_segment);
  const found = fm.length + fnm.length + fs2.length;

  if (found === 0) {
    // No active entries — the JSON is templates/comments only. Leave it alone.
    if (!silent) console.log('  (overrides.json has no active entries; nothing to migrate)');
    return { found: 0, inserted: 0, skipped: 0, renamed: false };
  }

  if (!silent) {
    console.log(`  Migrating overrides from JSON → DB${dry_run ? ' (DRY-RUN)' : ''}: ${found} active entries...`);
  }

  // Year scope for newly-inserted rows comes from env vars set by build_all.js
  // (or the current calendar year if run standalone).
  const analysis_year = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();
  const baseline_year = Number(process.env.BASELINE_YEAR) || (analysis_year - 1);

  let inserted = 0, skipped = 0;
  if (!dry_run) {
    const cfg  = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      for (const e of fm) {
        const r = await upsert_override(conn, 'force_match',   e.sid_baseline, e.sid_analysis, null,     e.note, baseline_year, analysis_year);
        if (r === 'inserted') inserted++; else skipped++;
      }
      for (const e of fnm) {
        const r = await upsert_override(conn, 'force_no_match', e.sid_baseline, e.sid_analysis, null,     e.note, baseline_year, analysis_year);
        if (r === 'inserted') inserted++; else skipped++;
      }
      for (const e of fs2) {
        const r = await upsert_override(conn, 'force_segment',  e.sid_baseline, e.sid_analysis, e.segment, e.note, baseline_year, analysis_year);
        if (r === 'inserted') inserted++; else skipped++;
      }
    } finally {
      await conn.end();
    }
  } else {
    // Dry-run: assume every active entry is new
    inserted = found;
  }

  let renamed = false;
  if (!dry_run && rename && (inserted + skipped) === found) {
    try {
      fs.renameSync(JSON_PATH, MIGRATED_PATH);
      renamed = true;
    } catch (err) {
      console.warn(`  ⚠ Migration succeeded but rename to overrides.json.migrated failed: ${err.message}`);
    }
  }

  if (!silent) {
    console.log(`  ✓ Migration${dry_run ? ' (dry-run)' : ''}: ${inserted} inserted (scoped to baseline_year=${baseline_year}, analysis_year=${analysis_year}), ${skipped} already in DB${dry_run ? '' : '.'}`);
    if (renamed) console.log(`  ✓ Renamed data/overrides.json → data/overrides.json.migrated (JSON is now historical).`);
  }

  return { found, inserted, skipped, renamed };
}

// ── CLI entry point ──────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const dry_run = args.includes('--dry-run');
  const rename  = !args.includes('--no-rename');
  migrate_overrides_json_to_db({ dry_run, rename }).catch(err => {
    console.error('✗ Migration failed:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { migrate_overrides_json_to_db };

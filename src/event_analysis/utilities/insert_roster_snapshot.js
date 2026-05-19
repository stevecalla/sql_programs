/**
 * insert_roster_snapshot.js — write the full event roster from a single
 * build into event_analysis_roster, tagged with `build_at`.
 *
 * Called from build_all.js after run_analysis() completes, with the same
 * `results` object that feeds the dashboard / Excel / PowerPoint outputs.
 * The roster shape mirrors what's in dashboard.html's `ROSTER` constant
 * exactly — segments × match records, one event per row.
 *
 * Defensive on every front: never fails the build. If the DB connection
 * fails, the table is missing, or the insert errors out, we log a
 * warning and return 0. The build's primary outputs (HTML/xlsx/pptx)
 * don't depend on this — it's a secondary historical snapshot.
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');
const { TABLE_NAME } = require('./ensure_roster_table');

const MN_MAP  = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MAP = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Same SEG iteration order + js_key mapping the dashboard uses — guarantees
// the roster we INSERT matches what the dashboard renders.
const SEG_ORDER = ['Retained', 'Shifted', 'Tried to Return', 'Lost', 'Recovered', 'New'];
function js_key_for(seg) {
  if (seg === 'Tried to Return') return 'triedToReturn';
  if (seg === 'Lost')            return 'attrited';
  return seg.toLowerCase();
}

/**
 * Normalize a startDate (Date | string | null) into a 'YYYY-MM-DD' or null.
 * MySQL DATE columns accept the string form directly.
 */
function date_str(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function day_of(date_string) {
  if (!date_string) return null;
  try {
    return DAY_MAP[new Date(date_string).getDay()] ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the array of row-tuples to bulk-insert. Exported for testing — the
 * tests pass a synthetic segments object and assert the row count / shape
 * without touching MySQL.
 *
 * @param {object} results            — full results object from run_analysis()
 * @param {Date}   build_at           — the canonical build timestamp
 * @param {number} baseline_year
 * @param {number} analysis_year
 * @returns {Array<Array>}            — N rows, each a 21-element tuple matching
 *                                       the column order in roster_columns() below.
 */
function build_roster_rows(results, build_at, baseline_year, analysis_year) {
  const segments_raw = results?.segments;
  if (!segments_raw) return [];

  const rows = [];
  for (const seg_key of SEG_ORDER) {
    const items = segments_raw[js_key_for(seg_key)] ?? [];
    for (const m of items) {
      const e25 = m.e25, e26 = m.e26;
      const d25 = date_str(e25?.startDate);
      const d26 = date_str(e26?.startDate);
      rows.push([
        build_at,
        baseline_year,
        analysis_year,
        m.seg ?? seg_key,
        m.conf ?? '?',
        e25?.type ?? e26?.type ?? '',
        m.override_id ?? null,
        e25?.sanctionId ?? null,
        e25?.name ?? null,
        e25?.month ? MN_MAP[e25.month] : null,
        d25,
        day_of(d25),
        e25?.status ?? null,
        e26?.sanctionId ?? null,
        e26?.name ?? null,
        e26?.month ? MN_MAP[e26.month] : null,
        d26,
        day_of(d26),
        e26?.status ?? null,
        1,        // schema_version
        null,     // extras_json — empty for v1
      ]);
    }
  }
  return rows;
}

/**
 * The column list in INSERT order. Used by `insert_roster_snapshot` AND
 * by tests that need to know which index in a row-tuple corresponds to
 * which field.
 */
function roster_columns() {
  return [
    'build_at', 'baseline_year', 'analysis_year',
    'seg', 'conf', 'type', 'override_id',
    'sid_baseline', 'name_baseline', 'month_baseline', 'date_baseline', 'day_baseline', 'status_baseline',
    'sid_analysis', 'name_analysis', 'month_analysis', 'date_analysis', 'day_analysis', 'status_analysis',
    'schema_version', 'extras_json',
  ];
}

/**
 * Insert the full roster snapshot. Returns the number of rows inserted, or
 * 0 on any failure (logs a warning — doesn't throw).
 *
 * @param {object} opts
 * @param {object} opts.results
 * @param {Date}   opts.build_at
 * @param {number} opts.baseline_year
 * @param {number} opts.analysis_year
 * @param {boolean} [opts.silent=false]
 */
async function insert_roster_snapshot({ results, build_at, baseline_year, analysis_year, silent = false }) {
  const rows = build_roster_rows(results, build_at, baseline_year, analysis_year);
  if (rows.length === 0) {
    if (!silent) console.warn('  Roster snapshot: empty roster, nothing to insert.');
    return 0;
  }

  const cols = roster_columns();
  let conn;
  try {
    const cfg = await local_usat_sales_db_config();
    conn = await mysqlP.createConnection(cfg);
    const sql = `INSERT INTO \`${TABLE_NAME}\` (${cols.map(c => '`' + c + '`').join(', ')}) VALUES ?`;
    const [result] = await conn.query(sql, [rows]);
    if (!silent) {
      console.log(`  Roster snapshot saved: ${result.affectedRows} rows → ${TABLE_NAME} (build_at = ${build_at.toISOString()})`);
    }
    return result.affectedRows;
  } catch (err) {
    if (!silent) console.warn(`  Roster snapshot failed (non-fatal): ${err.message}`);
    return 0;
  } finally {
    if (conn) {
      try { await conn.end(); } catch { /* ignore */ }
    }
  }
}

module.exports = {
  build_roster_rows,
  roster_columns,
  insert_roster_snapshot,
};

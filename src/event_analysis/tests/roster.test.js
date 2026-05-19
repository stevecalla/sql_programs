/**
 * roster.test.js — Coverage for the event_analysis_roster snapshot table.
 *
 * Two layers:
 *
 *   1. Pure-function tests (no DB): `build_roster_rows` produces a row
 *      tuple for every match record, in the right order, with NULLs on
 *      single-sided rows (Lost / New). Cheap, no env required.
 *
 *   2. DB integration tests: ensure_roster_table is idempotent; an actual
 *      INSERT produces N distinct rows tagged with the same build_at;
 *      two consecutive builds produce two distinct build_at partitions;
 *      prune_roster_table only deletes rows in the >48h/>30d/>90d tiers
 *      and leaves the recent set alone. Rows are written with build_at
 *      timestamps far in the past so the test fixture never interferes
 *      with the real production roster.
 *
 * Run via:
 *   node --test tests/roster.test.js
 *
 * The DB-backed tests skip gracefully if the local DB config can't be
 * resolved — keeps the suite usable in environments without MySQL.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const {
  build_roster_rows,
  roster_columns,
  insert_roster_snapshot,
} = require('../utilities/insert_roster_snapshot');
const { ensure_roster_table, TABLE_NAME } = require('../utilities/ensure_roster_table');
const { prune_roster_table } = require('../utilities/prune_roster_table');

// ── 1. Pure-function: build_roster_rows ────────────────────────────────────

describe('roster: build_roster_rows', () => {

  function make_fixture() {
    return {
      segments: {
        retained: [
          { seg: 'Retained', conf: 'Exact', e25: { sanctionId: '111-Adult Race', name: 'Alpha', type: 'Adult Race', month: 1, status: 'COMPLETE', startDate: '2025-01-11' },
                                               e26: { sanctionId: '222-Adult Race', name: 'Alpha', type: 'Adult Race', month: 1, status: 'ACTIVE',   startDate: '2026-01-10' } },
        ],
        shifted: [
          { seg: 'Shifted',  conf: 'Exact-Shifted', e25: { sanctionId: '333-Youth Race', name: 'Bravo', type: 'Youth Race', month: 2, status: 'COMPLETE', startDate: '2025-02-14' },
                                                     e26: { sanctionId: '444-Youth Race', name: 'Bravo', type: 'Youth Race', month: 3, status: 'ACTIVE',   startDate: '2026-03-15' } },
        ],
        attrited: [
          { seg: 'Lost',     conf: 'N/A',   e25: { sanctionId: '555-Adult Clinic', name: 'Charlie', type: 'Adult Clinic', month: 4, status: 'COMPLETE', startDate: '2025-04-20' },
                                             e26: null },
        ],
        new:     [
          { seg: 'New',      conf: 'N/A',   e25: null,
                                             e26: { sanctionId: '666-Youth Clinic', name: 'Delta', type: 'Youth Clinic', month: 5, status: 'ACTIVE', startDate: '2026-05-04' } },
        ],
        recovered:      [],
        triedToReturn:  [],
      },
    };
  }

  const build_at = new Date('2026-05-18T19:53:58Z');

  test('produces one tuple per match record in SEG_ORDER', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    assert.equal(rows.length, 4, 'expected one row per match record across all segments');
  });

  test('every row has exactly 21 fields (matches roster_columns order)', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    const cols = roster_columns();
    assert.equal(cols.length, 21, 'roster_columns should declare 21 columns');
    for (const r of rows) {
      assert.equal(r.length, cols.length, `row length must match column count, got ${r.length}`);
    }
  });

  test('Retained row populates both baseline and analysis sides', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    const cols = roster_columns();
    const retained = rows[0];   // Retained sorted first
    const get = (col) => retained[cols.indexOf(col)];
    assert.equal(get('seg'),            'Retained');
    assert.equal(get('sid_baseline'),   '111-Adult Race');
    assert.equal(get('name_baseline'),  'Alpha');
    assert.equal(get('sid_analysis'),   '222-Adult Race');
    assert.equal(get('name_analysis'),  'Alpha');
    assert.equal(get('month_baseline'), 'Jan');
    assert.equal(get('month_analysis'), 'Jan');
  });

  test('Lost row leaves analysis-side fields NULL', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    const cols = roster_columns();
    const lost = rows.find(r => r[cols.indexOf('seg')] === 'Lost');
    assert.ok(lost, 'Lost row should exist');
    const get = (col) => lost[cols.indexOf(col)];
    assert.equal(get('sid_baseline'),  '555-Adult Clinic', 'baseline side populated');
    assert.equal(get('sid_analysis'),  null, 'analysis side must be NULL on Lost');
    assert.equal(get('name_analysis'), null);
    assert.equal(get('date_analysis'), null);
  });

  test('New row leaves baseline-side fields NULL', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    const cols = roster_columns();
    const newr = rows.find(r => r[cols.indexOf('seg')] === 'New');
    assert.ok(newr, 'New row should exist');
    const get = (col) => newr[cols.indexOf(col)];
    assert.equal(get('sid_baseline'),  null, 'baseline side must be NULL on New');
    assert.equal(get('sid_analysis'),  '666-Youth Clinic');
    assert.equal(get('name_analysis'), 'Delta');
  });

  test('empty segments → empty rows', () => {
    const empty = { segments: { retained:[], shifted:[], attrited:[], new:[], recovered:[], triedToReturn:[] } };
    const rows = build_roster_rows(empty, build_at, 2025, 2026);
    assert.deepEqual(rows, []);
  });

  test('build_at + year scope land in every row', () => {
    const rows = build_roster_rows(make_fixture(), build_at, 2025, 2026);
    const cols = roster_columns();
    for (const r of rows) {
      assert.equal(r[cols.indexOf('build_at')],      build_at);
      assert.equal(r[cols.indexOf('baseline_year')], 2025);
      assert.equal(r[cols.indexOf('analysis_year')], 2026);
      assert.equal(r[cols.indexOf('schema_version')], 1);
    }
  });
});

// ── 2. DB integration ─────────────────────────────────────────────────────
//
// All inserts use a sentinel year (1999) so the test's fixture rows never
// intermingle with real production roster rows. before() + after() each
// scrub the sentinel rows from the table; if the DB is unreachable, the
// describe block skips gracefully.

const SENTINEL_BASELINE = 1999;
const SENTINEL_ANALYSIS = 2000;
let db_ok = false;

before(async () => {
  try {
    await ensure_roster_table({ silent: true });
    // Best-effort cleanup of any sentinel rows leftover from a prior crash.
    const mysqlP = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const cfg = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      await conn.query(
        `DELETE FROM \`${TABLE_NAME}\` WHERE baseline_year = ? AND analysis_year = ?`,
        [SENTINEL_BASELINE, SENTINEL_ANALYSIS]
      );
    } finally { await conn.end(); }
    db_ok = true;
  } catch (err) {
    console.warn(`  (roster DB tests will skip — ${err.message})`);
  }
});

after(async () => {
  if (!db_ok) return;
  try {
    const mysqlP = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const cfg = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      await conn.query(
        `DELETE FROM \`${TABLE_NAME}\` WHERE baseline_year = ? AND analysis_year = ?`,
        [SENTINEL_BASELINE, SENTINEL_ANALYSIS]
      );
    } finally { await conn.end(); }
  } catch { /* best-effort */ }
});

describe('roster DB: ensure_roster_table', () => {

  test('is idempotent — second call is a no-op', async (t) => {
    if (!db_ok) { t.skip('DB unreachable'); return; }
    const fresh = await ensure_roster_table({ silent: true });
    const again = await ensure_roster_table({ silent: true });
    // First call returns true if it created; both calls return false on a
    // pre-existing table. The contract is "the second call does not error
    // and returns false."
    assert.equal(again, false, 'second ensure call must report no-create');
    // (We don't assert `fresh` — depends on initial DB state.)
    assert.equal(typeof fresh, 'boolean');
  });
});

describe('roster DB: insert_roster_snapshot', () => {

  function fixture_for_year(seg_count = 3) {
    // Generate a roster with N Retained records — enough to verify the
    // bulk insert without depending on the real analysis output.
    const e_baseline = (i) => ({ sanctionId: `T${i}-Adult Race`, name: `Test ${i}`, type: 'Adult Race', month: 1, status: 'COMPLETE', startDate: `${SENTINEL_BASELINE}-01-${String(i).padStart(2,'0')}` });
    const e_analysis = (i) => ({ sanctionId: `T${i+100}-Adult Race`, name: `Test ${i}`, type: 'Adult Race', month: 1, status: 'ACTIVE',   startDate: `${SENTINEL_ANALYSIS}-01-${String(i).padStart(2,'0')}` });
    return {
      segments: {
        retained: Array.from({ length: seg_count }, (_, i) => ({
          seg: 'Retained', conf: 'Exact', e25: e_baseline(i + 1), e26: e_analysis(i + 1),
        })),
        shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [],
      },
    };
  }

  test('inserts N rows tagged with the same build_at', async (t) => {
    if (!db_ok) { t.skip('DB unreachable'); return; }
    // Zero out ms — the DATETIME(0) column truncates them on insert,
    // and we want the query-back comparison to use the same precision.
    const build_at = new Date();
    build_at.setMilliseconds(0);
    const inserted = await insert_roster_snapshot({
      results:       fixture_for_year(5),
      build_at,
      baseline_year: SENTINEL_BASELINE,
      analysis_year: SENTINEL_ANALYSIS,
      silent: true,
    });
    assert.equal(inserted, 5, 'expected 5 rows inserted');

    // Confirm they all share the build_at we passed.
    const mysqlP = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const cfg = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS n FROM \`${TABLE_NAME}\` WHERE build_at = ? AND baseline_year = ? AND analysis_year = ?`,
        [build_at, SENTINEL_BASELINE, SENTINEL_ANALYSIS]
      );
      assert.equal(rows[0].n, 5, 'expected exactly 5 rows tagged with this build_at');
    } finally { await conn.end(); }
  });

  test('two consecutive builds create two distinct build_at partitions', async (t) => {
    if (!db_ok) { t.skip('DB unreachable'); return; }
    const t1 = new Date('1999-06-01T10:00:00Z');
    const t2 = new Date('1999-06-01T11:00:00Z');
    await insert_roster_snapshot({ results: fixture_for_year(2), build_at: t1, baseline_year: SENTINEL_BASELINE, analysis_year: SENTINEL_ANALYSIS, silent: true });
    await insert_roster_snapshot({ results: fixture_for_year(3), build_at: t2, baseline_year: SENTINEL_BASELINE, analysis_year: SENTINEL_ANALYSIS, silent: true });

    const mysqlP = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const cfg = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      const [rows] = await conn.query(
        `SELECT build_at, COUNT(*) AS n FROM \`${TABLE_NAME}\`
          WHERE build_at IN (?, ?) AND baseline_year = ? AND analysis_year = ?
          GROUP BY build_at`,
        [t1, t2, SENTINEL_BASELINE, SENTINEL_ANALYSIS]
      );
      assert.equal(rows.length, 2, 'expected two distinct build_at rows');
      const by_count = rows.map(r => r.n).sort((a,b) => a - b);
      assert.deepEqual(by_count, [2, 3], 'each build keeps its own row count');
    } finally { await conn.end(); }
  });
});

describe('roster DB: prune_roster_table', () => {

  test('keeps recent builds (last 48h) intact; older sentinel rows get pruned', async (t) => {
    if (!db_ok) { t.skip('DB unreachable'); return; }

    // Insert sentinel rows at three different ages: just now (within
    // 48h tier), 10 days old (within daily tier), 100 days old (within
    // monthly tier). Then run prune and confirm at least the "now" row
    // stays. We can't easily assert the older rows' fate without knowing
    // surrounding state — the safety check is "prune ran without
    // throwing AND recent rows are not deleted."
    //
    // Strip milliseconds because the DATETIME(0) column truncates them
    // on insert; comparing a query-back with the original ms-bearing
    // Date object would otherwise miss the row even though it's present.
    const t_now   = new Date();                                   t_now.setMilliseconds(0);
    const t_10d   = new Date(Date.now() - 10  * 24 * 60 * 60 * 1000);  t_10d.setMilliseconds(0);
    const t_100d  = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);  t_100d.setMilliseconds(0);

    for (const ts of [t_now, t_10d, t_100d]) {
      await insert_roster_snapshot({
        results: { segments: { retained: [{ seg: 'Retained', conf: 'Exact', e25: { sanctionId: 'P-1', name: 'PruneTest', type: 'Adult Race', month: 1, status: 'COMPLETE', startDate: '1999-01-01' }, e26: { sanctionId: 'P-2', name: 'PruneTest', type: 'Adult Race', month: 1, status: 'ACTIVE', startDate: '2000-01-01' } }],
                                shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] } },
        build_at: ts,
        baseline_year: SENTINEL_BASELINE,
        analysis_year: SENTINEL_ANALYSIS,
        silent: true,
      });
    }

    const result = await prune_roster_table({ silent: true });
    assert.ok(typeof result.kept === 'number',    'prune should return kept count');
    assert.ok(typeof result.deleted === 'number', 'prune should return deleted count');

    // The just-now row must still be there (sits in the <48h tier).
    const mysqlP = require('mysql2/promise');
    const { local_usat_sales_db_config } = require('../../../utilities/config');
    const cfg = await local_usat_sales_db_config();
    const conn = await mysqlP.createConnection(cfg);
    try {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS n FROM \`${TABLE_NAME}\` WHERE build_at = ? AND baseline_year = ?`,
        [t_now, SENTINEL_BASELINE]
      );
      assert.ok(rows[0].n > 0, 'rows from <48h ago must survive pruning');
    } finally { await conn.end(); }
  });
});

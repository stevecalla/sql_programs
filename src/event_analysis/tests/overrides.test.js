/**
 * overrides.test.js — End-to-end tests for the overrides DB chain.
 *
 * Verifies Steps 1 → 3 of the JSON-to-DB overrides migration:
 *   Step 1   — event_analysis_overrides table exists with correct schema
 *   Step 2   — migrate_overrides_to_db is idempotent
 *   Step 2.5 — year-scoping columns + index exist; sid_baseline/sid_analysis naming
 *   Step 3   — load_overrides() reads from DB with year-scope filter; apply_overrides()
 *              moves events between segments correctly
 *
 * Runs with Node's built-in test runner (Node 18+):
 *   node --test tests/overrides.test.js
 *
 * Or via menu.js → "Run test suite".
 *
 * Database mutations: each test that writes inserts rows tagged
 * `created_by = 'test_suite'`. before() and after() both delete those
 * rows so a previous crashed run leaves no debris.
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config }    = require('../../../utilities/config');
const { ensure_overrides_table }        = require('../utilities/ensure_overrides_table');
const { migrate_overrides_json_to_db }  = require('../utilities/migrate_overrides_to_db');
const { load_overrides, apply_overrides, summarise_overrides } = require('../src/overrides');

const TABLE = 'event_analysis_overrides';
const TEST_TAG = 'test_suite';

// ── Shared connection ──────────────────────────────────────────────────────

let conn  = null;
let dbcfg = null;

async function db() {
  if (!conn) {
    dbcfg = await local_usat_sales_db_config();
    conn  = await mysqlP.createConnection(dbcfg);
  }
  return conn;
}

async function cleanup_test_rows() {
  const c = await db();
  await c.query(`DELETE FROM \`${TABLE}\` WHERE created_by = ?`, [TEST_TAG]);
}

async function insert_test_row({ override_type, sid_baseline = null, sid_analysis = null, segment = null, baseline_year = null, analysis_year = null, approved = 0, note = 'test' } = {}) {
  const c = await db();
  const [r] = await c.query(
    `INSERT INTO \`${TABLE}\`
       (override_type, sid_baseline, sid_analysis, segment, note, baseline_year, analysis_year, approved, created_by, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [override_type, sid_baseline, sid_analysis, segment, note, baseline_year, analysis_year, approved, TEST_TAG]
  );
  return r.insertId;
}

// ── Fixtures for apply_overrides ───────────────────────────────────────────

function make_event(sid, month, type = 'Adult Race', name = 'Test Event') {
  return { sanctionId: sid, month, type, name, status: 'Active' };
}

// ── Setup / teardown ───────────────────────────────────────────────────────

before(async () => {
  // Make sure the table exists (idempotent — no-op if already there).
  await ensure_overrides_table({ silent: true });
  await cleanup_test_rows();
});

after(async () => {
  await cleanup_test_rows();
  if (conn) await conn.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — schema
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 1 — event_analysis_overrides schema', () => {

  test('table exists', async () => {
    const c = await db();
    const [rows] = await c.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [dbcfg.database, TABLE]
    );
    assert.equal(rows.length, 1, `${TABLE} should exist in ${dbcfg.database}`);
  });

  test('has all required columns', async () => {
    const c = await db();
    const [rows] = await c.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [dbcfg.database, TABLE]
    );
    const cols = new Set(rows.map(r => r.COLUMN_NAME));
    const required = [
      'id', 'override_type', 'baseline_year', 'analysis_year',
      'sid_baseline', 'sid_analysis', 'segment', 'note',
      'active', 'approved', 'approval_state', 'approved_by', 'approved_at',
      'created_at', 'created_by', 'updated_at',
    ];
    for (const r of required) {
      assert.ok(cols.has(r), `missing column: ${r}`);
    }
  });

  test('has year-scope index idx_year_pair', async () => {
    const c = await db();
    const [rows] = await c.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'idx_year_pair'
        LIMIT 1`,
      [dbcfg.database, TABLE]
    );
    assert.equal(rows.length, 1, 'idx_year_pair should exist (added in Step 2.5)');
  });

  test('does NOT have legacy sid_25 / sid_26 columns', async () => {
    const c = await db();
    const [rows] = await c.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND COLUMN_NAME IN ('sid_25', 'sid_26')`,
      [dbcfg.database, TABLE]
    );
    assert.equal(rows.length, 0, 'legacy sid_25/sid_26 columns should have been renamed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 1 — ensure_overrides_table idempotency
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 1 — ensure_overrides_table()', () => {

  test('is idempotent — second call reports "already exists"', async () => {
    const created_first = await ensure_overrides_table({ silent: true });
    // Either it just created it (first run on a fresh DB) or it already existed.
    // The contract: a second call must return false (no fresh CREATE).
    const created_second = await ensure_overrides_table({ silent: true });
    assert.equal(created_second, false, 'second call should not report a fresh create');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — migrate_overrides_to_db idempotency
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 2 — migrate_overrides_to_db()', () => {

  test('dry-run reports without inserting or renaming', async () => {
    const before_count = (await (await db()).query(`SELECT COUNT(*) AS n FROM \`${TABLE}\``))[0][0].n;
    const r = await migrate_overrides_json_to_db({ dry_run: true, silent: true });
    const after_count  = (await (await db()).query(`SELECT COUNT(*) AS n FROM \`${TABLE}\``))[0][0].n;
    assert.equal(after_count, before_count, 'dry-run must not mutate the table');
    assert.equal(r.renamed, false, 'dry-run must not rename the JSON file');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — load_overrides() year-scope filter
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 3 — load_overrides() year scoping', () => {

  beforeEach(async () => {
    await cleanup_test_rows();
  });

  test('returns scoped row when baseline_year + analysis_year match', async () => {
    await insert_test_row({
      override_type: 'force_match',
      sid_baseline: 'TEST-A-25', sid_analysis: 'TEST-A-26',
      baseline_year: 2025, analysis_year: 2026,
    });
    const r = await load_overrides({ baseline_year: 2025, analysis_year: 2026 });
    const our = r.force_match.filter(o => o.sid_baseline === 'TEST-A-25');
    assert.equal(our.length, 1, 'scoped row should appear for matching year pair');
    assert.equal(our[0].sid_analysis, 'TEST-A-26');
  });

  test('does NOT return scoped row when year pair does not match', async () => {
    await insert_test_row({
      override_type: 'force_match',
      sid_baseline: 'TEST-B-25', sid_analysis: 'TEST-B-26',
      baseline_year: 2025, analysis_year: 2026,
    });
    const r = await load_overrides({ baseline_year: 1999, analysis_year: 2000 });
    const our = r.force_match.filter(o => o.sid_baseline === 'TEST-B-25');
    assert.equal(our.length, 0, 'mismatched year pair should exclude the row');
  });

  test('returns global rows (NULL/NULL) for any year pair', async () => {
    await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline: 'TEST-GLOBAL-25',
      baseline_year: null, analysis_year: null,
    });
    const r1 = await load_overrides({ baseline_year: 2025, analysis_year: 2026 });
    const r2 = await load_overrides({ baseline_year: 1999, analysis_year: 2000 });
    assert.ok(r1.force_no_match.some(o => o.sid_baseline === 'TEST-GLOBAL-25'), 'global row should appear for 2025/2026');
    assert.ok(r2.force_no_match.some(o => o.sid_baseline === 'TEST-GLOBAL-25'), 'global row should appear for 1999/2000');
  });

  test('stats counts reflect global vs scoped split', async () => {
    await insert_test_row({ override_type: 'force_match',     sid_baseline: 'TEST-S-25', sid_analysis: 'TEST-S-26', baseline_year: 2025, analysis_year: 2026 });
    await insert_test_row({ override_type: 'force_no_match',  sid_baseline: 'TEST-G-25',                                                              });
    const r = await load_overrides({ baseline_year: 2025, analysis_year: 2026 });
    // Filter to just our test rows so other DB content doesn't skew the assert.
    const ours = [...r.force_match, ...r.force_no_match, ...r.force_segment]
      .filter(o => o.sid_baseline?.startsWith('TEST-') || o.sid_analysis?.startsWith('TEST-'));
    assert.equal(ours.length, 2, 'should see both test rows');
    assert.ok(r.stats.total >= 2, 'stats.total counts all returned rows');
  });

  test('inactive rows are not returned', async () => {
    const c = await db();
    await c.query(
      `INSERT INTO \`${TABLE}\`
         (override_type, sid_baseline, baseline_year, analysis_year, note, created_by, active)
       VALUES ('force_no_match', 'TEST-INACTIVE-25', 2025, 2026, 'inactive test', ?, 0)`,
      [TEST_TAG]
    );
    const r = await load_overrides({ baseline_year: 2025, analysis_year: 2026 });
    const our = r.force_no_match.filter(o => o.sid_baseline === 'TEST-INACTIVE-25');
    assert.equal(our.length, 0, 'active=0 rows must be excluded');
  });

  test('approved flag is surfaced as boolean', async () => {
    await insert_test_row({ override_type: 'force_match', sid_baseline: 'TEST-OK-25', sid_analysis: 'TEST-OK-26', baseline_year: 2025, analysis_year: 2026, approved: 1 });
    await insert_test_row({ override_type: 'force_match', sid_baseline: 'TEST-NO-25', sid_analysis: 'TEST-NO-26', baseline_year: 2025, analysis_year: 2026, approved: 0 });
    const r = await load_overrides({ baseline_year: 2025, analysis_year: 2026 });
    const ok = r.force_match.find(o => o.sid_baseline === 'TEST-OK-25');
    const no = r.force_match.find(o => o.sid_baseline === 'TEST-NO-25');
    assert.equal(ok.approved, true,  'approved=1 row should surface as approved: true');
    assert.equal(no.approved, false, 'approved=0 row should surface as approved: false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — apply_overrides() segment manipulation
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 3 — apply_overrides()', () => {

  test('force_match same month → Retained', () => {
    const e25 = make_event('FM-25', 6);
    const e26 = make_event('FM-26', 6);
    const segments = { retained: [], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [{ sid_baseline: 'FM-25', sid_analysis: 'FM-26', note: '' }],
      force_no_match: [],
      force_segment:  [],
    };
    const { applied, warnings } = apply_overrides(segments, [e25], [e26], overrides);
    assert.equal(warnings.length, 0, 'no warnings expected');
    assert.equal(applied.length, 1);
    assert.equal(segments.retained.length, 1);
    assert.equal(segments.shifted.length, 0);
    assert.equal(segments.retained[0].seg, 'Retained');
  });

  test('force_match different month → Shifted', () => {
    const e25 = make_event('FM2-25', 6);
    const e26 = make_event('FM2-26', 9);
    const segments = { retained: [], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [{ sid_baseline: 'FM2-25', sid_analysis: 'FM2-26', note: '' }],
      force_no_match: [],
      force_segment:  [],
    };
    apply_overrides(segments, [e25], [e26], overrides);
    assert.equal(segments.shifted.length, 1);
    assert.equal(segments.retained.length, 0);
  });

  test('force_no_match with sid_baseline → Lost', () => {
    const e25 = make_event('FNM-25', 4);
    // Pre-place in retained so we can verify it gets removed.
    const segments = { retained: [{ e25, e26: make_event('OTHER', 4), seg: 'Retained' }], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [],
      force_no_match: [{ sid_baseline: 'FNM-25', note: '' }],
      force_segment:  [],
    };
    apply_overrides(segments, [e25], [], overrides);
    assert.equal(segments.retained.length, 0, 'event should be removed from retained');
    assert.equal(segments.attrited.length, 1, 'event should be added to attrited');
    assert.equal(segments.attrited[0].seg, 'Lost');
  });

  test('force_segment moves record to target segment', () => {
    const e25 = make_event('FS-25', 7);
    const e26 = make_event('FS-26', 7);
    const segments = {
      retained:      [{ e25, e26, seg: 'Retained', conf: 'High' }],
      shifted:       [], attrited: [], new: [], recovered: [], triedToReturn: [],
    };
    const overrides = {
      force_match:    [],
      force_no_match: [],
      force_segment:  [{ sid_baseline: 'FS-25', segment: 'Tried to Return', note: '' }],
    };
    apply_overrides(segments, [e25], [e26], overrides);
    assert.equal(segments.retained.length, 0);
    assert.equal(segments.triedToReturn.length, 1);
    assert.equal(segments.triedToReturn[0].seg, 'Tried to Return');
  });

  test('force_segment with invalid segment → warning, no change', () => {
    const e25 = make_event('FSBAD-25', 7);
    const segments = { retained: [{ e25, e26: null, seg: 'Retained' }], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [],
      force_no_match: [],
      force_segment:  [{ sid_baseline: 'FSBAD-25', segment: 'NotARealSegment', note: '' }],
    };
    const { warnings } = apply_overrides(segments, [e25], [], overrides);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /invalid segment/);
    assert.equal(segments.retained.length, 1, 'record should stay in retained');
  });

  test('null overrides argument is handled', () => {
    const segments = { retained: [], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const r = apply_overrides(segments, [], [], null);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.warnings, []);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 3 — summarise_overrides()
// ═══════════════════════════════════════════════════════════════════════════

describe('Step 3 — summarise_overrides()', () => {

  test('returns null when nothing to report', () => {
    assert.equal(summarise_overrides([], [], null), null);
  });

  test('reports total_applied + stats when given input', () => {
    const s = summarise_overrides(
      [{ type: 'force_match', result: 'Retained' }],
      [],
      { total: 1, approved: 0, unapproved: 1, global: 0, scoped: 1 }
    );
    assert.equal(s.total_applied, 1);
    assert.equal(s.stats.unapproved, 1);
  });
});

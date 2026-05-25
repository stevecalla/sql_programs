/**
 * overrides.test.js — End-to-end tests for the overrides DB chain.
 *
 * Verifies Steps 1 → 4 of the JSON-to-DB overrides migration:
 *   Step 1   — event_analysis_overrides table exists with correct schema
 *   Step 2   — migrate_overrides_to_db is idempotent
 *   Step 2.5 — year-scoping columns + index exist; sid_baseline/sid_analysis naming
 *   Step 3   — load_overrides() reads from DB with year-scope filter; apply_overrides()
 *              moves events between segments correctly
 *   Step 4   — ask.js CLI write-path: cmd_add_match / cmd_add_no_match /
 *              cmd_add_segment / cmd_remove_override write to DB with year
 *              scoping, --global flag, duplicate-guard, and soft delete.
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
const {
  load_overrides,
  apply_overrides,
  summarise_overrides,
  mark_overrides_stale,
  compute_event_signature,
} = require('../src/overrides');
const {
  cmd_add_match,
  cmd_add_no_match,
  cmd_add_segment,
  cmd_remove_override,
  cmd_approve,
  cmd_unapprove,
  cmd_mark_reviewed,
  cmd_unmark_reviewed,
  current_year_scope,
  year_arg_to_column,
} = require('../ask');

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
  // return;  // DEBUG: skip cleanup so test rows persist
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
      // Step 6 — stale-detection signature columns
      'event_signature_baseline', 'event_signature_analysis',
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

  test('force_no_match unlinks pair: baseline → Lost, analysis → New (defaults)', () => {
    const e25 = make_event('FNM-25', 4);
    const e26 = make_event('FNM-26', 4);
    const segments = { retained: [{ e25, e26, seg: 'Retained' }], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [],
      force_no_match: [{ sid_baseline: 'FNM-25', sid_analysis: 'FNM-26', note: '' }],
      force_segment:  [],
    };
    apply_overrides(segments, [e25], [e26], overrides);
    assert.equal(segments.retained.length, 0, 'pair should be removed from retained');
    assert.equal(segments.attrited.length, 1, 'baseline event should be in Lost');
    assert.equal(segments.attrited[0].seg, 'Lost');
    assert.equal(segments.new.length, 1, 'analysis event should be in New');
    assert.equal(segments.new[0].seg, 'New');
  });

  test('force_no_match unlinks with custom per-side segments', () => {
    const e25 = make_event('FNM2-25', 7);
    const e26 = make_event('FNM2-26', 7);
    const segments = { retained: [{ e25, e26, seg: 'Retained' }], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [],
      force_no_match: [{ sid_baseline: 'FNM2-25', sid_analysis: 'FNM2-26', segment_baseline: 'Tried to Return', segment_analysis: 'Recovered', note: '' }],
      force_segment:  [],
    };
    apply_overrides(segments, [e25], [e26], overrides);
    assert.equal(segments.retained.length, 0);
    assert.equal(segments.triedToReturn.length, 1, 'baseline should land in TTR');
    assert.equal(segments.triedToReturn[0].seg, 'Tried to Return');
    assert.equal(segments.recovered.length, 1, 'analysis should land in Recovered');
    assert.equal(segments.recovered[0].seg, 'Recovered');
  });

  test('force_no_match warns when missing a sid', () => {
    const segments = { retained: [], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] };
    const overrides = {
      force_match:    [],
      force_no_match: [{ sid_baseline: 'ONLY-ONE', note: '' }],
      force_segment:  [],
    };
    const { warnings } = apply_overrides(segments, [], [], overrides);
    assert.ok(warnings.some(w => /requires both/.test(w)), 'should warn about missing sid');
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

// ═══════════════════════════════════════════════════════════════════════════
// Step 4 — ask.js CLI write-path
// ═══════════════════════════════════════════════════════════════════════════
//
// Each test runs cmd_* with `created_by: 'test_suite'` so the existing
// cleanup_test_rows() hook deletes the inserted rows on teardown.
//
// Year scope is pinned via BASELINE_YEAR / ANALYSIS_YEAR env vars at the top
// of the describe block (and restored on teardown) so tests don't drift with
// the calendar year.
//
// cmd_* functions in ask.js write to stdout/stderr by design (status lines
// like "✓ Added force_match #42 [2025/2026]..."). We silence console.log /
// console.error during these tests to keep the test output clean.

describe('Step 4 — ask.js CLI write-path', () => {

  const ORIG_BASELINE = process.env.BASELINE_YEAR;
  const ORIG_ANALYSIS = process.env.ANALYSIS_YEAR;

  console.log("TEST SUITE", ORIG_BASELINE, ORIG_ANALYSIS);

  const ORIG_LOG  = console.log;
  const ORIG_ERR  = console.error;
  const noop = () => {};

  before(() => {
    process.env.BASELINE_YEAR = '2025';
    process.env.ANALYSIS_YEAR = '2026';
    // Silence cmd_* status lines so test output is readable.
    console.log = noop;
    console.error = noop;
  });

  after(() => {
    if (ORIG_BASELINE === undefined) delete process.env.BASELINE_YEAR; else process.env.BASELINE_YEAR = ORIG_BASELINE;
    if (ORIG_ANALYSIS === undefined) delete process.env.ANALYSIS_YEAR; else process.env.ANALYSIS_YEAR = ORIG_ANALYSIS;
    console.log = ORIG_LOG;
    console.error = ORIG_ERR;
  });

  beforeEach(async () => {
    await cleanup_test_rows();
  });

  // ── current_year_scope + year_arg_to_column helpers ──────────────────────

  test('current_year_scope reads env vars', () => {
    const { baseline_year, analysis_year } = current_year_scope();
    assert.equal(baseline_year, 2025, 'BASELINE_YEAR env should set baseline_year');
    assert.equal(analysis_year, 2026, 'ANALYSIS_YEAR env should set analysis_year');
  });

  test('year_arg_to_column accepts baseline/analysis + legacy 25/26', () => {
    assert.equal(year_arg_to_column('baseline'), 'sid_baseline');
    assert.equal(year_arg_to_column('analysis'), 'sid_analysis');
    assert.equal(year_arg_to_column('b'),        'sid_baseline');
    assert.equal(year_arg_to_column('a'),        'sid_analysis');
    assert.equal(year_arg_to_column('25'),       'sid_baseline');
    assert.equal(year_arg_to_column('26'),       'sid_analysis');
    assert.equal(year_arg_to_column('garbage'),  null);
    assert.equal(year_arg_to_column(undefined),  null);
  });

  // ── cmd_add_match ────────────────────────────────────────────────────────

  test('cmd_add_match inserts a scoped row by default', async () => {
    const r = await cmd_add_match('STEP4-A-25', 'STEP4-A-26', 'scoped test', { created_by: TEST_TAG });
    assert.equal(r.status, 'inserted');
    assert.ok(r.id, 'inserted row should have an id');

    // Verify the row is in the DB with the expected scope and provenance
    const c = await db();
    const [rows] = await c.query(
      `SELECT override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, active, created_by, note
         FROM \`${TABLE}\` WHERE id = ?`,
      [r.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].override_type, 'force_match');
    assert.equal(rows[0].sid_baseline,  'STEP4-A-25');
    assert.equal(rows[0].sid_analysis,  'STEP4-A-26');
    assert.equal(rows[0].baseline_year, 2025, 'scoped insert should populate baseline_year');
    assert.equal(rows[0].analysis_year, 2026, 'scoped insert should populate analysis_year');
    assert.equal(rows[0].active,        1);
    assert.equal(rows[0].created_by,    TEST_TAG);
    assert.equal(rows[0].note,          'scoped test');
  });

  test('cmd_add_match with --global writes NULL/NULL year scope', async () => {
    const r = await cmd_add_match('STEP4-B-25', 'STEP4-B-26', 'global test', { global: true, created_by: TEST_TAG });
    assert.equal(r.status, 'inserted');

    const c = await db();
    const [rows] = await c.query(`SELECT baseline_year, analysis_year FROM \`${TABLE}\` WHERE id = ?`, [r.id]);
    assert.equal(rows[0].baseline_year, null, '--global should leave baseline_year NULL');
    assert.equal(rows[0].analysis_year, null, '--global should leave analysis_year NULL');
  });

  test('cmd_add_match duplicate-guard returns status: exists', async () => {
    const first  = await cmd_add_match('STEP4-DUP-25', 'STEP4-DUP-26', 'first',  { created_by: TEST_TAG });
    const second = await cmd_add_match('STEP4-DUP-25', 'STEP4-DUP-26', 'second', { created_by: TEST_TAG });
    assert.equal(first.status,  'inserted');
    assert.equal(second.status, 'exists', 'second call with same sid pair + scope must not insert');
    assert.equal(second.id, first.id, 'duplicate-guard should return the original id');

    // And confirm only one row exists.
    const c = await db();
    const [rows] = await c.query(
      `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE sid_baseline = ? AND sid_analysis = ? AND active = 1`,
      ['STEP4-DUP-25', 'STEP4-DUP-26']
    );
    assert.equal(rows[0].n, 1, 'only one active row should exist for this sid pair');
  });

  test('cmd_add_match: scoped + global rows are independent', async () => {
    // Same sid pair, one scoped to 2025/2026, one global — should be two distinct rows.
    const scoped = await cmd_add_match('STEP4-INDEP-25', 'STEP4-INDEP-26', 'scoped', { created_by: TEST_TAG });
    const global = await cmd_add_match('STEP4-INDEP-25', 'STEP4-INDEP-26', 'global', { global: true, created_by: TEST_TAG });
    assert.equal(scoped.status, 'inserted');
    assert.equal(global.status, 'inserted');
    assert.notEqual(scoped.id, global.id, 'scoped and global should not collide on the duplicate-guard');
  });

  // ── cmd_add_no_match (unlink — always requires both sids) ────────────────

  test('cmd_add_no_match inserts with both sids and default segments', async () => {
    const r = await cmd_add_no_match('STEP4-NM-B', 'STEP4-NM-A', 'unlink test', { created_by: TEST_TAG });
    assert.equal(r.status, 'inserted');
    const c = await db();
    const [rows] = await c.query(
      `SELECT sid_baseline, sid_analysis, segment_baseline, segment_analysis FROM \`${TABLE}\` WHERE id = ?`, [r.id]
    );
    assert.equal(rows[0].sid_baseline, 'STEP4-NM-B');
    assert.equal(rows[0].sid_analysis, 'STEP4-NM-A');
    assert.equal(rows[0].segment_baseline, 'Lost', 'default baseline segment should be Lost');
    assert.equal(rows[0].segment_analysis, 'New', 'default analysis segment should be New');
  });

  test('cmd_add_no_match with custom per-side segments', async () => {
    const r = await cmd_add_no_match('STEP4-NM-C', 'STEP4-NM-D', 'custom segs', {
      created_by: TEST_TAG,
      segment_baseline: 'Tried to Return',
      segment_analysis: 'Recovered',
    });
    assert.equal(r.status, 'inserted');
    const c = await db();
    const [rows] = await c.query(
      `SELECT segment_baseline, segment_analysis FROM \`${TABLE}\` WHERE id = ?`, [r.id]
    );
    assert.equal(rows[0].segment_baseline, 'Tried to Return');
    assert.equal(rows[0].segment_analysis, 'Recovered');
  });

  test('cmd_add_no_match duplicate guard returns exists', async () => {
    const r1 = await cmd_add_no_match('STEP4-NM-DUP-B', 'STEP4-NM-DUP-A', 'first', { created_by: TEST_TAG });
    assert.equal(r1.status, 'inserted');
    const r2 = await cmd_add_no_match('STEP4-NM-DUP-B', 'STEP4-NM-DUP-A', 'second', { created_by: TEST_TAG });
    assert.equal(r2.status, 'exists');
    assert.equal(r2.id, r1.id);
  });

  // ── cmd_add_segment ────────────────────────────────────────────────────

  test('cmd_add_segment inserts a new row', async () => {
    const r = await cmd_add_segment('baseline', 'STEP4-SEG-25', 'Lost', 'force-segment test', { created_by: TEST_TAG });
    assert.equal(r.status, 'inserted');
    const c = await db();
    const [rows] = await c.query(`SELECT override_type, sid_baseline, segment FROM \`${TABLE}\` WHERE id = ?`, [r.id]);
    assert.equal(rows[0].override_type, 'force_segment');
    assert.equal(rows[0].sid_baseline,  'STEP4-SEG-25');
    assert.equal(rows[0].segment,       'Lost');
  });

  test('cmd_add_segment UPDATES an existing row for the same sid + scope', async () => {
    const first  = await cmd_add_segment('baseline', 'STEP4-UPD-25', 'Lost', 'before', { created_by: TEST_TAG });
    const second = await cmd_add_segment('baseline', 'STEP4-UPD-25', 'New',  'after',  { created_by: TEST_TAG });
    assert.equal(first.status,  'inserted');
    assert.equal(second.status, 'updated', 'second call with same sid + scope should UPDATE, not INSERT');
    assert.equal(second.id, first.id, 'UPDATE should target the original row id');

    const c = await db();
    const [rows] = await c.query(`SELECT segment, note FROM \`${TABLE}\` WHERE id = ?`, [first.id]);
    assert.equal(rows[0].segment, 'New', 'segment should be overwritten by the second call');
    assert.equal(rows[0].note,    'after');

    // And confirm we still only have one row, not two.
    const [count] = await c.query(
      `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE sid_baseline = ? AND override_type = 'force_segment'`,
      ['STEP4-UPD-25']
    );
    assert.equal(count[0].n, 1, 'only one force_segment row should exist for this sid + scope');
  });

  test('cmd_add_segment accepts partial segment names (case-insensitive)', async () => {
    const r = await cmd_add_segment('baseline', 'STEP4-PRT-25', 'lost', 'lowercase', { created_by: TEST_TAG });
    assert.equal(r.status, 'inserted');
    const c = await db();
    const [rows] = await c.query(`SELECT segment FROM \`${TABLE}\` WHERE id = ?`, [r.id]);
    assert.equal(rows[0].segment, 'Lost', '"lost" should map to canonical "Lost"');
  });

  // ── cmd_remove_override (soft delete) ──────────────────────────────────

  test('cmd_remove_override soft-deletes within current scope', async () => {
    // Insert a couple of scoped rows for the same sid.
    const m = await cmd_add_match('STEP4-RM-25', 'STEP4-RM-26', 'will be removed', { created_by: TEST_TAG });
    assert.equal(m.status, 'inserted');

    // Sanity-check active=1 before remove.
    const c = await db();
    const [before] = await c.query(`SELECT active FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
    assert.equal(before[0].active, 1);

    // Remove and verify active=0.
    await cmd_remove_override('STEP4-RM-25');
    const [after_remove] = await c.query(`SELECT active FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
    assert.equal(after_remove[0].active, 0, 'cmd_remove_override should set active = 0');

    // Row still exists in the table (soft delete preserves audit trail).
    const [count] = await c.query(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE id = ?`, [m.id]);
    assert.equal(count[0].n, 1, 'row should not be deleted from the table — just deactivated');
  });

  test('cmd_remove_override leaves out-of-scope rows alone', async () => {
    // One row scoped to 2025/2026 (current scope), one to a far-off year pair.
    const c = await db();
    const in_scope_id = await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline:  'STEP4-SCP-25',
      baseline_year: 2025, analysis_year: 2026,
    });
    const out_of_scope_id = await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline:  'STEP4-SCP-25',  // same sid!
      baseline_year: 1999, analysis_year: 2000,
    });

    await cmd_remove_override('STEP4-SCP-25');

    const [in_scope]     = await c.query(`SELECT active FROM \`${TABLE}\` WHERE id = ?`, [in_scope_id]);
    const [out_of_scope] = await c.query(`SELECT active FROM \`${TABLE}\` WHERE id = ?`, [out_of_scope_id]);
    assert.equal(in_scope[0].active,     0, 'in-scope row should be deactivated');
    assert.equal(out_of_scope[0].active, 1, 'out-of-scope row must NOT be touched');
  });

  test('cmd_remove_override also soft-deletes matching global rows', async () => {
    // Globals (NULL/NULL) are intentionally swept up by remove since they
    // always apply in every scope. Document and verify that behaviour.
    const c = await db();
    const global_id = await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline:  'STEP4-GBL-RM',
      baseline_year: null, analysis_year: null,
    });

    await cmd_remove_override('STEP4-GBL-RM');

    const [rows] = await c.query(`SELECT active FROM `+'`'+`${TABLE}`+'`'+` WHERE id = ?`, [global_id]);
    assert.equal(rows[0].active, 0, 'global row matching the sid should be deactivated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 5 — Approval CLI commands
// ═══════════════════════════════════════════════════════════════════════════
//
// cmd_approve fetches the current event lists from usat_sales_db so it can
// capture signatures at approval time. Tests insert override rows that point
// at fake sids (STEP5-*) — those won't be found in the real events table, so
// signatures stay NULL but the approval flags still flip. That's the
// documented "missing_events" path and lets the tests stay independent of
// whatever real data happens to be in the events table today.

describe('Step 5 — Approval CLI', () => {

  const ORIG_BASELINE = process.env.BASELINE_YEAR;
  const ORIG_ANALYSIS = process.env.ANALYSIS_YEAR;
  const ORIG_LOG  = console.log;
  const ORIG_ERR  = console.error;
  const ORIG_WARN = console.warn;
  const noop = () => {};

  before(() => {
    process.env.BASELINE_YEAR = '2025';
    process.env.ANALYSIS_YEAR = '2026';
    console.log = noop;
    console.error = noop;
    console.warn = noop;
  });

  after(() => {
    if (ORIG_BASELINE === undefined) delete process.env.BASELINE_YEAR; else process.env.BASELINE_YEAR = ORIG_BASELINE;
    if (ORIG_ANALYSIS === undefined) delete process.env.ANALYSIS_YEAR; else process.env.ANALYSIS_YEAR = ORIG_ANALYSIS;
    console.log = ORIG_LOG;
    console.error = ORIG_ERR;
    console.warn = ORIG_WARN;
  });

  beforeEach(async () => {
    await cleanup_test_rows();
  });

  test('cmd_approve flips approved + approval_state + approved_by + approved_at', async () => {
    const id = await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline:  'STEP5-APR-1',
      baseline_year: 2025, analysis_year: 2026,
      approved: 0,
    });

    const r = await cmd_approve('STEP5-APR-1');
    assert.equal(r.approved, 1, 'cmd_approve should report 1 row approved');

    const c = await db();
    const [rows] = await c.query(
      'SELECT approved, approval_state, approved_by, approved_at FROM `' + TABLE + '` WHERE id = ?',
      [id]
    );
    assert.equal(rows[0].approved,       1,         'approved should flip to 1');
    assert.equal(rows[0].approval_state, 'approved','approval_state should be "approved"');
    assert.equal(rows[0].approved_by,    'cli',     'approved_by should default to "cli"');
    assert.ok(rows[0].approved_at !== null,         'approved_at should be set');
  });

  test('cmd_approve on missing sid is a no-op', async () => {
    const r = await cmd_approve('STEP5-DOES-NOT-EXIST');
    assert.equal(r.approved, 0, 'no rows should be approved for an unknown sid');
  });

  test('cmd_unapprove clears approved + approval_state + signatures (keeps audit fields)', async () => {
    // Hand-craft an already-approved row with signatures captured.
    const c = await db();
    const [insert] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, baseline_year, analysis_year, note, approved, approval_state, approved_by, approved_at, event_signature_baseline, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, NOW(), ?, ?, 1)',
      ['force_no_match', 'STEP5-UNAPR-1', 2025, 2026, 'pre-approved', 'approved', 'cli', 'old-sig|6|Adult Race|Active', TEST_TAG]
    );
    const id = insert.insertId;

    const r = await cmd_unapprove('STEP5-UNAPR-1');
    assert.equal(r.unapproved, 1, 'one row should be unapproved');

    const [rows] = await c.query(
      'SELECT approved, approval_state, event_signature_baseline, approved_by, approved_at FROM `' + TABLE + '` WHERE id = ?',
      [id]
    );
    assert.equal(rows[0].approved,                 0,    'approved should reset to 0');
    assert.equal(rows[0].approval_state,           null, 'approval_state should clear');
    assert.equal(rows[0].event_signature_baseline, null, 'signature should clear');
    // Audit trail preserved
    assert.equal(rows[0].approved_by,              'cli','approved_by retained as audit');
    assert.ok   (rows[0].approved_at !== null,           'approved_at retained as audit');
  });

  test('cmd_unapprove on missing sid is a no-op', async () => {
    const r = await cmd_unapprove('STEP5-NOPE');
    assert.equal(r.unapproved, 0);
  });

  test('approve → unapprove → re-approve round-trips cleanly', async () => {
    const id = await insert_test_row({
      override_type: 'force_no_match',
      sid_baseline:  'STEP5-RT',
      baseline_year: 2025, analysis_year: 2026,
    });
    const c = await db();

    await cmd_approve('STEP5-RT');
    const [after_a] = await c.query('SELECT approved, approval_state FROM `' + TABLE + '` WHERE id = ?', [id]);
    assert.equal(after_a[0].approved, 1);
    assert.equal(after_a[0].approval_state, 'approved');

    await cmd_unapprove('STEP5-RT');
    const [after_u] = await c.query('SELECT approved, approval_state FROM `' + TABLE + '` WHERE id = ?', [id]);
    assert.equal(after_u[0].approved, 0);
    assert.equal(after_u[0].approval_state, null);

    await cmd_approve('STEP5-RT');
    const [after_a2] = await c.query('SELECT approved, approval_state FROM `' + TABLE + '` WHERE id = ?', [id]);
    assert.equal(after_a2[0].approved, 1);
    assert.equal(after_a2[0].approval_state, 'approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Step 6 — Stale-approval detection
// ═══════════════════════════════════════════════════════════════════════════
//
// Pure-function tests for apply_overrides(): we hand-craft events and
// overrides with mismatched signatures and verify the stale_ids array, the
// stale_warnings, and the applied[].stale flag. Then a DB test confirms
// mark_overrides_stale() actually flips approval_state.

describe('Step 6 — Stale-approval detection', () => {

  // ── compute_event_signature helper ──────────────────────────────────────

  test('compute_event_signature renders `{name}|{month}|{type}|{status}`', () => {
    const e = { name: 'Test Race', month: 7, type: 'Adult Race', status: 'Active' };
    assert.equal(compute_event_signature(e), 'Test Race|7|Adult Race|Active');
  });

  test('compute_event_signature returns null for missing event', () => {
    assert.equal(compute_event_signature(null), null);
    assert.equal(compute_event_signature(undefined), null);
  });

  // ── apply_overrides stale detection ────────────────────────────────────

  function make_event(sid, month, name = 'Test Event', type = 'Adult Race', status = 'Active') {
    return { sanctionId: sid, month, name, type, status };
  }
  const empty_segments = () => ({ retained: [], shifted: [], attrited: [], new: [], recovered: [], triedToReturn: [] });

  test('approved override with matching signature is NOT stale', () => {
    const e25 = make_event('SIG-OK-25', 6, 'Same Name');
    const e26 = make_event('SIG-OK-26', 6, 'Same Name');
    const overrides = {
      force_match: [{
        id: 101,
        sid_baseline: 'SIG-OK-25', sid_analysis: 'SIG-OK-26',
        approved: true,
        event_signature_baseline: compute_event_signature(e25),
        event_signature_analysis: compute_event_signature(e26),
      }],
      force_no_match: [], force_segment: [],
    };
    const { applied, stale_ids, stale_warnings } = apply_overrides(empty_segments(), [e25], [e26], overrides);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].stale, undefined, 'matching signature → no stale flag');
    assert.deepEqual(stale_ids, [],            'no stale ids');
    assert.deepEqual(stale_warnings, [],       'no stale warnings');
  });

  test('approved override with drifted signature IS stale', () => {
    const e25 = make_event('SIG-DRIFT-25', 6, 'New Name');   // was "Old Name"
    const e26 = make_event('SIG-DRIFT-26', 6, 'Same Name');
    const overrides = {
      force_match: [{
        id: 202,
        sid_baseline: 'SIG-DRIFT-25', sid_analysis: 'SIG-DRIFT-26',
        approved: true,
        event_signature_baseline: 'Old Name|6|Adult Race|Active',   // stored at approve time
        event_signature_analysis: compute_event_signature(e26),
      }],
      force_no_match: [], force_segment: [],
    };
    const { applied, stale_ids, stale_warnings } = apply_overrides(empty_segments(), [e25], [e26], overrides);
    assert.equal(applied[0].stale, true,       'applied record should be tagged stale');
    assert.deepEqual(stale_ids, [202],         'stale id captured');
    assert.equal(stale_warnings.length, 1,     'one warning per stale override');
    assert.match(stale_warnings[0], /Old Name/, 'warning should mention the stored value');
    assert.match(stale_warnings[0], /New Name/, 'warning should mention the fresh value');
  });

  test('un-approved override is never stale (no baseline to drift from)', () => {
    const e25 = make_event('SIG-UN-25', 6, 'Whatever');
    const e26 = make_event('SIG-UN-26', 6, 'Whatever');
    const overrides = {
      force_match: [{
        id: 303,
        sid_baseline: 'SIG-UN-25', sid_analysis: 'SIG-UN-26',
        approved: false,
        event_signature_baseline: 'something-else|9|Youth Race|Active',
        event_signature_analysis: null,
      }],
      force_no_match: [], force_segment: [],
    };
    const { applied, stale_ids } = apply_overrides(empty_segments(), [e25], [e26], overrides);
    assert.equal(applied[0].stale, undefined, 'un-approved → never stale');
    assert.deepEqual(stale_ids, []);
  });

  test('approved override with NULL stored signatures is NOT stale (first build after approve)', () => {
    // cmd_approve always captures, but mid-migration rows or entries on a
    // vanished event can have NULL signatures. Document that this path
    // doesn't false-positive.
    const e25 = make_event('SIG-NULL-25', 6, 'Whatever');
    const e26 = make_event('SIG-NULL-26', 6, 'Whatever');
    const overrides = {
      force_no_match: [{
        id: 404,
        sid_baseline: 'SIG-NULL-25', sid_analysis: 'SIG-NULL-26',
        approved: true,
        event_signature_baseline: null,
        event_signature_analysis: null,
      }],
      force_match: [], force_segment: [],
    };
    const { stale_ids } = apply_overrides(empty_segments(), [e25], [e26], overrides);
    assert.deepEqual(stale_ids, [], 'NULL sigs → no comparison → no stale');
  });

  test('force_no_match drift on baseline side is detected', () => {
    const e25 = make_event('SIG-NM-25', 7, 'Renamed');
    const e26 = make_event('SIG-NM-26', 7, 'Same Name');
    const overrides = {
      force_no_match: [{
        id: 505,
        sid_baseline: 'SIG-NM-25', sid_analysis: 'SIG-NM-26',
        approved: true,
        event_signature_baseline: 'Original|7|Adult Race|Active',
        event_signature_analysis: compute_event_signature(e26),
      }],
      force_match: [], force_segment: [],
    };
    const { stale_ids, stale_warnings } = apply_overrides(empty_segments(), [e25], [e26], overrides);
    assert.deepEqual(stale_ids, [505]);
    assert.match(stale_warnings[0], /Original/);
    assert.match(stale_warnings[0], /Renamed/);
  });

  // ── mark_overrides_stale (DB integration) ──────────────────────────────


  test('mark_overrides_stale flips approval_state on listed ids', async () => {
    const c = await db();
    // Insert two approved rows; we'll mark one as stale.
    const [r1] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, baseline_year, analysis_year, approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, 1, ?, ?, 1)',
      ['force_no_match', 'STEP6-STALE-1', 2025, 2026, 'approved', TEST_TAG]
    );
    const [r2] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, baseline_year, analysis_year, approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, 1, ?, ?, 1)',
      ['force_no_match', 'STEP6-STALE-2', 2025, 2026, 'approved', TEST_TAG]
    );

    const result = await mark_overrides_stale([r1.insertId], { silent: true });
    assert.equal(result.updated, 1);

    const [row1] = await c.query('SELECT approval_state FROM `' + TABLE + '` WHERE id = ?', [r1.insertId]);
    const [row2] = await c.query('SELECT approval_state FROM `' + TABLE + '` WHERE id = ?', [r2.insertId]);
    assert.equal(row1[0].approval_state, 'stale',    'listed id should be marked stale');
    assert.equal(row2[0].approval_state, 'approved', 'un-listed id should be untouched');
  });

  test('mark_overrides_stale with empty array is a no-op', async () => {
    const result = await mark_overrides_stale([], { silent: true });
    assert.equal(result.updated, 0);
  });

  test('mark_overrides_stale skips unapproved rows (no-op)', async () => {
    const c = await db();
    const [r] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, baseline_year, analysis_year, approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, 0, NULL, ?, 1)',
      ['force_no_match', 'STEP6-UNAPR', 2025, 2026, TEST_TAG]
    );
    const result = await mark_overrides_stale([r.insertId], { silent: true });
    assert.equal(result.updated, 0, 'unapproved row should not be touched');
  });
});


// ── Invariant: not active ⇒ not approved ───────────────────────────────────
//
// Documented rule (added Step 11):
//
//   An override row with active = 0 (soft-deleted) MUST also have
//     approved = 0
//     approval_state IS NULL
//
//   Rationale: you cannot endorse a rule that no longer applies. An
//   "approved-but-inactive" row would lie to the dashboard's Reviewed?
//   checkbox + the build's approval-stats logic. The approved_by /
//   approved_at audit fields ARE preserved (historical record of who
//   endorsed it before it got removed).
//
// Enforced in two places:
//   1. cmd_remove_override (ask.js)  -- the soft-delete path clears
//      approved + approval_state in the same UPDATE.
//   2. ensure_overrides_table (utilities) -- idempotent backfill on
//      every build cleans up any historical violations.

describe('Step 11 — invariant: not active ⇒ not approved', () => {

  test('cmd_remove_override clears approved + approval_state on soft-delete', async () => {
    const c = await db();
    const [ins] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, ' +
      ' approved, approval_state, approved_by, approved_at, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, NOW(), ?, 1)',
      ['force_match', 'STEP11-RM-B', 'STEP11-RM-A', 2025, 2026, 'approved', 'invariant-test', TEST_TAG]
    );
    const id = ins.insertId;

    await cmd_remove_override('STEP11-RM-B');

    const [rows] = await c.query(
      'SELECT active, approved, approval_state, approved_by, approved_at ' +
      'FROM `' + TABLE + '` WHERE id = ?', [id]
    );
    const row = rows[0];
    assert.ok(row, 'row should still exist (soft-delete preserves it)');
    assert.equal(row.active,         0,    'active should be 0 after soft-delete');
    assert.equal(row.approved,       0,    'approved must be 0 when active=0');
    assert.equal(row.approval_state, null, 'approval_state must be NULL when active=0');
    assert.equal(row.approved_by,    'invariant-test', 'approved_by audit preserved');
    assert.ok(row.approved_at, 'approved_at audit preserved');
  });

  test('ensure_overrides_table backfills inactive+approved rows to approved=0', async () => {
    const c = await db();
    // force_match + force_no_match are guarded by check constraints
    // (chk_match_requires_pair / chk_no_match_requires_pair) that require
    // BOTH sids. Set sid_analysis on those two so the seed inserts pass
    // the constraint. force_segment is single-sided.
    const [v1] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, ' +
      ' approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)',
      ['force_match', 'STEP11-BF-A', 'STEP11-BF-A2', 2025, 2026, 'approved', TEST_TAG]
    );
    const [v2] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, ' +
      ' approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 1, NULL, ?, 0)',
      ['force_no_match', 'STEP11-BF-B', 'STEP11-BF-B2', 2025, 2026, TEST_TAG]
    );
    // force_segment is guarded by chk_segment_requires_value -- it requires
    // a non-null segment. 'Lost' is a valid VALID_SEGMENTS member.
    const [v3] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, segment, baseline_year, analysis_year, ' +
      ' approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)',
      ['force_segment', 'STEP11-BF-C', 'Lost', 2025, 2026, 'stale', TEST_TAG]
    );

    await ensure_overrides_table({ silent: true });

    const [rows] = await c.query(
      'SELECT id, active, approved, approval_state FROM `' + TABLE + '` ' +
      'WHERE id IN (?, ?, ?) ORDER BY id',
      [v1.insertId, v2.insertId, v3.insertId]
    );
    for (const r of rows) {
      assert.equal(r.active,         0,    'id ' + r.id + ': active still 0');
      assert.equal(r.approved,       0,    'id ' + r.id + ': approved cleared by backfill');
      assert.equal(r.approval_state, null, 'id ' + r.id + ': approval_state cleared');
    }
  });

  test('ensure_overrides_table backfill leaves valid active+approved rows alone', async () => {
    const c = await db();
    // force_match requires both sids (chk_match_requires_pair).
    const [ins] = await c.query(
      'INSERT INTO `' + TABLE + '` ' +
      '(override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, ' +
      ' approved, approval_state, created_by, active) ' +
      'VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1)',
      ['force_match', 'STEP11-IDM-OK', 'STEP11-IDM-OK2', 2025, 2026, 'approved', TEST_TAG]
    );

    await ensure_overrides_table({ silent: true });
    await ensure_overrides_table({ silent: true });   // idempotent

    const [rows] = await c.query(
      'SELECT active, approved, approval_state FROM `' + TABLE + '` WHERE id = ?',
      [ins.insertId]
    );
    assert.equal(rows[0].active,         1);
    assert.equal(rows[0].approved,       1);
    assert.equal(rows[0].approval_state, 'approved', 'valid row must NOT be cleared');
  });

  test('audit: no row currently violates the invariant (production-readiness gate)', async () => {
    const c = await db();
    const [rows] = await c.query(
      'SELECT COUNT(*) AS n FROM `' + TABLE + '` ' +
      'WHERE active = 0 AND (approved = 1 OR approval_state IS NOT NULL)'
    );
    assert.equal(rows[0].n, 0,
      'invariant violated: ' + rows[0].n + ' row(s) have active=0 AND approved=1 (or approval_state set). ' +
      'Run node build_all.js (or node utilities/ensure_overrides_table.js) to apply the backfill.');
  });
});

// ===========================================================================
// Step 12 -- cmd_mark_reviewed (CLI mirror of the dashboard Reviewed? flow)
// ===========================================================================
describe('Step 12 -- cmd_mark_reviewed', () => {
  const ROSTER_TABLE = 'event_analysis_roster';
  const FIXTURE_BUILD_AT = new Date('1999-01-01T00:00:00Z');
  const FIXTURE_NOTE_TAG = 'mark_reviewed_test_row';

  const ORIG_BASELINE = process.env.BASELINE_YEAR;
  const ORIG_ANALYSIS = process.env.ANALYSIS_YEAR;
  const ORIG_LOG  = console.log;
  const ORIG_WARN = console.warn;
  const ORIG_ERR  = console.error;
  const noop = () => {};

  // Use sentinel years so we never collide with production roster rows.
  before(async () => {
    process.env.BASELINE_YEAR = '1999';
    process.env.ANALYSIS_YEAR = '2000';
    console.log = noop; console.warn = noop; console.error = noop;
    // Make sure the roster table exists; insert one fixture row per
    // segment shape (Retained pair, Lost, New) tagged via build_at +
    // sentinel sids so cleanup is precise.
    const { ensure_roster_table } = require('../utilities/ensure_roster_table');
    await ensure_roster_table({ silent: true });
    const c = await db();
    // Clean any stale fixture rows from a prior crashed run.
    await c.query(`DELETE FROM \`${ROSTER_TABLE}\` WHERE baseline_year = 1999 AND analysis_year = 2000`);
    await c.query(
      `INSERT INTO \`${ROSTER_TABLE}\`
         (build_at, baseline_year, analysis_year, seg, conf, type,
          sid_baseline, sid_analysis)
       VALUES
         (?, 1999, 2000, 'Retained', 'high', 'Adult Race', 'BL-MR-1', 'AN-MR-1'),
         (?, 1999, 2000, 'Lost',     'high', 'Adult Race', 'BL-MR-LOST', NULL),
         (?, 1999, 2000, 'New',      'high', 'Adult Race', NULL,         'AN-MR-NEW')`,
      [FIXTURE_BUILD_AT, FIXTURE_BUILD_AT, FIXTURE_BUILD_AT]
    );
    await cleanup_test_rows();
  });

  after(async () => {
    const c = await db();
    await c.query(`DELETE FROM \`${ROSTER_TABLE}\` WHERE baseline_year = 1999 AND analysis_year = 2000`);
    await cleanup_test_rows();
    // Also purge any cli:review / dashboard:review / cli rows left at the
    // sentinel year pair. cleanup_test_rows only deletes TEST_TAG rows;
    // a mid-test crash (or simply tests that don't retag before they end)
    // could leave a row with created_by='cli:review' at baseline_year=1999
    // sitting in production. This DELETE is scoped to the sentinel pair so
    // real production rows are never touched.
    await c.query(
      `DELETE FROM \`${TABLE}\`
        WHERE created_by IN ('cli:review', 'dashboard:review', 'cli')
          AND baseline_year = 1999 AND analysis_year = 2000`
    );
    if (ORIG_BASELINE === undefined) delete process.env.BASELINE_YEAR; else process.env.BASELINE_YEAR = ORIG_BASELINE;
    if (ORIG_ANALYSIS === undefined) delete process.env.ANALYSIS_YEAR; else process.env.ANALYSIS_YEAR = ORIG_ANALYSIS;
    console.log = ORIG_LOG; console.warn = ORIG_WARN; console.error = ORIG_ERR;
  });

  beforeEach(async () => {
    await cleanup_test_rows();
    // Defensive: also wipe any cli:review / dashboard:review rows on our
    // sentinel-year fixtures. A crash mid-test (e.g. a missing import or
    // a thrown assertion before the retag-to-TEST_TAG step) would otherwise
    // leave orphans that trip the duplicate-guard in cmd_add_match on the
    // next test. Scoped to baseline_year=1999 so production rows are safe.
    const c = await db();
    await c.query(
      `DELETE FROM \`${TABLE}\`
        WHERE created_by IN ('cli:review', 'dashboard:review', 'cli')
          AND baseline_year = 1999 AND analysis_year = 2000`
    );
  });

  test('Retained pair sid -> inserts force_match override, approved, cli:review tag', async () => {
    const summary = await cmd_mark_reviewed(['BL-MR-1'], { created_by: 'cli:review' });
    // Patch the row to test_suite so cleanup catches it (cmd_add_match
    // sets created_by='cli:review'; we re-tag for predictable cleanup).
    const c = await db();
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli:review' AND baseline_year = 1999 AND analysis_year = 2000`, [TEST_TAG]);
    const [rows] = await c.query(
      `SELECT override_type, sid_baseline, sid_analysis, approved, approval_state
         FROM \`${TABLE}\`
        WHERE created_by = ? AND baseline_year = 1999 AND analysis_year = 2000`,
      [TEST_TAG]
    );
    assert.equal(rows.length, 1, 'should insert exactly one row');
    assert.equal(rows[0].override_type, 'force_match');
    assert.equal(rows[0].sid_baseline, 'BL-MR-1');
    assert.equal(rows[0].sid_analysis, 'AN-MR-1');
    assert.equal(rows[0].approved, 1, 'should be auto-approved');
    assert.equal(summary.inserted + summary.exists, 1);
    assert.equal(summary.errors.length, 0);
  });

  test('Lost sid -> inserts force_segment(segment=Lost) on sid_baseline', async () => {
    const summary = await cmd_mark_reviewed(['BL-MR-LOST'], { created_by: 'cli:review' });
    const c = await db();
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli:review' AND baseline_year = 1999 AND analysis_year = 2000`, [TEST_TAG]);
    const [rows] = await c.query(
      `SELECT override_type, sid_baseline, sid_analysis, segment, approved
         FROM \`${TABLE}\` WHERE created_by = ? AND baseline_year = 1999`,
      [TEST_TAG]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].override_type, 'force_segment');
    assert.equal(rows[0].sid_baseline, 'BL-MR-LOST');
    assert.equal(rows[0].sid_analysis, null);
    assert.equal(rows[0].segment, 'Lost');
    assert.equal(rows[0].approved, 1);
    assert.equal(summary.errors.length, 0);
  });

  test('New sid -> inserts force_segment(segment=New) on sid_analysis', async () => {
    const summary = await cmd_mark_reviewed(['AN-MR-NEW'], { created_by: 'cli:review' });
    const c = await db();
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli:review' AND baseline_year = 1999 AND analysis_year = 2000`, [TEST_TAG]);
    const [rows] = await c.query(
      `SELECT override_type, sid_baseline, sid_analysis, segment, approved
         FROM \`${TABLE}\` WHERE created_by = ?`,
      [TEST_TAG]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].override_type, 'force_segment');
    assert.equal(rows[0].sid_baseline, null);
    assert.equal(rows[0].sid_analysis, 'AN-MR-NEW');
    assert.equal(rows[0].segment, 'New');
    assert.equal(rows[0].approved, 1);
    assert.equal(summary.errors.length, 0);
  });

  test('unknown sid is skipped, not errored', async () => {
    const summary = await cmd_mark_reviewed(['TOTALLY-FAKE-SID-XYZ'], { created_by: 'cli:review' });
    assert.equal(summary.inserted, 0);
    assert.equal(summary.exists,   0);
    assert.equal(summary.skipped,  1);
    assert.equal(summary.errors.length, 0);
  });

  test('idempotent: second call on same sid does NOT duplicate', async () => {
    const first  = await cmd_mark_reviewed(['BL-MR-1'], { created_by: 'cli:review' });
    const second = await cmd_mark_reviewed(['BL-MR-1'], { created_by: 'cli:review' });
    const c = await db();
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli:review' AND baseline_year = 1999`, [TEST_TAG]);
    const [rows] = await c.query(
      `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE created_by = ? AND sid_baseline = 'BL-MR-1'`,
      [TEST_TAG]
    );
    assert.equal(rows[0].n, 1, 're-running should NOT create a duplicate');
    assert.equal(first.inserted,  1, 'first call inserts');
    assert.equal(second.exists,   1, 'second call sees existing');
    assert.equal(second.inserted, 0);
  });

  // ── cmd_unmark_reviewed — inverse of mark_reviewed ───────────────────
  // Adds a reviewed marker, then calls cmd_unmark_reviewed to make sure
  // it gets soft-deleted (active=0, approved=0) without touching non-
  // review overrides on the same sid.

  test('unmark_reviewed soft-deletes a Retained marker created by mark_reviewed', async () => {
    // Set up: mark the sid, then unmark it.
    await cmd_mark_reviewed(['BL-MR-1'], { created_by: 'cli:review' });
    const c = await db();
    // Re-tag rows so cleanup gets them even if unmark misses something.
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli:review' AND baseline_year = 1999 AND analysis_year = 2000`, [TEST_TAG]);
    // Flip created_by BACK to cli:review on the row we want to unmark
    // (cleanup tag would otherwise hide it from the unmark query).
    const [[before_row]] = await c.query(
      `SELECT id, active FROM \`${TABLE}\` WHERE created_by = ? AND sid_baseline = 'BL-MR-1'`,
      [TEST_TAG]
    );
    assert.ok(before_row, 'mark-reviewed should have inserted a row');
    assert.equal(before_row.active, 1, 'row should start active');
    await c.query(`UPDATE \`${TABLE}\` SET created_by = 'cli:review' WHERE id = ?`, [before_row.id]);

    const summary = await cmd_unmark_reviewed(['BL-MR-1']);
    assert.equal(summary.removed, 1, 'should remove exactly one review-tagged row');
    assert.equal(summary.missing, 0);
    assert.equal(summary.errors.length, 0);

    // Verify the soft-delete + invariant: active=0, approved=0, approval_state=NULL.
    const [[after_row]] = await c.query(
      `SELECT active, approved, approval_state FROM \`${TABLE}\` WHERE id = ?`,
      [before_row.id]
    );
    assert.equal(after_row.active, 0, 'row should be soft-deleted (active=0)');
    assert.equal(after_row.approved, 0, 'row should have approved=0 (invariant)');
    assert.equal(after_row.approval_state, null, 'approval_state should be NULL');
    // Re-tag for cleanup.
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE id = ?`, [TEST_TAG, before_row.id]);
  });

  test('unmark_reviewed reports "missing" when no review marker exists for the sid', async () => {
    const summary = await cmd_unmark_reviewed(['BL-MR-1']);
    assert.equal(summary.removed, 0);
    assert.equal(summary.missing, 1, 'sid with no review marker should bump missing count');
    assert.equal(summary.errors.length, 0);
  });

  test('unmark_reviewed leaves non-review overrides on the same sid untouched', async () => {
    // Use a force_segment as the "manual" override so it can coexist with
    // the force_match that mark-reviewed creates (different override_type
    // → no duplicate-guard collision). Real-world scenario: operator
    // manually flagged a Retained event as Shifted via force_segment,
    // then someone else clicks Reviewed? on the same row, creating a
    // force_match. Unmarking should drop the force_match but leave the
    // force_segment.
    await cmd_add_segment('baseline', 'BL-MR-1', 'Shifted', 'manual override -- not a review', { created_by: 'cli' });
    const c = await db();
    // Re-tag so cleanup catches the manual row.
    await c.query(`UPDATE \`${TABLE}\` SET created_by = ? WHERE created_by = 'cli' AND sid_baseline = 'BL-MR-1' AND override_type = 'force_segment' AND baseline_year = 1999`, [TEST_TAG]);
    const [[manual_row]] = await c.query(
      `SELECT id FROM \`${TABLE}\` WHERE created_by = ? AND sid_baseline = 'BL-MR-1' AND override_type = 'force_segment'`,
      [TEST_TAG]
    );
    assert.ok(manual_row, 'manual force_segment override should have been created');

    // Now mark-review the same sid (creates a force_match), then unmark.
    // unmark only targets cli:review/dashboard:review rows, so the manual
    // force_segment must survive untouched.
    await cmd_mark_reviewed(['BL-MR-1'], { created_by: 'cli:review' });
    const summary = await cmd_unmark_reviewed(['BL-MR-1']);
    assert.ok(summary.removed >= 1, 'unmark should remove the cli:review force_match row');

    // Manual force_segment must still be active.
    const [[after_manual]] = await c.query(
      `SELECT active FROM \`${TABLE}\` WHERE id = ?`,
      [manual_row.id]
    );
    assert.equal(after_manual.active, 1, 'manual force_segment should remain active after unmark');
  });
});

'use strict';
// Ported from src/reporting/tests (branch reporting_app_v21) into the participation_maps module.
// Import paths rewritten for the usat_apps layout; test logic unchanged.
// Tests for the on-demand exact-unique endpoint logic (participation_read.unique_for_selection).
// No DB: db.query is stubbed so we can assert the WHERE it builds, the WITH ROLLUP parsing (national is a
// true distinct, NOT the sum of states — the whole reason this endpoint exists), and the per-selection cache.
// Live reconciliation is verified separately by the Workbench query in the Reference tab / plans_and_notes.
const test = require('node:test');
const assert = require('node:assert');
const participation = require('../store/participation_read');
const db = require('../../../store/db');

test('empty selection short-circuits with no DB call', async () => {
  let called = 0; const orig = db.query;
  db.query = async () => { called++; return []; };
  try {
    const r = await participation.unique_for_selection({ years: [] });
    assert.deepStrictEqual(r, { national: 0, byState: {}, byRegion: {} });
    assert.strictEqual(called, 0);
  } finally { db.query = orig; }
});

test('national comes from the ROLLUP row and is NOT the sum of states (non-additive)', async () => {
  const orig = db.query;
  db.query = async (sql) => (/state_code_events AS k/.test(sql)
    ? [{ k: 'CA', u: 100 }, { k: 'FL', u: 80 }, { k: null, u: 150 }]           // rollup national = 150
    : [{ k: 'Pacific', u: 120 }, { k: '', u: 0 }, { k: null, u: 150 }]);
  try {
    const r = await participation.unique_for_selection({ years: [2099] });      // unique year -> fresh cache key
    assert.strictEqual(r.national, 150);
    assert.strictEqual(r.byState.CA, 100);
    assert.strictEqual(r.byState.FL, 80);
    assert.strictEqual(r.byRegion.Pacific, 120);
    assert.ok(!('' in r.byRegion), 'blank/unresolved region key is dropped');
    const sumStates = Object.values(r.byState).reduce((a, b) => a + b, 0);      // 180
    assert.notStrictEqual(r.national, sumStates);                              // 150 != 180 — the point
  } finally { db.query = orig; }
});

test('WHERE reflects the filters, groups WITH ROLLUP, and caches by selection', async () => {
  const seen = []; const orig = db.query;
  db.query = async (sql, params) => { seen.push({ sql, params }); return [{ k: null, u: 5 }]; };
  try {
    await participation.unique_for_selection({ years: [2098], months: ['1', '2', '3'], region: 'Pacific', ironman: 'Yes' });
    const stq = seen.find((q) => /state_code_events AS k/.test(q.sql));
    assert.match(stq.sql, /start_date_year_races IN/);
    assert.match(stq.sql, /start_date_month_races IN/);
    assert.match(stq.sql, /region_name = \?/);
    assert.match(stq.sql, /is_ironman = 'Y'/);
    assert.match(stq.sql, /GROUP BY state_code_events WITH ROLLUP/);
    const before = seen.length;
    await participation.unique_for_selection({ years: [2098], months: ['1', '2', '3'], region: 'Pacific', ironman: 'Yes' });
    assert.strictEqual(seen.length, before, 'identical selection served from cache — no new query');
  } finally { db.query = orig; }
});

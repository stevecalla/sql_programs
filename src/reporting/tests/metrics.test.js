'use strict';
// Tests for the Usage-Metrics feature (reporting app). No real DB and no API key required:
//   - metrics_report.build_report:  the `pool` is stubbed so every SQL returns synthetic rows; we
//     assert the report contract (headline counts + every block) and that the headline windows carry
//     an is_test exclusion filter (so ?metrics_test=1 activity never inflates the figures).
//   - ask.js:  key-gating (no LLM key => list_models() empty + ask() rejects NO_AI_KEY) and the
//     read-only SELECT guard (assert_safe_select) rejecting non-SELECT / multi-statement / write SQL.
//   - track.js:  the pure path->panel mapping (panelForPath). track.js is a Vite ESM module (uses
//     import.meta.env), so it is loaded via a data: URL with that one Vite-only reference neutralized
//     — the pure export is what we test; the DOM trackers are covered elsewhere (browser only).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const metrics_report = require('../metrics/metrics_report');
const ask = require('../metrics/ask');

// ---------------------------------------------------------------------------------------------------
// A pool stub whose .query(sql, params) resolves synthetic rows chosen by inspecting the SQL. Returns
// the mysql2 tuple shape ([rows, fields]) the modules destructure. Records every SQL for assertions.
// ---------------------------------------------------------------------------------------------------
function makePoolStub() {
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push({ sql: String(sql), params: params || [] });
      const s = String(sql);
      let rows = [];
      if (/GROUP BY event_name/.test(s)) {
        rows = [
          { event_name: 'panel_view', n: 40 },
          { event_name: 'page_view', n: 5 },
          { event_name: 'filter_run', n: 12 },
          { event_name: 'search_run', n: 3 },
          { event_name: 'report_export', n: 7 },
        ];
      } else if (/COUNT\(DISTINCT visitor_id\)/.test(s)) {
        rows = [{ uniq: 9, ret_u: 4, actors: 3 }];
      } else if (/GROUP BY panel/.test(s)) {
        rows = [
          { panel: 'participation-maps', views: 30, filters: 10, exports: 5, events: 45 },
          { panel: 'metrics', views: 10, filters: 2, exports: 2, events: 14 },
        ];
      } else if (/event_name='report_export' AND view IS NOT NULL GROUP BY view/.test(s)) {
        rows = [{ view: '/', fmt: 'csv', n: 4 }, { view: '/', fmt: 'xlsx', n: 3 }];
      } else if (/GROUP BY filter_name/.test(s)) {
        rows = [{ f: 'year', n: 8 }, { f: 'state', n: 5 }];
      } else if (/GROUP BY actor ORDER BY events DESC/.test(s)) {
        rows = [{ a: 'alice', exports: 5, filters: 6, events: 30, last_seen: '2026-07-01 9:00 AM' }];
      } else if (/GROUP BY actor ORDER BY MAX\(ts\) DESC/.test(s)) {
        rows = [{ a: 'bob', events: 12, exports: 1, last_seen: '2026-07-02 8:00 AM' }];
      } else if (/GROUP BY d ORDER BY d/.test(s)) {
        rows = [
          { d: '2026-06-30', views: 20, filters: 5, exports: 3 },
          { d: '2026-07-01', views: 25, filters: 7, exports: 4 },
        ];
      } else if (/event_name='error'/.test(s)) {
        rows = [{ e: 'load_failed', n: 2 }];
      } else if (/GROUP BY visitor_id/.test(s)) {
        rows = [{ v: 'vid-1234567890abcdef', ret: 1, actor: 'alice', tz: 'America/Denver', viewport: 'lg', visits: 6, events: 20, last_seen: '2026-07-02 8:00 AM' }];
      } else if (/rows_total,\s*SUM\(CASE WHEN is_test=1/.test(s)) {
        rows = [{ rows_total: 200, test_rows: 15, latest: 'Jul 2, 2026 8:00 AM' }];
      } else if (/information_schema\.tables/.test(s)) {
        rows = [{ mb: 1.23 }];
      } else {
        rows = [];
      }
      return [rows, []];
    },
  };
  return { pool, seen };
}

// ===================================================================================================
// 1. metrics_report.build_report
// ===================================================================================================
test('build_report returns the full report contract (headline counts + every block)', async () => {
  const { pool } = makePoolStub();
  const report = await metrics_report.build_report(pool, { days: 30 });

  // Top-level contract shape.
  assert.ok(report && typeof report === 'object');
  assert.strictEqual(typeof report.title, 'string');
  assert.ok(Array.isArray(report.sections), 'report has human sections');
  assert.ok(report.data && typeof report.data === 'object', 'report.data present');

  const d = report.data;
  // Headline counts (derived from the event_name GROUP BY rows above).
  assert.strictEqual(d.days, 30);
  assert.strictEqual(d.panel_views, 45);           // panel_view(40) + page_view(5)
  assert.strictEqual(d.filters_run, 15);           // filter_run(12) + search_run(3)
  assert.strictEqual(d.exports, 7);                // report_export
  assert.strictEqual(d.unique_users, 9);
  assert.strictEqual(d.repeat_users, 4);
  assert.strictEqual(d.actors, 3);

  // Every documented block exists with the right type.
  for (const key of ['by_panel', 'by_day', 'top_operators', 'recent_active_users', 'visitors',
    'errors', 'exports_by_view', 'top_filters']) {
    assert.ok(Array.isArray(d[key]), 'block ' + key + ' is an array');
  }
  assert.ok(d.health && typeof d.health === 'object', 'health block present');
  for (const key of ['rows', 'test_rows']) {
    assert.strictEqual(typeof d.health[key], 'number', 'health.' + key + ' is numeric');
  }

  // Spot-check block contents map through correctly.
  assert.strictEqual(d.by_panel[0].panel, 'participation-maps');
  assert.strictEqual(d.by_panel[0].events, 45);
  assert.strictEqual(d.by_day.length, 2);
  assert.strictEqual(d.by_day[0].day, '2026-06-30');
  assert.strictEqual(d.top_operators[0].actor, 'alice');
  assert.strictEqual(d.recent_active_users[0].actor, 'bob');
  assert.strictEqual(d.visitors[0].device, 'desktop');   // viewport 'lg' -> 'desktop'
  assert.strictEqual(d.errors[0].type, 'load_failed');
  assert.strictEqual(d.health.rows, 200);
  assert.strictEqual(d.health.test_rows, 15);
});

test('headline windows exclude is_test rows (so ?metrics_test=1 never inflates the figures)', async () => {
  const { pool, seen } = makePoolStub();
  await metrics_report.build_report(pool, { days: 7 });

  // The headline event-count query (and the other windowed blocks) must carry an is_test filter.
  const headline = seen.find((q) => /GROUP BY event_name/.test(q.sql));
  assert.ok(headline, 'headline event-count query was issued');
  assert.match(headline.sql, /is_test IS NULL OR is_test\s*=\s*0/i,
    'headline WHERE excludes is_test=1 rows');

  // The windowed queries are parameterised by app='reporting'.
  assert.deepStrictEqual(headline.params, ['reporting']);

  // The whole-table health query, by contrast, still counts the test rows (they are reported/purgeable).
  const health = seen.find((q) => /SUM\(CASE WHEN is_test=1/.test(q.sql));
  assert.ok(health, 'health query was issued');
  assert.doesNotMatch(health.sql, /is_test IS NULL OR is_test\s*=\s*0/i,
    'health query counts the whole table incl. test rows');
});

test('build_report respects the days window and defaults to 7', async () => {
  const { pool, seen } = makePoolStub();
  await metrics_report.build_report(pool, { days: 90 });
  assert.ok(seen.some((q) => /INTERVAL 90 DAY/.test(q.sql)), 'uses the requested 90-day interval');

  const { pool: p2, seen: s2 } = makePoolStub();
  const rep = await metrics_report.build_report(p2, {});
  assert.strictEqual(rep.data.days, 7, 'defaults to 7 days');
  assert.ok(s2.some((q) => /INTERVAL 7 DAY/.test(q.sql)));
});

// ===================================================================================================
// 2. ask.js — key gating + read-only SELECT guard
// ===================================================================================================
// Ensure no LLM key leaks in from the environment for these tests.
function withoutKeys(fn) {
  return async () => {
    const a = process.env.ANTHROPIC_API_KEY, o = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
    try { await fn(); }
    finally {
      if (a !== undefined) process.env.ANTHROPIC_API_KEY = a;
      if (o !== undefined) process.env.OPENAI_API_KEY = o;
    }
  };
}

test('list_models() is empty when no LLM key is configured', withoutKeys(async () => {
  const m = ask.list_models();
  assert.ok(m && Array.isArray(m.models), 'returns { models: [] }');
  assert.strictEqual(m.models.length, 0, 'no models without a key');
  assert.strictEqual(ask.have_key(), false);
}));

test('ask() rejects with code NO_AI_KEY when no key is configured', withoutKeys(async () => {
  // A pool that would explode if reached — proves ask() short-circuits before touching the DB.
  const pool = { query() { throw new Error('DB must not be reached'); } };
  await assert.rejects(
    () => ask.ask(pool, { question: 'how many page views?' }),
    (e) => { assert.strictEqual(e.code, 'NO_AI_KEY'); return true; }
  );
  // Raw-SQL mode also requires a key (it dispatches through the same gate).
  await assert.rejects(
    () => ask.ask(pool, { mode: 'sql', sql: 'SELECT COUNT(*) FROM reporting_events' }),
    (e) => { assert.strictEqual(e.code, 'NO_AI_KEY'); return true; }
  );
}));

test('assert_safe_select accepts a plain SELECT over reporting_events and enforces a LIMIT', () => {
  const out = ask.assert_safe_select('SELECT event_name, COUNT(*) FROM reporting_events GROUP BY event_name');
  assert.match(out, /^SELECT/i);
  assert.match(out, /LIMIT \d+/i, 'a LIMIT is appended when absent');
});

test('assert_safe_select allows the WITH prefix (CTE) rather than rejecting it as non-SELECT', () => {
  // The guard permits a leading WITH (it is not treated as a disallowed statement type). It still
  // restricts every FROM/JOIN target to reporting_events, so a CTE that is re-referenced by its alias
  // is blocked by the table check — never by the statement-type check. Assert on that distinction.
  try {
    ask.assert_safe_select('WITH t AS (SELECT panel FROM reporting_events) SELECT * FROM t LIMIT 5');
  } catch (e) {
    assert.doesNotMatch(e.message, /only SELECT\/WITH allowed/i, 'WITH is accepted as a statement type');
    assert.match(e.message, /reporting_events table is allowed/i, 'blocked only by the table restriction');
  }
});

test('assert_safe_select rejects non-SELECT, multi-statement, and write queries', () => {
  const bad = [
    'DELETE FROM reporting_events',                                   // write
    'UPDATE reporting_events SET is_test=1',                          // write
    'INSERT INTO reporting_events (event_name) VALUES ("x")',         // write
    'DROP TABLE reporting_events',                                    // ddl
    'TRUNCATE reporting_events',                                      // ddl
    'SELECT 1; DROP TABLE reporting_events',                          // multi-statement
    'SELECT * FROM reporting_events; SELECT 2',                       // multi-statement
    '',                                                               // empty
  ];
  for (const sql of bad) {
    assert.throws(() => ask.assert_safe_select(sql), /.*/, 'should reject: ' + JSON.stringify(sql));
  }
});

test('assert_safe_select rejects reading any table other than reporting_events', () => {
  assert.throws(() => ask.assert_safe_select('SELECT * FROM users LIMIT 10'), /reporting_events table is allowed/i);
  assert.throws(() => ask.assert_safe_select('SELECT * FROM reporting_events JOIN salesforce_accounts LIMIT 10'), /reporting_events table is allowed/i);
});

test('assert_safe_select caps an over-large LIMIT to MAX_LIMIT', () => {
  const out = ask.assert_safe_select('SELECT * FROM reporting_events LIMIT 999999');
  assert.match(out, new RegExp('LIMIT ' + ask.MAX_LIMIT + '\\b'));
});

// ===================================================================================================
// 3. track.js — pure path->panel mapping (panelForPath)
// ===================================================================================================
// track.js is a Vite ESM module (references import.meta.env.BASE_URL, which is undefined under plain
// node). We load it from source via a data: URL with that one Vite-only reference neutralized, then
// test only the pure mapping export. The DOM trackers (track/trackPanelView/…) need a browser and are
// not unit-tested here.
async function loadTrack() {
  const p = path.join(__dirname, '..', 'web', 'src', 'lib', 'track.js');
  let src = fs.readFileSync(p, 'utf8');
  src = src.replace(/import\.meta\.env\.BASE_URL/g, "(globalThis.__TRACK_BASE_URL__ || '/')");
  const url = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  return import(url);
}

test('panelForPath maps representative routes to the right panel names', async () => {
  const { panelForPath } = await loadTrack();
  assert.strictEqual(typeof panelForPath, 'function');
  assert.strictEqual(panelForPath('/'), 'participation-maps');
  assert.strictEqual(panelForPath('/metrics'), 'metrics');
  assert.strictEqual(panelForPath('/admin'), 'admin');
  assert.strictEqual(panelForPath('/reference'), 'reference');
  // Unknown paths fall back to the path minus its leading slash.
  assert.strictEqual(panelForPath('/something-else'), 'something-else');
  // Empty / falsy path falls back to the default panel.
  assert.strictEqual(panelForPath(''), 'participation-maps');
});

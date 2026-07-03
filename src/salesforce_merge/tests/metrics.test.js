'use strict';
// Usage-analytics tests (no DB/AI): the read-only SQL guard for Ask-your-data, the event-column
// whitelist, and build_report's shape via a fake pool.
//   node --test src/salesforce_merge/tests/metrics.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../metrics/metrics_config');
const ask = require('../metrics/ask');
const metrics_report = require('../metrics/metrics_report');
const events = require('../metrics/events');

describe('metrics_config', () => {
  test('whitelist excludes id + stamped timestamps, includes the domain columns', () => {
    assert.ok(!cfg.COLUMNS.includes('id'));
    assert.ok(!cfg.COLUMNS.includes('created_at_utc'));
    assert.ok(!cfg.COLUMNS.includes('created_at_mtn'));
    for (const c of ['event_name', 'actor', 'panel', 'mode', 'outcome', 'set_count', 'env', 'is_test']) {
      assert.ok(cfg.COLUMNS.includes(c), 'missing ' + c);
    }
  });
});

describe('ask.assert_safe_select (read-only guard)', () => {
  const T = cfg.TABLE;
  test('allows a SELECT over the events table and injects a LIMIT', () => {
    const out = ask.assert_safe_select('SELECT actor, COUNT(*) FROM ' + T + ' GROUP BY actor');
    assert.match(out, /LIMIT \d+/i);
  });
  test('clamps an oversized LIMIT', () => {
    const out = ask.assert_safe_select('SELECT * FROM ' + T + ' LIMIT 999999');
    assert.match(out, new RegExp('LIMIT ' + ask.MAX_LIMIT + '\\b'));
  });
  test('rejects non-SELECT statements', () => {
    assert.throws(() => ask.assert_safe_select('UPDATE ' + T + ' SET actor=1'), /read-only/i);
    assert.throws(() => ask.assert_safe_select('DELETE FROM ' + T), /read-only/i);
  });
  test('rejects other tables and multiple statements', () => {
    assert.throws(() => ask.assert_safe_select('SELECT * FROM salesforce_account_duplicate_snapshot'), /only the .* table/i);
    assert.throws(() => ask.assert_safe_select('SELECT 1 FROM ' + T + '; DROP TABLE ' + T), /single statement/i);
  });
  test('blocks hidden dangerous keywords', () => {
    assert.throws(() => ask.assert_safe_select('SELECT sleep(5) FROM ' + T), /blocked keyword/i);
  });
});

describe('events.resolve_is_test (metrics_test param is the ONLY driver)', () => {
  test('is_test is 1 exactly when the metrics_test parameter is present — nothing else', () => {
    assert.equal(events.resolve_is_test(1), 1);
    assert.equal(events.resolve_is_test(0), 0);
    assert.equal(events.resolve_is_test(undefined), 0);
  });
});

describe('metrics_report.build_report', () => {
  test('returns a well-formed report contract from an empty dataset (fake pool)', async () => {
    const pool = { query: async () => [[]] };            // every query returns no rows
    const rep = await metrics_report.build_report(pool, { days: 30 });
    assert.equal(rep.data.days, 30);
    assert.equal(typeof rep.data.panel_views, 'number');
    assert.equal(rep.data.merge.execute_runs, 0);
    assert.ok(Array.isArray(rep.data.merge_funnel));
    assert.ok(Array.isArray(rep.data.restore_funnel));
    assert.ok(Array.isArray(rep.data.top_operators));
    assert.ok(Array.isArray(rep.sections));
    assert.match(rep.title, /Merge tool/);
  });
});

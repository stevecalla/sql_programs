'use strict';
// Analytics: column-whitelist + timestamp stamping (insert_event) and the metrics report contract
// (build_report) — both driven by a FAKE pool, so no DB is needed.
const test = require('node:test');
const assert = require('node:assert');
const { insert_event } = require('../../../utilities/analytics/event_ingest');
const metrics_report = require('../metrics/metrics_report');
const cfg = require('../metrics/metrics_config');

function fake_pool(capture) {
  return { query: function (sql, params) { capture.push({ sql: sql, params: params }); return Promise.resolve([[]]); } };
}

test('insert_event whitelists columns, drops unknowns, stamps both timestamps', async function () {
  const cap = [];
  const allow = new Set(cfg.COLUMNS);
  const wrote = await insert_event(fake_pool(cap), cfg.TABLE, allow, cfg.REPORTING_TZ, {
    event_name: 'ai_call', ai_provider: 'claude', ai_latency_ms: 1234,
    secret_member_email: 'nope@example.com',   // not whitelisted -> must be dropped
    is_test: 1
  });
  assert.strictEqual(wrote, true);
  const q = cap[0];
  assert.match(q.sql, new RegExp('INSERT INTO `' + cfg.TABLE + '`'));
  assert.ok(/created_at_utc/.test(q.sql) && /created_at_mtn/.test(q.sql), 'stamps both timestamps');
  assert.ok(/ai_provider/.test(q.sql) && /ai_latency_ms/.test(q.sql) && /is_test/.test(q.sql));
  assert.ok(!/secret_member_email/.test(q.sql), 'non-whitelisted column must be dropped');
});

test('insert_event no-ops on an all-unknown body', async function () {
  const cap = [];
  const wrote = await insert_event(fake_pool(cap), cfg.TABLE, new Set(cfg.COLUMNS), cfg.REPORTING_TZ, { not_a_col: 1 });
  assert.strictEqual(wrote, false);
  assert.strictEqual(cap.length, 0);
});

test('build_report returns the report contract with the AI-flow data block', async function () {
  // fake pool: every aggregate query returns [] -> all zeros, but the shape must be complete.
  const report = await metrics_report.build_report(fake_pool([]), { days: 14 });
  assert.match(report.title, /Email Queue/);
  assert.strictEqual(report.data.days, 14);
  assert.ok(report.data.ai && typeof report.data.ai.calls === 'number');
  ['by_action', 'by_provider', 'by_verdict', 'by_queue', 'top_operators', 'recent_operators', 'visitors', 'by_day', 'funnel'].forEach(function (k) {
    assert.ok(Array.isArray(report.data[k]), k + ' should be an array');
  });
  assert.ok(report.data.health && 'test_rows' in report.data.health);
  assert.ok(Array.isArray(report.sections) && report.sections.length >= 3);
});

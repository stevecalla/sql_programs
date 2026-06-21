'use strict';
// Analytics: column-whitelist + timestamp stamping (insert_event) and the metrics report contract
// (build_report) — both driven by a FAKE pool, so no DB is needed.
const test = require('node:test');
const assert = require('node:assert');
const { insert_event } = require('../../../utilities/analytics/event_ingest');
const retention = require('../../../utilities/analytics/retention');
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

test('purge_test with protect_cost keeps cost-bearing test rows, deletes $0 noise', async function () {
  const seen = [];
  const pool = { query: async function (sql) {
    seen.push(sql);
    if (/DELETE/i.test(sql)) return [{ affectedRows: 3 }];
    if (/ai_cost_usd,\s*0\)\s*>\s*0/.test(sql)) return [[{ n: 2, usd: 0.0123 }]];   // kept (cost) count
    return [[{ n: 3 }]];                                                            // $0 deletable count
  } };
  const r = await retention.purge_test(pool, 'tbl', { protect_cost: true });
  assert.strictEqual(r.deleted, 3);
  assert.strictEqual(r.kept_cost_rows, 2);
  assert.strictEqual(r.kept_cost_usd, 0.0123);
  // the DELETE must protect cost-bearing rows
  assert.ok(seen.some(function (s) { return /DELETE/i.test(s) && /ai_cost_usd/.test(s); }), 'delete excludes cost rows');
});
test('purge_test without opts is unchanged (transform back-compat: no ai_cost_usd reference)', async function () {
  const seen = [];
  const pool = { query: async function (sql) { seen.push(sql); if (/DELETE/i.test(sql)) return [{ affectedRows: 5 }]; return [[{ n: 5 }]]; } };
  const r = await retention.purge_test(pool, 'tbl');
  assert.strictEqual(r.deleted, 5);
  assert.ok(!seen.some(function (s) { return /ai_cost_usd/.test(s); }), 'no cost column referenced when protect_cost is off');
});

test('build_report returns the report contract with the AI-flow data block', async function () {
  // fake pool: every aggregate query returns [] -> all zeros, but the shape must be complete.
  const report = await metrics_report.build_report(fake_pool([]), { days: 14 });
  assert.match(report.title, /Email Queue/);
  assert.strictEqual(report.data.days, 14);
  assert.ok(report.data.ai && typeof report.data.ai.calls === 'number');
  ['by_action', 'by_provider', 'by_verdict', 'by_model', 'by_queue', 'top_operators', 'recent_operators', 'visitors', 'cases', 'case_funnel', 'sf_errors', 'context_changes', 'corrections', 'by_day', 'funnel'].forEach(function (k) {
    assert.ok(Array.isArray(report.data[k]), k + ' should be an array');
  });
  assert.ok(report.data.sf && 'sends' in report.data.sf && 'status_changes' in report.data.sf, 'sf write block');
  assert.strictEqual(typeof report.data.replies_copied, 'number', 'replies_copied count');
  assert.ok(report.data.health && 'test_rows' in report.data.health);
  assert.ok(Array.isArray(report.sections), 'sections is an array');
  // token + cost tracking block (zeros on an empty pool, but the shape must be present)
  assert.strictEqual(typeof report.data.ai.cost_usd, 'number', 'ai.cost_usd');
  assert.strictEqual(typeof report.data.ai.prompt_tokens, 'number', 'ai.prompt_tokens');
  assert.strictEqual(typeof report.data.ai.completion_tokens, 'number', 'ai.completion_tokens');
  // spend block: real / test / total (test spend is real money, so it's surfaced, not hidden)
  assert.ok(report.data.spend, 'spend block');
  ['real_usd', 'test_usd', 'total_usd'].forEach(function (k) { assert.strictEqual(typeof report.data.spend[k], 'number', 'spend.' + k); });
  assert.ok(Array.isArray(report.data.spend.by_env), 'spend.by_env array');
});
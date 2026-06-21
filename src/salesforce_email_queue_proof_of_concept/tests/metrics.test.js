'use strict';
// Metrics config + events-table DDL contract. Pure (no DB / no network).
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../metrics/metrics_config');
const { query_create_salesforce_email_queue_events_table } =
  require('../../queries/create_drop_db_table/query_create_salesforce_email_queue_events_table');

test('metrics_config identifies the email-queue app + table', function () {
  assert.strictEqual(cfg.APP, 'salesforce_email_queue');
  assert.strictEqual(cfg.TABLE, 'salesforce_email_queue_events');
  assert.strictEqual(cfg.REPORTING_TZ, 'America/Denver');
  assert.ok(cfg.KEEP_YEARS >= 1);
});

test('COLUMNS whitelist excludes id + stamped timestamps, includes AI-flow + is_test', function () {
  ['id', 'created_at_utc', 'created_at_mtn'].forEach(function (c) {
    assert.ok(cfg.COLUMNS.indexOf(c) < 0, c + ' must NOT be insertable');
  });
  ['is_test', 'is_demo', 'env', 'actor', 'queue', 'ai_action', 'ai_provider', 'ai_model', 'ai_verdict', 'ai_latency_ms',
   'ai_prompt_tokens', 'ai_completion_tokens', 'ai_cost_usd']
    .forEach(function (c) { assert.ok(cfg.COLUMNS.indexOf(c) >= 0, 'missing column ' + c); });
  // case_id/case_number ARE stored — Salesforce record pointers for per-case attribution, not member
  // content. What must NEVER be stored is any actual member data (names, bodies, addresses).
  ['case_id', 'case_number'].forEach(function (c) { assert.ok(cfg.COLUMNS.indexOf(c) >= 0, c + ' should be insertable'); });
  ['subject', 'body', 'text_body', 'from_address', 'email', 'member_name', 'name']
    .forEach(function (c) { assert.ok(cfg.COLUMNS.indexOf(c) < 0, c + ' (member content) must never be stored'); });
});

test('DDL is CREATE TABLE IF NOT EXISTS and covers every whitelisted column', async function () {
  const ddl = await query_create_salesforce_email_queue_events_table(cfg.TABLE);
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS/i);
  assert.ok(ddl.indexOf(cfg.TABLE) >= 0);
  cfg.COLUMNS.forEach(function (c) {
    assert.ok(new RegExp('\\b' + c + '\\b').test(ddl), 'DDL missing column ' + c);
  });
  // append-only: never a DROP
  assert.ok(!/DROP\s+TABLE/i.test(ddl), 'DDL must never drop');
});

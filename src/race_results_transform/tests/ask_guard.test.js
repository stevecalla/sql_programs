'use strict';
// Hardened read-only SQL guard.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { assert_safe_select } = require('../metrics/ask/sql_guard');
const T = require('../metrics/metrics_config').TABLE;   // race_results_transform_events

describe('ask_guard (read-only SQL guard)', () => {
  test('allows a simple aggregate SELECT and injects LIMIT when absent', () => {
    assert.match(assert_safe_select('SELECT COUNT(*) FROM ' + T), /LIMIT 1000$/);
  });
  test('keeps a small LIMIT, clamps a huge one to the max', () => {
    assert.match(assert_safe_select('SELECT * FROM ' + T + ' LIMIT 20'), /LIMIT 20$/);
    assert.match(assert_safe_select('SELECT * FROM ' + T + ' LIMIT 50000'), /LIMIT 1000\b/);
  });
  test('allows WITH (CTE) over the allowed table', () => {
    assert.doesNotThrow(() => assert_safe_select('WITH d AS (SELECT event_name FROM ' + T + ') SELECT COUNT(*) FROM d'));
  });
  test('allows the REPLACE() string function (no false positive)', () => {
    assert.doesNotThrow(() => assert_safe_select("SELECT REPLACE(file_name,'a','b') FROM " + T));
  });
  test('rejects writes and DDL', () => {
    ['UPDATE ' + T + ' SET x=1', 'DELETE FROM ' + T, 'DROP TABLE ' + T,
     'INSERT INTO ' + T + ' VALUES (1)', 'TRUNCATE ' + T
    ].forEach((q) => assert.throws(() => assert_safe_select(q), /read-only|not allowed|single statement/i));
  });
  test('rejects multiple statements', () => {
    assert.throws(() => assert_safe_select('SELECT 1 FROM ' + T + '; DROP TABLE ' + T), /single statement/i);
  });
  test('rejects an off-allowlist table', () => {
    assert.throws(() => assert_safe_select('SELECT * FROM membership_data'), /not allowed/i);
  });
  test('rejects DoS functions (SLEEP)', () => {
    assert.throws(() => assert_safe_select('SELECT SLEEP(5) FROM ' + T), /blocked|read-only/i);
  });
  test('comment-hidden keyword cannot sneak through', () => {
    assert.match(assert_safe_select('SELECT COUNT(*) FROM ' + T + ' -- ; DROP TABLE x'), /LIMIT 1000$/);
  });
});

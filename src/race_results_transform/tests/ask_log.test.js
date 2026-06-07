'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../metrics/ask/ask_log');

function mock_pool() {
  const calls = [];
  return { calls: calls, query: async function (sql, params) {
    calls.push({ sql: sql, params: params });
    if (/^\s*select/i.test(sql)) return [[{ created_at_mtn: 'x', surface: 'cli', provider: 'openai', model: 'm', ok: 1, row_count: 3, question: 'q', sql_text: 'SELECT 1', answer: 'a' }], []];
    return [{}, []];
  } };
}
describe('ask_log (db audit)', () => {
  test('append INSERTs into the ask_log table with the question', async () => {
    const pool = mock_pool();
    await log.append(pool, { surface: 'dashboard', question: 'how many?', provider: 'openai', model: 'm', sql: 'SELECT 1', ok: true, row_count: 2, answer: 'two' });
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].sql, /INSERT INTO `?race_results_transform_ask_log`?/i);
    assert.ok(pool.calls[0].params.indexOf('how many?') >= 0);
  });
  test('read returns rows from the table', async () => {
    const rows = await log.read(mock_pool(), 5);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question, 'q');
  });
  test('append never throws on a missing/broken pool', async () => {
    await log.append(null, { question: 'x' });
    await log.append({ query: async function () { throw new Error('db down'); } }, { question: 'x' });
  });
});

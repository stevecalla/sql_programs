'use strict';
// Chart-hint extraction (#65) and raw-SQL mode (#66), fully offline (no LLM, no DB).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extract_chart, ask_sql } = require('../metrics/ask/ask');
const T = require('../metrics/metrics_config').TABLE;

function mock_pool(rows) { return { query: async function () { return [rows, []]; } }; }
const two = [{ event_name: 'page_view', n: 9 }, { event_name: 'download', n: 3 }];

describe('extract_chart (#65 chart hint)', () => {
  test('valid hint -> chart spec + cleaned answer', () => {
    const a = 'Top events.\n```chart\n{"type":"bar","x":"event_name","y":"n"}\n```';
    const r = extract_chart(a, two);
    assert.deepEqual(r.chart, { type: 'bar', x: 'event_name', y: 'n' });
    assert.equal(r.answer, 'Top events.');
  });
  test('unknown type falls back to bar', () => {
    const r = extract_chart('x\n```chart\n{"type":"wat","x":"event_name","y":"n"}\n```', two);
    assert.equal(r.chart.type, 'bar');
  });
  test('line/pie types are preserved', () => {
    assert.equal(extract_chart('```chart\n{"type":"line","x":"event_name","y":"n"}\n```', two).chart.type, 'line');
    assert.equal(extract_chart('```chart\n{"type":"pie","x":"event_name","y":"n"}\n```', two).chart.type, 'pie');
  });
  test('column not in rows -> dropped', () => {
    assert.equal(extract_chart('```chart\n{"type":"bar","x":"nope","y":"n"}\n```', two).chart, null);
  });
  test('fewer than 2 rows -> no chart', () => {
    assert.equal(extract_chart('```chart\n{"type":"bar","x":"event_name","y":"n"}\n```', [two[0]]).chart, null);
  });
  test('bad JSON -> dropped, answer still cleaned', () => {
    const r = extract_chart('See below.\n```chart\nnot json\n```', two);
    assert.equal(r.chart, null);
    assert.equal(r.answer, 'See below.');
  });
  test('no hint -> null chart, trimmed answer', () => {
    const r = extract_chart('Just five.  ', two);
    assert.equal(r.chart, null);
    assert.equal(r.answer, 'Just five.');
  });
});

describe('ask_sql (#66 raw read-only SQL mode)', () => {
  test('SELECT runs, LIMIT injected, mode=sql', async () => {
    const r = await ask_sql('SELECT event_name, COUNT(*) AS n FROM ' + T + ' GROUP BY 1', { pool: mock_pool([{ event_name: 'page_view', n: 9 }]) });
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'sql');
    assert.equal(r.provider, null);
    assert.match(r.sql, /LIMIT 1000$/);
    assert.equal(r.rows.length, 1);
    assert.equal(r.chart, null);
  });
  test('a write statement is rejected by the guard (throws)', async () => {
    await assert.rejects(function () { return ask_sql('DELETE FROM ' + T, { pool: mock_pool([]) }); });
  });
  test('a disallowed table is rejected (throws)', async () => {
    await assert.rejects(function () { return ask_sql('SELECT * FROM membership_data', { pool: mock_pool([]) }); });
  });
});

// Pure builder for the Process page "Activity — recent runs" live row. No DOM / DB.
//   node --test modules/salesforce_merge/tests/activity_rows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityRows, elapsedSeconds, fmtClock, titleCase } from '../../../web/src/modules/salesforce_merge/lib/activity.js';

const START = '2026-07-16T15:00:00.000Z';
const NOW = new Date('2026-07-16T15:02:07.000Z').getTime(); // 2m 07s later

test('no run in progress -> rows unchanged', () => {
  const runs = [{ run_type: 'finder', duration_seconds: 42 }];
  assert.deepEqual(buildActivityRows({ running: false, run: null }, runs, NOW), runs);
  assert.deepEqual(buildActivityRows(null, runs, NOW), runs);
});

test('running finder -> prepends a live row with a numeric elapsed + env/scope titled', () => {
  const status = { running: true, run: { job: 'finder', env: 'sandbox', scope: 'full', started_at: START } };
  const runs = [{ run_type: 'finder', duration_seconds: 42 }];
  const out = buildActivityRows(status, runs, NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].live, true);
  assert.equal(out[0].run_type, 'finder');
  assert.equal(out[0].environment, 'Sandbox');
  assert.equal(out[0].scope, 'Full');
  assert.equal(out[0].total_records, null);
  assert.equal(out[0].duration_seconds, 127);     // 2m07s
  assert.equal(out[0].run_at, START);
  assert.deepEqual(out[1], runs[0]);              // finals untouched, below the live row
});

test('running sweep -> run_type = sweep', () => {
  const status = { running: true, run: { job: 'sweep', env: 'production', scope: 'sample', started_at: START } };
  assert.equal(buildActivityRows(status, [], NOW)[0].run_type, 'sweep');
  assert.equal(buildActivityRows(status, [], NOW)[0].environment, 'Production');
});

test('running but no started_at -> no live row (avoid NaN clock)', () => {
  const status = { running: true, run: { job: 'finder', env: 'sandbox', scope: 'full', started_at: null } };
  assert.deepEqual(buildActivityRows(status, [], NOW), []);
});

test('elapsedSeconds never negative; fmtClock formats mm ss', () => {
  assert.equal(elapsedSeconds(START, new Date('2026-07-16T14:59:00Z').getTime()), 0);
  assert.equal(elapsedSeconds(null, NOW), null);
  assert.equal(fmtClock(127), '2m 07s');
  assert.equal(fmtClock(7), '0m 07s');
  assert.equal(fmtClock(null), '');
  assert.equal(titleCase('sandbox'), 'Sandbox');
});

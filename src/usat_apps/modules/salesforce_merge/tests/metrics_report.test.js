'use strict';
// Unit tests for the Salesforce Merge module's metrics_report.build_report — the funnel + queue
// stats that feed the SF Merge dashboard. No DB: the `pool` is stubbed so each SQL returns synthetic
// rows chosen by inspecting the SQL string. Focus:
//   - the merge funnel (Queued / Approved / ... ) counts SETS from the queue events,
//   - the new `queue_removes` stat is surfaced,
//   - Queued never goes NaN when an event type (e.g. queue_bulk_add) is absent (regression guard for
//     the `undefined + number = NaN` bug that blanked the funnel), and
//   - the "Include test rows" toggle flips the is_test WHERE filter.
const test = require('node:test');
const assert = require('node:assert');

const metrics_report = require('../metrics/metrics_report');

// Stub pool. Records every SQL for assertions. Note there is deliberately NO queue_bulk_add row, so
// setmap.queue_bulk_add / cmap.queue_bulk_add are undefined — the funnel must still be a real number.
function makePoolStub() {
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push({ sql: String(sql), params: params || [] });
      const s = String(sql);
      let rows = [];
      if (/SELECT event_name, COUNT\(\*\) n, SUM\(set_count\) sets/.test(s)) {
        rows = [
          { event_name: 'queue_add', n: 2, sets: 2, accts: 0 },
          { event_name: 'queue_approve', n: 2, sets: 2, accts: 0 },
          { event_name: 'queue_remove', n: 3, sets: 3, accts: 0 },
          { event_name: 'merge_run', n: 2, sets: 0, accts: 0 },
          { event_name: 'panel_view', n: 20, sets: 0, accts: 0 },
        ];
      } else if (/COUNT\(DISTINCT visitor_id\)/.test(s)) {
        rows = [{ uniq: 1, ret_u: 1, actors: 1 }];
      } else if (/event_name='merge_run' GROUP BY mode/.test(s)) {
        rows = [{ mode: 'simulate', runs: 2, sets: 0, accts: 0, failed: 0, avg_ms: 5 }];
      } else if (/rows_total,\s*SUM\(CASE WHEN is_test=1/.test(s)) {
        rows = [{ rows_total: 81, test_rows: 31, latest: 'Jul 12, 2026 4:52 PM' }];
      } else if (/information_schema\.tables/.test(s)) {
        rows = [{ mb: 0.1 }];
      } else {
        rows = [];
      }
      return [rows, []];
    },
  };
  return { pool, seen };
}

test('merge funnel counts sets and Queued is a real number (no NaN) when bulk-add is absent', async () => {
  const { pool } = makePoolStub();
  const report = await metrics_report.build_report(pool, { days: 7, include_test: true });
  const d = report.data;

  const queued = d.merge_funnel.find((f) => f.stage === 'Queued');
  const approved = d.merge_funnel.find((f) => f.stage === 'Approved');
  assert.ok(queued, 'Queued stage present');
  assert.strictEqual(typeof queued.n, 'number');
  assert.ok(!Number.isNaN(queued.n), 'Queued is not NaN');
  assert.strictEqual(queued.n, 2, 'Queued = SUM(set_count) of queue_add (2), bulk-add absent');
  assert.strictEqual(approved.n, 2, 'Approved = queue_approve sets (2)');
});

test('queue_removes is surfaced as its own stat', async () => {
  const { pool } = makePoolStub();
  const report = await metrics_report.build_report(pool, { days: 7, include_test: true });
  assert.strictEqual(report.data.queue_removes, 3, 'queue_remove SUM(set_count) = 3');
});

test('build_report defaults to a 7-day window', async () => {
  const { pool } = makePoolStub();
  const report = await metrics_report.build_report(pool, {});
  assert.strictEqual(report.data.days, 7);
});

test('Include-test toggle flips the is_test WHERE filter', async () => {
  const excl = makePoolStub();
  await metrics_report.build_report(excl.pool, { days: 7 });                 // include_test falsy -> exclude
  const hExcl = excl.seen.find((q) => /GROUP BY event_name/.test(q.sql));
  assert.match(hExcl.sql, /is_test IS NULL OR is_test\s*=\s*0/i, 'excludes test rows by default');

  const incl = makePoolStub();
  await metrics_report.build_report(incl.pool, { days: 7, include_test: true });
  const hIncl = incl.seen.find((q) => /GROUP BY event_name/.test(q.sql));
  assert.doesNotMatch(hIncl.sql, /is_test IS NULL OR is_test\s*=\s*0/i, 'includes test rows when toggled on');
});

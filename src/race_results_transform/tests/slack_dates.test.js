'use strict';
// Slack date helpers — pure, no network. Mountain-Time day filtering over Unix-seconds file records +
// the padded ts window we hand to files.list.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../slack/slack_dates');

// 2026-06-10 12:00 MDT (UTC-6 in June) == 2026-06-10T18:00:00Z
const JUN10_NOON_MT_MS = Date.parse('2026-06-10T18:00:00Z');

describe('slack_dates', () => {
  test('ymd_in_time_zone maps a Unix-ms instant to its Mountain-Time day', () => {
    assert.equal(dates.ymd_in_time_zone(JUN10_NOON_MT_MS, dates.DEFAULT_TZ), '2026-06-10');
  });

  test('make_date_filter keeps/drops by the record created_ms (specific + range)', () => {
    const record = { created_ms: JUN10_NOON_MT_MS };
    assert.equal(dates.make_date_filter({ mode: 'specific', date: '2026-06-10' })(record), true);
    assert.equal(dates.make_date_filter({ mode: 'specific', date: '2026-06-11' })(record), false);
    assert.equal(dates.make_date_filter({ mode: 'range', start: '2026-06-01', end: '2026-06-30' })(record), true);
    assert.equal(dates.make_date_filter({ mode: 'range', start: '2026-06-11', end: '2026-06-30' })(record), false);
    assert.equal(dates.make_date_filter({ mode: 'all' })(record), true);
  });

  test('slack_ts_window pads the range ±1 day and is unbounded for mode=all', () => {
    const all = dates.slack_ts_window({ mode: 'all' });
    assert.equal(all.ts_from, undefined);
    assert.equal(all.ts_to, undefined);

    const win = dates.slack_ts_window({ mode: 'range', start: '2026-06-10', end: '2026-06-12' });
    const day = 86400;
    assert.equal(win.ts_from, dates.ymd_to_utc_seconds('2026-06-10') - day);
    assert.equal(win.ts_to, dates.ymd_to_utc_seconds('2026-06-12') + 2 * day);
    assert.ok(win.ts_from < win.ts_to);
  });

  test('slack_ts_window for a single specific day still brackets it', () => {
    const win = dates.slack_ts_window({ mode: 'specific', date: '2026-06-10' });
    assert.ok(win.ts_from < dates.ymd_to_utc_seconds('2026-06-10'));
    assert.ok(win.ts_to > dates.ymd_to_utc_seconds('2026-06-10'));
  });
});

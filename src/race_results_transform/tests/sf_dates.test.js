'use strict';
// Mountain-Time date helpers + the date-filter predicate (today/specific/range), incl. DST.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ymd_in_time_zone, make_date_filter } = require('../sf/sf_dates');

describe('sf_dates', () => {
  test('ymd_in_time_zone converts UTC to the MT calendar date (DST-aware)', () => {
    // Summer (MDT, UTC-6): 2026-06-02T05:30Z = 2026-06-01 23:30 MT
    assert.equal(ymd_in_time_zone('2026-06-02T05:30:00Z', 'America/Denver'), '2026-06-01');
    // Winter (MST, UTC-7): 2026-01-02T05:30Z = 2026-01-01 22:30 MT
    assert.equal(ymd_in_time_zone('2026-01-02T05:30:00Z', 'America/Denver'), '2026-01-01');
    // Mid-day UTC stays same day
    assert.equal(ymd_in_time_zone('2026-06-02T18:00:00Z', 'America/Denver'), '2026-06-02');
    assert.equal(ymd_in_time_zone('', 'America/Denver'), '');
  });

  test('make_date_filter: all keeps everything', () => {
    const keep = make_date_filter({ mode: 'all' });
    assert.equal(keep({ LastModifiedDate: '2020-01-01T00:00:00Z' }), true);
  });

  test('make_date_filter: specific matches the MT day of the chosen field', () => {
    const keep = make_date_filter({ mode: 'specific', field: 'LastModifiedDate', date: '2026-06-01', tz: 'America/Denver' });
    assert.equal(keep({ LastModifiedDate: '2026-06-02T05:30:00Z' }), true);  // -> 2026-06-01 MT
    assert.equal(keep({ LastModifiedDate: '2026-06-02T18:00:00Z' }), false); // -> 2026-06-02 MT
  });

  test('make_date_filter: range is inclusive on both ends (MT)', () => {
    const keep = make_date_filter({ mode: 'range', field: 'LastModifiedDate', start: '2026-06-01', end: '2026-06-03', tz: 'America/Denver' });
    assert.equal(keep({ LastModifiedDate: '2026-06-01T18:00:00Z' }), true);
    assert.equal(keep({ LastModifiedDate: '2026-06-03T18:00:00Z' }), true);
    assert.equal(keep({ LastModifiedDate: '2026-06-04T18:00:00Z' }), false);
  });

  test('make_date_filter: missing date value is excluded (not "today")', () => {
    const keep = make_date_filter({ mode: 'specific', date: '2026-06-01' });
    assert.equal(keep({ LastModifiedDate: null }), false);
  });
});

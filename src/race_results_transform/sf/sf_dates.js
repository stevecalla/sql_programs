'use strict';
// Mountain-Time date helpers + the date-filter predicate for Salesforce race-results files.
// Pure + isomorphic (uses Intl, available in Node and the browser). Tested.

const DEFAULT_TZ = 'America/Denver';   // handles MST/MDT automatically

// YYYY-MM-DD for an instant, in the given IANA time zone.
function ymd_in_time_zone(value, time_zone) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: time_zone || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const get = function (t) { const p = parts.find(function (x) { return x.type === t; }); return p && p.value; };
  const y = get('year'), m = get('month'), d = get('day');
  return (y && m && d) ? (y + '-' + m + '-' + d) : '';
}

// "Mon DD, YYYY h:mm:ss AM/PM TZ" for display, in the given time zone.
function datetime_in_time_zone(value, time_zone) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: time_zone || DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
  }).format(new Date(value));
}

function today_ymd_in_time_zone(time_zone) {
  return ymd_in_time_zone(new Date(), time_zone);
}

// filter = { mode: 'all'|'today'|'specific'|'range', field, date, start, end, tz }
// Returns a predicate over a Salesforce file record (uses record[field], default LastModifiedDate).
function make_date_filter(filter) {
  const f = filter || {};
  const mode = f.mode || 'all';
  const field = f.field || 'LastModifiedDate';
  const tz = f.tz || DEFAULT_TZ;
  return function (record) {
    if (mode === 'all') return true;
    const file_ymd = ymd_in_time_zone(record && record[field], tz);
    if (!file_ymd) return false;
    if (mode === 'today') return file_ymd === today_ymd_in_time_zone(tz);
    if (mode === 'specific') return file_ymd === f.date;
    if (mode === 'range') return file_ymd >= f.start && file_ymd <= f.end;
    throw new Error('Unsupported date filter mode: ' + mode);
  };
}

module.exports = {
  DEFAULT_TZ, ymd_in_time_zone, datetime_in_time_zone, today_ymd_in_time_zone, make_date_filter
};

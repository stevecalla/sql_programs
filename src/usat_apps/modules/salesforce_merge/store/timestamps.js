'use strict';
// created_at_mtn / created_at_utc — matches the event/participation tables' convention: two wall-clock
// DATETIME columns (Denver local + UTC), written by the app at insert time (not DB-generated), so a row
// carries both the local time an operator sees and the unambiguous UTC time. Dependency-free (Intl).
function fmt(d, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)) p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;   // some engines emit hour '24' at midnight
  return p.year + '-' + p.month + '-' + p.day + ' ' + hh + ':' + p.minute + ':' + p.second;
}

// { mtn: 'YYYY-MM-DD HH:mm:ss' (America/Denver), utc: 'YYYY-MM-DD HH:mm:ss' (UTC) }
function now_mtn_utc(d) {
  d = d || new Date();
  return { mtn: fmt(d, 'America/Denver'), utc: fmt(d, 'UTC') };
}

module.exports = { now_mtn_utc, fmt };

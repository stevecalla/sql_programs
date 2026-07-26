'use strict';
// timestamps.js — created_at_mtn / created_at_utc wall-clocks (Denver local + UTC), app-written at insert
// time, matching the event/participation table convention. Dependency-free (Intl).
function fmt(d, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)) p[part.type] = part.value;
  const hh = p.hour === '24' ? '00' : p.hour;
  return p.year + '-' + p.month + '-' + p.day + ' ' + hh + ':' + p.minute + ':' + p.second;
}
function now_mtn_utc(d) {
  d = d || new Date();
  return { mtn: fmt(d, 'America/Denver'), utc: fmt(d, 'UTC') };
}
module.exports = { now_mtn_utc, fmt };

'use strict';
// Date helpers for the Slack intake. Reuses the Mountain-Time formatters from the SF module (one
// source of truth) and adds Slack-specific bits:
//   - slack_ts_window(filter): a generous UTC ts_from/ts_to (Unix seconds) to pass to files.list,
//     padded ±1 day so a wanted file is never excluded by tz drift; the precise MT filtering is done
//     client-side by make_date_filter on each file's `created_ms`.
//   - SECONDS_FIELD: the record field (`created_ms`) the SF make_date_filter reads (it does
//     new Date(value) → ymd-in-TZ; milliseconds parse correctly).
const sf_dates = require('../sf/sf_dates');

const DEFAULT_TZ = sf_dates.DEFAULT_TZ;
const SECONDS_FIELD = 'created_ms';   // each normalized Slack record carries created_ms (Unix ms)

function ymd_to_utc_seconds(ymd) {
  const ms = Date.parse(ymd + 'T00:00:00Z');
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// filter = { mode: 'all'|'today'|'specific'|'range', date, start, end, tz }
// -> { ts_from, ts_to } in Unix SECONDS for Slack files.list, padded ±1 day (null = unbounded).
function slack_ts_window(filter) {
  const f = filter || {};
  const mode = f.mode || 'all';
  const day = 86400;
  if (mode === 'all') return { ts_from: undefined, ts_to: undefined };
  let start_ymd, end_ymd;
  if (mode === 'today') { start_ymd = end_ymd = sf_dates.today_ymd_in_time_zone(f.tz || DEFAULT_TZ); }
  else if (mode === 'specific') { start_ymd = end_ymd = f.date; }
  else { start_ymd = f.start; end_ymd = f.end; }
  const lo = ymd_to_utc_seconds(start_ymd);
  const hi = ymd_to_utc_seconds(end_ymd);
  return {
    ts_from: lo == null ? undefined : (lo - day),            // pad a day earlier
    ts_to: hi == null ? undefined : (hi + 2 * day)           // pad to end of next day
  };
}

// A predicate over a normalized Slack record using the precise MT day filter (reads `created_ms`).
function make_date_filter(filter) {
  const f = Object.assign({}, filter || {});
  f.field = SECONDS_FIELD;
  return sf_dates.make_date_filter(f);
}

module.exports = {
  DEFAULT_TZ,
  SECONDS_FIELD,
  ymd_to_utc_seconds,
  slack_ts_window,
  make_date_filter,
  ymd_in_time_zone: sf_dates.ymd_in_time_zone,
  datetime_in_time_zone: sf_dates.datetime_in_time_zone,
  today_ymd_in_time_zone: sf_dates.today_ymd_in_time_zone
};

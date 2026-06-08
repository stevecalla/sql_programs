'use strict';
// G1: a compact "live metrics snapshot" string for AI grounding (orientation only).
// Reuses the dashboard's build_report so the AI sees the same current aggregates.
// Returns null on any failure so ask() degrades gracefully (snapshot is optional).
const metrics = require('../metrics_report');

async function live_snapshot(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 30;
  if (!pool) return null;
  try {
    const d = await metrics.build_report(pool, { days: days });
    const lines = [];
    lines.push('Window: last ' + d.days + ' days (Mountain Time).');
    lines.push('Visits ' + d.visits + ' (unique visitors ' + d.unique_users + ', new ' + d.new_users + ', returning ' + d.repeat_users + ').');
    lines.push('Uploads ' + d.uploads + ', conversions ' + d.conversions + ', downloads ' + d.downloads + ', start-overs ' + d.start_overs + '.');
    if (d.file_types && d.file_types.length) lines.push('File types: ' + d.file_types.map(function (f) { return f.type + ' ' + f.n; }).join(', ') + '.');
    if (d.errors && d.errors.length) lines.push('Errors: ' + d.errors.map(function (e) { return e.type + ' ' + e.n; }).join(', ') + '.');
    if (d.by_day && d.by_day.length) {
      const last = d.by_day[d.by_day.length - 1];
      lines.push('Most recent day ' + last.day + ': ' + last.visits + ' visits, ' + last.uploads + ' uploads, ' + last.downloads + ' downloads.');
    }
    return lines.join('\n');
  } catch (e) { return null; }
}
module.exports = { live_snapshot };

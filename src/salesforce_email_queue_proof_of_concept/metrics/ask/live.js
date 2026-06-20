'use strict';
// Compact "live metrics snapshot" string for AI grounding (orientation only). Reuses the dashboard's
// build_report so the assistant sees the same current aggregates. Returns null on any failure.
const metrics = require('../metrics_report');

async function live_snapshot(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 30;
  if (!pool) return null;
  try {
    const report = await metrics.build_report(pool, { days: days });
    const d = report.data;
    const lines = [];
    lines.push('Window: last ' + d.days + ' days (Mountain Time).');
    lines.push('Visits ' + d.visits + ' (unique ' + d.unique_users + ', actors ' + d.operators + '). Threads opened ' + d.threads_opened + ', acknowledgements ' + d.acknowledgements + '.');
    lines.push('AI calls ' + d.ai.calls + ' (' + d.ai.success_pct + '% ok, avg ' + d.ai.avg_ms + 'ms, grounded ' + d.ai.grounded_pct + '%).');
    if (d.by_provider && d.by_provider.length) lines.push('Providers: ' + d.by_provider.map(function (p) { return p.provider + ' ' + p.n; }).join(', ') + '.');
    if (d.by_verdict && d.by_verdict.length) lines.push('Verdicts: ' + d.by_verdict.map(function (v) { return v.verdict + ' ' + v.n; }).join(', ') + '.');
    if (d.by_queue && d.by_queue.length) lines.push('Top queue: ' + d.by_queue[0].queue + ' (' + d.by_queue[0].ai_calls + ' AI calls).');
    return lines.join('\n');
  } catch (e) { return null; }
}
module.exports = { live_snapshot };

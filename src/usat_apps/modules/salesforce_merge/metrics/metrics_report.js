'use strict';
// App-specific analytics aggregation for the Salesforce Merge tool. Returns the shared "report
// contract" (structured `data` + human `sections`) consumed by the React /metrics dashboard and a
// CLI. Mirrors src/salesforce_email_queue_proof_of_concept/metrics/metrics_report.js: same
// mysql2/promise + utilities/analytics retention/render reuse. `pool` is injected (from store/db).
const retention = require('../../../../../utilities/analytics/retention');
const render = require('../../../../../utilities/analytics/report_render');
const cfg = require('./metrics_config');

const T = cfg.TABLE;
async function q(pool, sql, params) { const [rows] = await pool.query(sql, params || []); return rows; }
function n0(v) { return v == null ? 0 : Number(v); }
function pct(num, den) { return den ? Math.round(1000 * num / den) / 10 : 0; }

// Aggregate the last `days` days into structured data + the report contract.
async function build_report(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 7;
  const since = 'created_at_utc >= UTC_TIMESTAMP() - INTERVAL ' + days + ' DAY';
  // Headline window excludes is_test=1 by default so flagged test activity never inflates the dashboard;
  // include_test (the "Include test rows" toggle) flips that on. Test rows are always counted in `health`.
  const test_filter = opts.include_test ? '' : ' AND (is_test IS NULL OR is_test = 0)';
  const W = '`' + T + '` WHERE app = ? AND ' + since + test_filter;
  const A = [cfg.APP];

  const counts = await q(pool, 'SELECT event_name, COUNT(*) n, SUM(set_count) sets, SUM(account_count) accts FROM ' + W + ' GROUP BY event_name', A);
  const cmap = {}; const setmap = {}; const acctmap = {};
  counts.forEach(function (r) { cmap[r.event_name] = n0(r.n); setmap[r.event_name] = n0(r.sets); acctmap[r.event_name] = n0(r.accts); });

  const users = (await q(pool,
    'SELECT COUNT(DISTINCT visitor_id) uniq, ' +
    'COUNT(DISTINCT CASE WHEN is_returning=1 THEN visitor_id END) ret_u, ' +
    'COUNT(DISTINCT actor) actors ' +
    'FROM ' + W, A))[0] || {};

  // ---- where in the app: panel views / filters / exports ----
  const by_panel = await q(pool,
    "SELECT panel, SUM(event_name='panel_view') views, SUM(event_name='filter_run') filters, " +
    "SUM(event_name='report_export') exports, COUNT(*) events " +
    'FROM ' + W + " AND panel IS NOT NULL AND panel<>'' GROUP BY panel ORDER BY events DESC", A);
  const exports_by_view = await q(pool,
    "SELECT view, export_format fmt, COUNT(*) n FROM " + W + " AND event_name='report_export' AND view IS NOT NULL GROUP BY view, export_format ORDER BY n DESC", A);
  const top_filters = await q(pool,
    "SELECT filter_name f, COUNT(*) n FROM " + W + " AND event_name IN ('filter_run','search_run') AND filter_name IS NOT NULL AND filter_name<>'' GROUP BY filter_name ORDER BY n DESC LIMIT 10", A);

  // ---- data builds ----
  const builds = (await q(pool,
    "SELECT COUNT(*) runs, SUM(outcome='done' OR outcome='ok') ok, SUM(outcome='failed') failed, " +
    'AVG(duration_ms) avg_ms, SUM(row_count) rows_built ' +
    'FROM ' + W + " AND event_name='data_build'", A))[0] || {};

  // ---- merge funnel (queue -> approve -> execute) ----
  const queued = (setmap.queue_add || cmap.queue_add || 0) + (setmap.queue_bulk_add || cmap.queue_bulk_add || 0); // sets if logged, else event count
  const approved = setmap.queue_approve || cmap.queue_approve || 0;
  const removed = (setmap.queue_remove || cmap.queue_remove || 0);   // sets if logged, else event count
  const mergeRuns = (await q(pool,
    "SELECT mode, COUNT(*) runs, SUM(set_count) sets, SUM(account_count) accts, SUM(outcome='failed') failed, AVG(duration_ms) avg_ms " +
    'FROM ' + W + " AND event_name='merge_run' GROUP BY mode", A));
  const mergeByMode = {}; mergeRuns.forEach(function (r) { mergeByMode[r.mode || 'simulate'] = r; });
  const exec = mergeByMode.execute || {}; const sim = mergeByMode.simulate || {};

  // ---- restore funnel ----
  const restoreRuns = (await q(pool,
    "SELECT event_name, mode, COUNT(*) runs, SUM(set_count) sets, SUM(outcome='failed') failed " +
    'FROM ' + W + " AND event_name IN ('restore_run','recreate_run') GROUP BY event_name, mode", A));
  const restoreExec = restoreRuns.filter(function (r) { return r.mode === 'execute'; });
  const restored_sets = restoreExec.filter(function (r) { return r.event_name === 'restore_run'; }).reduce(function (s, r) { return s + n0(r.sets); }, 0);
  const recreated_sets = restoreExec.filter(function (r) { return r.event_name === 'recreate_run'; }).reduce(function (s, r) { return s + n0(r.sets); }, 0);

  // ---- per-user leaderboard ----
  const top_ops = await q(pool,
    "SELECT actor a, " +
    "SUM(event_name='merge_run' AND mode='execute') merges, " +
    "SUM(event_name IN ('restore_run','recreate_run') AND mode='execute') restores, " +
    "SUM(event_name IN ('queue_add','queue_bulk_add')) queue_adds, " +
    "SUM(event_name='report_export') exports, SUM(event_name='data_build') builds, COUNT(*) events, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY merges DESC, events DESC LIMIT 10", A);

  // ---- time series ----
  const by_day = await q(pool,
    "SELECT DATE(COALESCE(created_at_mtn, created_at_utc)) d, " +
    "SUM(event_name='panel_view') views, SUM(event_name='merge_run' AND mode='execute') merges, " +
    "SUM(event_name IN ('restore_run','recreate_run') AND mode='execute') restores, SUM(event_name='data_build') builds " +
    'FROM ' + W + ' GROUP BY d ORDER BY d', A);
  const by_hour = await q(pool, "SELECT local_hour h, COUNT(*) n FROM " + W + ' AND local_hour IS NOT NULL GROUP BY local_hour ORDER BY local_hour', A);
  const by_dow = await q(pool, "SELECT local_dow d, COUNT(*) n FROM " + W + ' AND local_dow IS NOT NULL GROUP BY local_dow ORDER BY n DESC', A);

  // ---- Sandbox vs Production split (over the window, NOT is_test-filtered) ----
  const by_env = await q(pool,
    "SELECT COALESCE(env,'prod') env, SUM(event_name='merge_run' AND mode='execute') merges, " +
    "SUM(event_name IN ('restore_run','recreate_run') AND mode='execute') restores, COUNT(*) events " +
    'FROM `' + T + '` WHERE app = ? AND ' + since + " GROUP BY COALESCE(env,'prod')", A);

  const errors = await q(pool, "SELECT error_type e, COUNT(*) n FROM " + W + " AND event_name='error' AND error_type IS NOT NULL GROUP BY error_type ORDER BY n DESC", A);

  // ---- recent active users + anonymous visitors (mirrors the email-queue dashboard) ----
  const recent_users = await q(pool,
    "SELECT actor a, COUNT(*) events, SUM(event_name='merge_run' AND mode='execute') merges, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY MAX(created_at_mtn) DESC LIMIT 10", A);
  const visitors = await q(pool,
    "SELECT visitor_id v, MAX(is_returning) ret, " +
    "SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(actor,'') ORDER BY created_at_mtn DESC SEPARATOR 0x1f), 0x1f, 1) actor, " +
    "MAX(client_tz) tz, MAX(viewport) viewport, SUM(event_name='panel_view') visits, COUNT(*) events, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') last_seen " +
    'FROM ' + W + " AND visitor_id IS NOT NULL GROUP BY visitor_id ORDER BY events DESC LIMIT 15", A);
  const device = function (vp) { return vp === 'sm' ? 'mobile' : vp === 'md' ? 'tablet' : vp === 'lg' ? 'desktop' : (vp || '—'); };

  // ---- health (whole table) ----
  const health = (await q(pool, "SELECT COUNT(*) rows_total, SUM(CASE WHEN is_test=1 THEN 1 ELSE 0 END) test_rows, DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i:%s') latest FROM `" + T + "`"))[0] || {};
  const sizerow = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [T]))[0] || {};

  const data = {
    days: days,
    panel_views: cmap.panel_view || 0,
    unique_users: n0(users.uniq), repeat_users: n0(users.ret_u), actors: n0(users.actors),
    filters_run: (cmap.filter_run || 0) + (cmap.search_run || 0),
    exports: cmap.report_export || 0,
    builds: { runs: n0(builds.runs), ok: n0(builds.ok), failed: n0(builds.failed), avg_ms: Math.round(n0(builds.avg_ms)), rows_built: n0(builds.rows_built) },
    merge: {
      simulate_runs: n0(sim.runs), execute_runs: n0(exec.runs),
      sets_merged: n0(exec.sets), accounts_merged: n0(exec.accts), failed: n0(exec.failed), avg_ms: Math.round(n0(exec.avg_ms)),
      success_pct: pct(n0(exec.runs) - n0(exec.failed), n0(exec.runs)),
    },
    queue_removes: n0(removed),
    merge_funnel: [
      { stage: 'Queued', n: n0(queued) },
      { stage: 'Approved', n: n0(approved) },
      { stage: 'Simulated', n: n0(sim.runs) },
      { stage: 'Executed', n: n0(exec.runs) },
      { stage: 'Sets merged', n: n0(exec.sets) },
    ],
    restore_funnel: [
      { stage: 'Restore runs', n: restoreExec.filter(function (r) { return r.event_name === 'restore_run'; }).reduce(function (s, r) { return s + n0(r.runs); }, 0) },
      { stage: 'Sets restored', n: restored_sets },
      { stage: 'Recreate runs', n: restoreExec.filter(function (r) { return r.event_name === 'recreate_run'; }).reduce(function (s, r) { return s + n0(r.runs); }, 0) },
      { stage: 'Sets recreated', n: recreated_sets },
    ],
    by_panel: by_panel.map(function (r) { return { panel: r.panel, views: n0(r.views), filters: n0(r.filters), exports: n0(r.exports), events: n0(r.events) }; }),
    exports_by_view: exports_by_view.map(function (r) { return { view: r.view, format: r.fmt || '?', n: n0(r.n) }; }),
    top_filters: top_filters.map(function (r) { return { filter: r.f, n: n0(r.n) }; }),
    top_operators: top_ops.map(function (r) { return { actor: String(r.a || ''), merges: n0(r.merges), restores: n0(r.restores), queue_adds: n0(r.queue_adds), exports: n0(r.exports), builds: n0(r.builds), events: n0(r.events), last_seen: r.last_seen || null }; }),
    by_day: by_day.map(function (r) { var d = r.d, day = (d && d.toISOString) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return { day: day, views: n0(r.views), merges: n0(r.merges), restores: n0(r.restores), builds: n0(r.builds) }; }),
    by_hour: by_hour.map(function (r) { return { hour: n0(r.h), n: n0(r.n) }; }),
    by_dow: by_dow.map(function (r) { return { dow: n0(r.d), n: n0(r.n) }; }),
    by_env: by_env.map(function (r) { return { env: r.env, merges: n0(r.merges), restores: n0(r.restores), events: n0(r.events) }; }),
    errors: errors.map(function (r) { return { type: r.e || '?', n: n0(r.n) }; }),
    recent_active_users: recent_users.map(function (r) { return { actor: String(r.a || ''), events: n0(r.events), merges: n0(r.merges), last_seen: r.last_seen || null }; }),
    visitors: visitors.map(function (r) { return { id: String(r.v || ''), returning: n0(r.ret), actor: String(r.actor || ''), tz: r.tz || null, device: device(r.viewport), visits: n0(r.visits), events: n0(r.events), last_seen: r.last_seen || null }; }),
    health: { rows: n0(health.rows_total), test_rows: n0(health.test_rows), mb: (sizerow.mb != null ? Number(sizerow.mb) : null), latest_mtn: health.latest || null },
  };

  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const report = {
    title: 'Salesforce Merge tool — Metrics (last ' + days + ' days)',
    range: 'MTN reporting calendar · app=' + cfg.APP,
    sections: [
      { heading: 'Usage', lines: [
        data.panel_views + ' panel views · ' + data.unique_users + ' unique users · ' + data.actors + ' actors',
        data.filters_run + ' filters run · ' + data.exports + ' exports',
      ] },
      { heading: 'Merges', lines: [
        data.merge.execute_runs + ' merge runs · ' + data.merge.sets_merged + ' sets · ' + data.merge.accounts_merged + ' accounts · ' + data.merge.success_pct + '% ok',
        data.merge.simulate_runs + ' simulate (preview) runs',
      ] },
      { heading: 'Restores', lines: [
        restored_sets + ' sets restored · ' + recreated_sets + ' sets recreated',
      ] },
      { heading: 'Builds & where', lines: [
        data.builds.runs + ' data builds · ' + data.builds.rows_built + ' rows',
        'busiest panel: ' + (data.by_panel[0] ? data.by_panel[0].panel + ' (' + data.by_panel[0].events + ' events)' : 'n/a') +
          ' · busiest day: ' + (data.by_dow[0] ? dows[data.by_dow[0].dow] : 'n/a'),
      ] },
    ],
  };
  report.data = data;
  return report;
}

async function report_text(pool, opts) { return render.to_text(await build_report(pool, opts)); }
async function size(pool) { return retention.size(pool, T); }
async function cleanup(pool, opts) { return retention.purge_keep_years(pool, T, (opts && opts.years) || cfg.KEEP_YEARS, cfg.REPORTING_TZ); }
async function purge_all(pool) { return retention.purge_all(pool, T); }
async function purge_test(pool) { return retention.purge_test(pool, T, {}); }

module.exports = { build_report, report_text, size, cleanup, purge_all, purge_test, TABLE: T, cfg: cfg };

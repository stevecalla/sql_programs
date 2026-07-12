'use strict';
// Usage-analytics aggregation for the usat_apps platform. Returns the shared "report contract"
// (structured `data` + human `sections`) consumed by the React /metrics dashboard. Modeled on
// src/reporting/metrics/metrics_report.js.
//
// The usat_apps_events table uses a single `ts` DATETIME (server local time) — there is no separate
// created_at_utc/created_at_mtn pair — so this module groups on `ts` directly and does NOT use the
// generic retention.size() (which assumes created_at_*). purge_test / purge_all delegate to the
// generic retention core (those only touch is_test / no date column, so they're table-agnostic).
const retention = require('../../../utilities/analytics/retention');
const render = require('../../../utilities/analytics/report_render');

const TABLE = 'usat_apps_events';
const APP = 'usat_apps';
async function q(pool, sql, params) { const [rows] = await pool.query(sql, params || []); return rows; }
function n0(v) { return v == null ? 0 : Number(v); }
function fmt_dt(v) {
  if (!v) return null;
  try { const d = (v instanceof Date) ? v : new Date(v); if (isNaN(d)) return String(v); return d.toISOString().slice(0, 16).replace('T', ' '); }
  catch (e) { return String(v); }
}

// Aggregate the last `days` days into structured data + the report contract.
async function build_report(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 7;
  const since = 'created_at_mtn >= (NOW() - INTERVAL ' + days + ' DAY)';
  // Headline window EXCLUDES is_test=1 (?metrics_test=1) so flagged test activity never inflates the
  // dashboard. Test rows are still counted in `health` and are purgeable.
  const panel = opts.panel && String(opts.panel).trim();
  // Headline EXCLUDES is_test=1 (?metrics_test=1) by default so flagged test activity never inflates
  // the figures. include_test flips that on so you can review test rows before purging them.
  const test_filter = opts.include_test ? '' : ' AND (is_test IS NULL OR is_test = 0)';
  let W = '`' + TABLE + '` WHERE app = ? AND ' + since + test_filter;
  const A = [APP];
  if (panel) { W += ' AND panel = ?'; A.push(panel); }   // scope the whole report to one panel (tabs)

  // ---- headline event counts ----
  const counts = await q(pool, 'SELECT event_name, COUNT(*) n FROM ' + W + ' GROUP BY event_name', A);
  const cmap = {}; counts.forEach(function (r) { cmap[r.event_name] = n0(r.n); });
  const panel_views = (cmap.panel_view || 0) + (cmap.page_view || 0);

  const users = (await q(pool,
    'SELECT COUNT(DISTINCT visitor_id) uniq, ' +
    'COUNT(DISTINCT CASE WHEN is_returning=1 THEN visitor_id END) ret_u, ' +
    'COUNT(DISTINCT actor) actors ' +
    'FROM ' + W, A))[0] || {};

  const sessions_row = (await q(pool, 'SELECT COUNT(DISTINCT session_id) sessions FROM ' + W + " AND session_id IS NOT NULL AND session_id<>''", A))[0] || {};

  // ---- where in the app: panel views / filters / exports ----
  const by_panel = await q(pool,
    "SELECT panel, SUM(event_name IN ('panel_view','page_view')) views, SUM(event_name='filter_run') filters, " +
    "SUM(event_name='report_export') exports, COUNT(*) events " +
    'FROM ' + W + " AND panel IS NOT NULL AND panel<>'' GROUP BY panel ORDER BY events DESC", A);
  const exports_by_view = await q(pool,
    "SELECT view, export_format fmt, COUNT(*) n FROM " + W + " AND event_name='report_export' AND view IS NOT NULL GROUP BY view, export_format ORDER BY n DESC", A);
  const top_filters = await q(pool,
    "SELECT filter_name f, COUNT(*) n FROM " + W + " AND event_name IN ('filter_run','search_run') AND filter_name IS NOT NULL AND filter_name<>'' GROUP BY filter_name ORDER BY n DESC LIMIT 10", A);
  const by_view = await q(pool,
    "SELECT view, COUNT(*) n FROM " + W + " AND view IS NOT NULL AND view<>'' GROUP BY view ORDER BY n DESC LIMIT 20", A);

  // ---- per-user leaderboard ----
  const top_ops = await q(pool,
    "SELECT actor a, " +
    "SUM(event_name='report_export') exports, SUM(event_name IN ('filter_run','search_run')) filters, " +
    "COUNT(*) events, DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY events DESC LIMIT 10", A);

  // ---- time series ----
  const by_day = await q(pool,
    "SELECT DATE(created_at_mtn) d, SUM(event_name IN ('panel_view','page_view')) views, " +
    "SUM(event_name IN ('filter_run','search_run')) filters, SUM(event_name='report_export') exports " +
    'FROM ' + W + ' GROUP BY d ORDER BY d', A);

  const errors = await q(pool, "SELECT error_type e, COUNT(*) n FROM " + W + " AND event_name='error' AND error_type IS NOT NULL GROUP BY error_type ORDER BY n DESC", A);

  // ---- broken links (404) + access denials (403) ----
  const not_found = await q(pool, "SELECT view, COUNT(*) n FROM " + W + " AND event_name='not_found' AND view IS NOT NULL AND view<>'' GROUP BY view ORDER BY n DESC LIMIT 10", A);
  const access_denied = await q(pool, "SELECT panel, actor, COUNT(*) n FROM " + W + " AND event_name='not_authorized' GROUP BY panel, actor ORDER BY n DESC LIMIT 10", A);

  // ---- recent active users + anonymous visitors ----
  const recent_users = await q(pool,
    "SELECT actor a, COUNT(*) events, SUM(event_name='report_export') exports, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY MAX(created_at_mtn) DESC LIMIT 10", A);
  const visitors = await q(pool,
    "SELECT visitor_id v, MAX(is_returning) ret, " +
    "SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(actor,'') ORDER BY created_at_mtn DESC SEPARATOR 0x1f), 0x1f, 1) actor, " +
    "MAX(client_tz) tz, MAX(viewport) viewport, SUM(event_name IN ('panel_view','page_view')) visits, COUNT(*) events, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND visitor_id IS NOT NULL GROUP BY visitor_id ORDER BY events DESC LIMIT 15", A);
  const device = function (vp) { return vp === 'sm' ? 'mobile' : vp === 'md' ? 'tablet' : vp === 'lg' ? 'desktop' : (vp || '—'); };

  // ---- health (whole table) ----
  const health = (await q(pool,
    "SELECT COUNT(*) rows_total, SUM(CASE WHEN is_test=1 THEN 1 ELSE 0 END) test_rows, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%b %e, %Y %l:%i %p') latest FROM `" + TABLE + "`"))[0] || {};
  const sizerow = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [TABLE]))[0] || {};

  const data = {
    days: days,
    panel_views: panel_views,
    unique_users: n0(users.uniq), repeat_users: n0(users.ret_u), actors: n0(users.actors),
    sessions: n0(sessions_row.sessions),
    filters_run: (cmap.filter_run || 0) + (cmap.search_run || 0),
    exports: cmap.report_export || 0,
    by_panel: by_panel.map(function (r) { return { panel: r.panel, views: n0(r.views), filters: n0(r.filters), exports: n0(r.exports), events: n0(r.events) }; }),
    exports_by_view: exports_by_view.map(function (r) { return { view: r.view, format: r.fmt || '?', n: n0(r.n) }; }),
    top_filters: top_filters.map(function (r) { return { filter: r.f, n: n0(r.n) }; }),
    by_view: by_view.map(function (r) { return { view: r.view, n: n0(r.n) }; }),
    top_operators: top_ops.map(function (r) { return { actor: String(r.a || ''), exports: n0(r.exports), filters: n0(r.filters), events: n0(r.events), last_seen: r.last_seen || null }; }),
    by_day: by_day.map(function (r) { var d = r.d, day = (d && d.toISOString) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10); return { day: day, views: n0(r.views), filters: n0(r.filters), exports: n0(r.exports) }; }),
    errors: errors.map(function (r) { return { type: r.e || '?', n: n0(r.n) }; }),
    not_found: cmap.not_found || 0,
    not_authorized: cmap.not_authorized || 0,
    top_not_found: not_found.map(function (r) { return { path: r.view, n: n0(r.n) }; }),
    access_denied: access_denied.map(function (r) { return { panel: r.panel || '\u2014', actor: String(r.actor || 'anon'), n: n0(r.n) }; }),
    recent_active_users: recent_users.map(function (r) { return { actor: String(r.a || ''), events: n0(r.events), exports: n0(r.exports), last_seen: r.last_seen || null }; }),
    visitors: visitors.map(function (r) { return { id: String(r.v || ''), returning: n0(r.ret), actor: String(r.actor || ''), tz: r.tz || null, device: device(r.viewport), visits: n0(r.visits), events: n0(r.events), last_seen: r.last_seen || null }; }),
    health: { rows: n0(health.rows_total), test_rows: n0(health.test_rows), mb: (sizerow.mb != null ? Number(sizerow.mb) : null), latest_mtn: health.latest || null },
  };

  const report = {
    title: 'USAT Apps — Metrics (last ' + days + ' days)',
    range: 'app=' + APP + (panel ? ' panel=' + panel : ''),
    sections: [
      { heading: 'Usage', lines: [
        data.panel_views + ' panel views · ' + data.sessions + ' sessions · ' + data.unique_users + ' unique users · ' + data.actors + ' actors',
        data.filters_run + ' filters run · ' + data.exports + ' exports',
      ] },
      { heading: 'Where', lines: [
        'busiest panel: ' + (data.by_panel[0] ? data.by_panel[0].panel + ' (' + data.by_panel[0].events + ' events)' : 'n/a'),
      ] },
      { heading: 'Issues', lines: [
        data.not_found + ' not-found (404) \u00b7 ' + data.not_authorized + ' access-denied (403)',
      ] },
      { heading: 'Health', lines: [
        data.health.rows + ' rows · ' + data.health.test_rows + ' test rows' + (data.health.mb != null ? ' · ' + data.health.mb + ' MB' : ''),
      ] },
    ],
  };
  report.data = data;
  return report;
}

async function report_text(pool, opts) { return render.to_text(await build_report(pool, opts)); }
// Table size — computed directly (retention.size() assumes created_at_*, which this table lacks).
async function size(pool) {
  const info = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [TABLE]))[0] || {};
  const range = (await q(pool, 'SELECT COUNT(*) rows_total, MIN(created_at_mtn) min_ts, MAX(created_at_mtn) max_ts FROM `' + TABLE + '`'))[0] || {};
  return { mb: info.mb != null ? info.mb : 0, rows: n0(range.rows_total), min_ts: fmt_dt(range.min_ts), max_ts: fmt_dt(range.max_ts) };
}
async function purge_all(pool) { return retention.purge_all(pool, TABLE); }
async function purge_test(pool) { return retention.purge_test(pool, TABLE, {}); }

module.exports = { build_report, report_text, size, purge_all, purge_test, TABLE: TABLE, APP: APP };

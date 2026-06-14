'use strict';
// App-specific analytics aggregation for race_results_transform. Returns the
// shared "report contract" consumed by the CLI, the Slack digest, and the
// dashboard (single source of truth). Uses the same mysql2/promise +
// local_usat_sales_db_config() pattern as the rest of the repo.
const path = require('path');
// Load the repo-root .env by absolute path BEFORE requiring config (which reads
// process.env). The CLI runs from the project subfolder, so a CWD-relative dotenv
// would miss it (-> empty DB user). Same approach as the server + purge cron.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');
const retention = require('../../../utilities/analytics/retention');
const render = require('../../../utilities/analytics/report_render');
const cfg = require('./metrics_config');

const T = cfg.TABLE;

async function get_pool() {
  const conf = await local_usat_sales_db_config();
  return mysql.createPool(conf);
}

async function q(pool, sql, params) {
  const [rows] = await pool.query(sql, params || []);
  return rows;
}
function n0(v) { return v == null ? 0 : Number(v); }
function pct(v) { return v == null ? 0 : Math.round(Number(v) * 10) / 10; }

// Aggregate the last `days` days into structured data + the report contract.
async function build_report(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 7;
  const since = "created_at_utc >= UTC_TIMESTAMP() - INTERVAL " + days + " DAY";
  const W = '`' + T + '` WHERE app = ? AND ' + since;
  const A = [cfg.APP];

  const counts = await q(pool, 'SELECT event_name, COUNT(*) n FROM ' + W + ' GROUP BY event_name', A);
  const cmap = {}; counts.forEach(function (r) { cmap[r.event_name] = n0(r.n); });

  const users = (await q(pool,
    'SELECT COUNT(DISTINCT visitor_id) uniq, ' +
    "COUNT(DISTINCT CASE WHEN is_returning=0 THEN visitor_id END) new_u, " +
    "COUNT(DISTINCT CASE WHEN is_returning=1 THEN visitor_id END) ret_u " +
    'FROM ' + W + " AND event_name='page_view'", A))[0] || {};

  const comp = (await q(pool,
    "SELECT COUNT(DISTINCT CASE WHEN event_name='file_uploaded' THEN upload_id END) up, " +
    "COUNT(DISTINCT CASE WHEN event_name IN('download','split_download_used') THEN upload_id END) dl " +
    'FROM ' + W + ' AND upload_id IS NOT NULL', A))[0] || {};

  const modes = await q(pool, "SELECT download_mode m, COUNT(*) n FROM " + W +
    " AND event_name IN('download','split_download_used') GROUP BY download_mode", A);

  const conv = (await q(pool,
    'SELECT COUNT(*) n, AVG(row_count) avg_rows, AVG(col_count) avg_cols, AVG(flag_count) avg_flags, ' +
    'AVG(CASE WHEN (cols_matched+cols_unmatched)>0 THEN cols_matched/(cols_matched+cols_unmatched) END) automap ' +
    'FROM ' + W + " AND event_name='conversion_completed'", A))[0] || {};

  const ftypes = await q(pool, "SELECT file_type t, COUNT(*) n FROM " + W +
    " AND event_name='file_uploaded' GROUP BY file_type", A);
  const top_files = await q(pool, "SELECT file_name f, COUNT(*) n FROM " + W +
    " AND event_name='file_uploaded' AND file_name IS NOT NULL GROUP BY file_name ORDER BY n DESC LIMIT 5", A);
  const fixed = await q(pool, "SELECT target_key k, COUNT(*) n FROM " + W +
    " AND event_name='manual_remap' AND target_key IS NOT NULL GROUP BY target_key ORDER BY n DESC LIMIT 5", A);
  const errors = await q(pool, "SELECT error_type e, COUNT(*) n FROM " + W +
    " AND event_name='error' GROUP BY error_type", A);
  // Hour-of-day in MOUNTAIN time (consistent with by_day / last-activity), not each visitor's
  // browser-local hour. created_at_mtn is a DATETIME holding MTN wall-clock; fall back to UTC only
  // for any legacy rows missing it.
  const by_hour = await q(pool, "SELECT HOUR(COALESCE(created_at_mtn, created_at_utc)) h, COUNT(*) n FROM " + W +
    " AND event_name='file_uploaded' GROUP BY h ORDER BY h", A);
  const by_dow = await q(pool, "SELECT local_dow d, COUNT(*) n FROM " + W +
    " AND event_name='file_uploaded' GROUP BY local_dow ORDER BY n DESC", A);
  const by_day = await q(pool, "SELECT DATE(COALESCE(created_at_mtn, created_at_utc)) d, " +
    "SUM(event_name='page_view') visits, SUM(event_name='file_uploaded') uploads, " +
    "SUM(event_name IN ('download','split_download_used')) downloads, SUM(event_name='start_over') start_overs " +
    "FROM " + W + " GROUP BY d ORDER BY d", A);
  const top_users = await q(pool, "SELECT visitor_id v, MAX(is_returning) ret, " +
    "SUM(event_name='page_view') visits, SUM(event_name='file_uploaded') uploads, SUM(event_name IN ('download','split_download_used')) downloads, SUM(event_name='start_over') start_overs, COUNT(*) events, " +
    // Format last_seen in SQL so it stays true MTN. created_at_mtn is a DATETIME holding MTN
    // wall-clock; returning the raw Date and calling toISOString() in JS shifts it to UTC.
    "DATE_FORMAT(MAX(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END), '%Y-%m-%d %l:%i %p') last_seen, MAX(client_tz) tz " +
    "FROM " + W + " AND visitor_id IS NOT NULL GROUP BY visitor_id ORDER BY uploads DESC, events DESC LIMIT 8", A);
  const splits = (await q(pool,
    "SELECT COUNT(*) n, AVG(selected_count) avg_groups, " +
    "SUM(split_basis='converted') converted, SUM(split_basis='original') original " +
    "FROM " + W + " AND event_name='split_download_used'", A))[0] || {};

  // Try Me vs real activity: split the key events by is_demo (1 = built-in sample / fake data,
  // else real user activity). Drives the "Try Me vs real" dashboard chart + KPI card.
  const demo = (await q(pool,
    "SELECT " +
    "SUM(event_name='file_uploaded' AND is_demo=1) up_demo, " +
    "SUM(event_name='file_uploaded' AND (is_demo IS NULL OR is_demo=0)) up_real, " +
    "SUM(event_name='conversion_completed' AND is_demo=1) cv_demo, " +
    "SUM(event_name='conversion_completed' AND (is_demo IS NULL OR is_demo=0)) cv_real, " +
    "SUM(event_name IN ('download','split_download_used') AND is_demo=1) dl_demo, " +
    "SUM(event_name IN ('download','split_download_used') AND (is_demo IS NULL OR is_demo=0)) dl_real " +
    "FROM " + W, A))[0] || {};

  // Intake-by-tab: split uploads/conversions/downloads by `source` (which intake the file came from —
  // upload | try_me | sf_upload_queue | sf_email_queue | folder | slack). Only file-bearing events carry
  // a source, so page_view/dashboard_view (source NULL) are excluded.
  const by_source = await q(pool,
    "SELECT source src, " +
    "SUM(event_name='file_uploaded') uploads, " +
    "SUM(event_name='conversion_completed') conversions, " +
    "SUM(event_name IN ('download','split_download_used')) downloads " +
    "FROM " + W + " AND source IS NOT NULL AND source <> '' GROUP BY source ORDER BY uploads DESC, downloads DESC", A);

  // Last User Activity = most recent REAL activity; exclude server-side dashboard_view
  // events (each /metrics open fires one) so merely viewing the dashboard never bumps the
  // date. rows_total stays unfiltered — it's a DB-size health figure, not an activity figure.
  const health = (await q(pool, "SELECT COUNT(*) rows_total, SUM(CASE WHEN is_test = 1 THEN 1 ELSE 0 END) test_rows, DATE_FORMAT(MAX(CASE WHEN event_name <> 'dashboard_view' THEN created_at_mtn END), '%b %e, %Y %l:%i %p') latest FROM `" + T + "`"))[0] || {};
  const sizerow = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [T]))[0] || {};

  const uploads = cmap.file_uploaded || 0;
  const downloads = (cmap.download || 0) + (cmap.split_download_used || 0);
  const data = {
    days: days, visits: cmap.page_view || 0,
    unique_users: n0(users.uniq), new_users: n0(users.new_u), repeat_users: n0(users.ret_u),
    uploads: uploads, conversions: cmap.conversion_completed || 0, downloads: downloads, start_overs: cmap.start_over || 0,
    completion_uploads: n0(comp.up), completion_downloaded: n0(comp.dl),
    download_modes: modes.map(function (r) { return { mode: r.m || 'single', n: n0(r.n) }; }),
    avg_rows: Math.round(n0(conv.avg_rows)), avg_cols: Math.round(n0(conv.avg_cols)),
    avg_flags: Math.round(n0(conv.avg_flags) * 10) / 10, automap_pct: pct(n0(conv.automap) * 100),
    file_types: ftypes.map(function (r) { return { type: r.t || '?', n: n0(r.n) }; }),
    top_files: top_files.map(function (r) { return { name: r.f, n: n0(r.n) }; }),
    fixed_columns: fixed.map(function (r) { return { key: r.k, n: n0(r.n) }; }),
    errors: errors.map(function (r) { return { type: r.e || '?', n: n0(r.n) }; }),
    by_hour: by_hour.map(function (r) { return { hour: n0(r.h), n: n0(r.n) }; }),
    by_dow: by_dow.map(function (r) { return { dow: n0(r.d), n: n0(r.n) }; }),
    by_day: by_day.map(function (r) {
      var d = r.d, day = (d && d.toISOString) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      return { day: day, visits: n0(r.visits), uploads: n0(r.uploads), downloads: n0(r.downloads), start_overs: n0(r.start_overs) };
    }),
    top_users: top_users.map(function (r) {
      var last = r.last_seen || null; // already 'YYYY-MM-DD h:mm AM/PM' in MTN (formatted in SQL)
      return { id: String(r.v || ''), returning: n0(r.ret), visits: n0(r.visits), uploads: n0(r.uploads), downloads: n0(r.downloads), start_overs: n0(r.start_overs), events: n0(r.events), last_seen: last, tz: r.tz || null };
    }),
    funnel: [
      { stage: 'Visits', n: cmap.page_view || 0 },
      { stage: 'Uploads', n: uploads },
      { stage: 'Conversions', n: cmap.conversion_completed || 0 },
      { stage: 'Downloads', n: downloads },
      { stage: 'Start over', n: cmap.start_over || 0 }
    ],
    splits: { count: n0(splits.n), avg_groups: Math.round(n0(splits.avg_groups) * 10) / 10, converted: n0(splits.converted), original: n0(splits.original) },
    demo_split: [
      { event: 'Uploads', demo: n0(demo.up_demo), real: n0(demo.up_real) },
      { event: 'Conversions', demo: n0(demo.cv_demo), real: n0(demo.cv_real) },
      { event: 'Downloads', demo: n0(demo.dl_demo), real: n0(demo.dl_real) }
    ],
    demo: { uploads: n0(demo.up_demo), conversions: n0(demo.cv_demo), downloads: n0(demo.dl_demo) },
    by_source: by_source.map(function (r) { return { source: r.src, uploads: n0(r.uploads), conversions: n0(r.conversions), downloads: n0(r.downloads) }; }),
    health: {
      rows: n0(health.rows_total),
      test_rows: n0(health.test_rows),   // is_test=1 rows (deliberate test runs) — purgeable from the dashboard
      mb: (sizerow.mb != null ? Number(sizerow.mb) : null),
      latest_mtn: health.latest || null   // already 'Mon D, YYYY h:mm AM/PM' in MTN (formatted in SQL)
    }
  };

  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const comp_rate = data.completion_uploads ? Math.round(100 * data.completion_downloaded / data.completion_uploads) : 0;
  const mode_str = data.download_modes.length
    ? data.download_modes.map(function (m) { return m.n + ' ' + m.mode; }).join(', ') : 'none';
  const ftype_str = data.file_types.map(function (f) { return f.type + ' ' + f.n; }).join(', ') || 'none';

  const report = {
    title: 'Race Results Converter — Metrics (last ' + days + ' days)',
    range: 'MTN reporting calendar · app=' + cfg.APP,
    sections: [
      { heading: 'Usage', lines: [
        data.visits + ' visits · ' + data.unique_users + ' unique users (' + data.new_users + ' new, ' + data.repeat_users + ' returning)',
        data.uploads + ' uploaded · ' + data.conversions + ' converted · ' + data.downloads + ' downloads',
        'Completion: ' + data.completion_downloaded + '/' + data.completion_uploads + ' uploads → download (' + comp_rate + '%)'
      ] },
      { heading: 'Downloads', lines: [
        (data.downloads || 0) + ' total: ' + mode_str,
        'split-by-group: ' + data.splits.count + (data.splits.count ? ' (avg ' + data.splits.avg_groups + ' groups · ' + data.splits.converted + ' converted / ' + data.splits.original + ' original)' : '')
      ] },
      { heading: 'Files & data', lines: [
        'avg ' + data.avg_rows + ' rows / ' + data.avg_cols + ' cols · ' + ftype_str,
        'top files: ' + (data.top_files.map(function (f) { return f.name + ' (' + f.n + ')'; }).join(', ') || 'none')
      ] },
      { heading: 'Mapping quality', lines: [
        'auto-map accuracy: ' + data.automap_pct + '% of columns matched without a manual fix',
        'most-fixed columns: ' + (data.fixed_columns.map(function (c) { return c.key + ' (' + c.n + ')'; }).join(', ') || 'none'),
        'avg flagged values per file: ' + data.avg_flags
      ] },
      { heading: 'When (user-local) & errors', lines: [
        'busiest day: ' + (data.by_dow[0] ? dows[data.by_dow[0].dow] : 'n/a') +
          ' · busiest hour: ' + (data.by_hour.length ? data.by_hour.slice().sort(function (a, b) { return b.n - a.n; })[0].hour + ':00' : 'n/a'),
        'errors: ' + (data.errors.map(function (e) { return e.type + ' ' + e.n; }).join(', ') || 'none')
      ] }
    ]
  };
  report.data = data;
  return report;
}

async function report_text(pool, opts) { return render.to_text(await build_report(pool, opts)); }
async function report_blocks(pool, opts) { return render.to_slack_blocks(await build_report(pool, opts)); }
async function size(pool) { return retention.size(pool, T); }
async function cleanup(pool, opts) { return retention.purge_keep_years(pool, T, (opts && opts.years) || cfg.KEEP_YEARS, cfg.REPORTING_TZ); }
async function purge_all(pool) { return retention.purge_all(pool, T); }
async function purge_test(pool) { return retention.purge_test(pool, T); }

// Count rows with a given source value (used by the backfill dry-run).
async function count_source(pool, value) {
  const rows = await q(pool, 'SELECT COUNT(*) AS n FROM `' + T + '` WHERE source = ?', [value]);
  return (rows[0] && rows[0].n) || 0;
}

// One-time, idempotent source rename. The SF Email Queue is new, so every prior source='salesforce'
// row was the upload queue → relabel them 'sf_upload_queue'. Re-running changes 0 rows.
async function backfill_source(pool, from_value, to_value) {
  const [result] = await pool.query('UPDATE `' + T + '` SET source = ? WHERE source = ?', [to_value, from_value]);
  return { updated: (result && result.affectedRows) || 0 };
}

module.exports = { get_pool, build_report, report_text, report_blocks, size, cleanup, purge_all, purge_test, count_source, backfill_source, TABLE: T, cfg: cfg }
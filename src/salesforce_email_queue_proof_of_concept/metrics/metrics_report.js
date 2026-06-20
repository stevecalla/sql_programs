'use strict';
// App-specific analytics aggregation for the Salesforce Email Queue Assistant POC. Returns the
// shared "report contract" consumed by the CLI (stats) and the /metrics dashboard (single source of
// truth). Mirrors src/race_results_transform/metrics/metrics_report.js: same mysql2/promise +
// local_usat_sales_db_config() pattern + utilities/analytics retention/render reuse.
const path = require('path');
// Load the repo-root .env by absolute path BEFORE requiring config (which reads process.env).
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
async function q(pool, sql, params) { const [rows] = await pool.query(sql, params || []); return rows; }
function n0(v) { return v == null ? 0 : Number(v); }
function pct(num, den) { return den ? Math.round(1000 * num / den) / 10 : 0; }

// Aggregate the last `days` days into structured data + the report contract.
async function build_report(pool, opts) {
  opts = opts || {};
  const days = Number(opts.days) || 7;
  const since = 'created_at_utc >= UTC_TIMESTAMP() - INTERVAL ' + days + ' DAY';
  // Real-stats window EXCLUDES is_test=1 rows (deliberate test runs + admin views of /metrics & /admin),
  // so test activity never inflates the dashboard. Test rows are still counted in `health` and purgeable.
  const W = '`' + T + '` WHERE app = ? AND ' + since + ' AND (is_test IS NULL OR is_test = 0)';
  const A = [cfg.APP];

  const counts = await q(pool, 'SELECT event_name, COUNT(*) n FROM ' + W + ' GROUP BY event_name', A);
  const cmap = {}; counts.forEach(function (r) { cmap[r.event_name] = n0(r.n); });

  const users = (await q(pool,
    'SELECT COUNT(DISTINCT visitor_id) uniq, ' +
    "COUNT(DISTINCT CASE WHEN is_returning=1 THEN visitor_id END) ret_u, " +
    "COUNT(DISTINCT CASE WHEN (is_returning IS NULL OR is_returning=0) THEN visitor_id END) new_u, " +
    "COUNT(DISTINCT actor) operators " +
    'FROM ' + W + " AND event_name='page_view'", A))[0] || {};

  // ---- AI flow (the heart of this dashboard) ----
  const AIW = W + " AND event_name='ai_call'";
  const ai = (await q(pool,
    'SELECT COUNT(*) calls, ' +
    'SUM(ai_ok=1) ok, SUM(ai_ok=0) failed, ' +
    'AVG(ai_latency_ms) avg_ms, MAX(ai_latency_ms) max_ms, ' +
    'SUM(ai_used_images=1) with_images, SUM(ai_grounded=1) grounded, ' +
    'AVG(ai_reply_chars) avg_reply, SUM(ai_correction_count) corrections_used ' +
    'FROM ' + AIW, A))[0] || {};
  const by_action = await q(pool, 'SELECT ai_action a, COUNT(*) n FROM ' + AIW + ' GROUP BY ai_action ORDER BY n DESC', A);
  const by_provider = await q(pool, 'SELECT ai_provider p, COUNT(*) n, AVG(ai_latency_ms) avg_ms FROM ' + AIW + ' GROUP BY ai_provider ORDER BY n DESC', A);
  const by_verdict = await q(pool, "SELECT ai_verdict v, COUNT(*) n FROM " + AIW + " AND ai_verdict IS NOT NULL AND ai_verdict<>'' GROUP BY ai_verdict ORDER BY n DESC", A);
  const by_model = await q(pool, "SELECT ai_model m, COUNT(*) n FROM " + AIW + " AND ai_model IS NOT NULL AND ai_model<>'' GROUP BY ai_model ORDER BY n DESC LIMIT 8", A);
  const ai_errors = await q(pool, "SELECT ai_error e, COUNT(*) n FROM " + AIW + " AND ai_ok=0 AND ai_error IS NOT NULL AND ai_error<>'' GROUP BY ai_error ORDER BY n DESC", A);

  // ---- by queue / operator / time ----
  const by_queue = await q(pool,
    "SELECT queue qn, COUNT(*) events, SUM(event_name='ai_call') ai_calls, SUM(event_name='thread_opened') threads " +
    'FROM ' + W + " AND queue IS NOT NULL AND queue<>'' GROUP BY queue ORDER BY ai_calls DESC, events DESC LIMIT 12", A);
  const top_ops = await q(pool,
    "SELECT actor a, SUM(event_name='ai_call') ai_calls, SUM(event_name='thread_opened') threads, COUNT(*) events, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY ai_calls DESC, events DESC LIMIT 8", A);
  const recent_ops = await q(pool,
    "SELECT actor a, COUNT(*) events, SUM(event_name='ai_call') ai_calls, MAX(event_name) last_event, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND actor IS NOT NULL AND actor<>'' GROUP BY actor ORDER BY MAX(created_at_mtn) DESC LIMIT 10", A);
  // Per-visitor activity (browser-level), with location proxy (client timezone) + new/returning —
  // mirrors the transform dashboard's user table. visitor_id is anonymous; AI calls are server-logged
  // (no visitor_id), so this reflects browsing activity (visits/threads/events).
  const visitors = await q(pool,
    "SELECT visitor_id v, MAX(is_returning) ret, MAX(actor) actor, MAX(client_tz) tz, MAX(viewport) viewport, " +
    "SUM(event_name='page_view') visits, SUM(event_name='thread_opened') threads, " +
    "SUM(event_name='queue_viewed') queues, COUNT(*) events, " +
    "DATE_FORMAT(MAX(CASE WHEN event_name<>'dashboard_view' THEN created_at_mtn END), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND visitor_id IS NOT NULL GROUP BY visitor_id ORDER BY events DESC LIMIT 15", A);
  const by_day = await q(pool,
    "SELECT DATE(COALESCE(created_at_mtn, created_at_utc)) d, " +
    "SUM(event_name='page_view') visits, SUM(event_name='thread_opened') threads, " +
    "SUM(event_name='ai_call') ai_calls, SUM(event_name='acknowledge_sent') acks " +
    'FROM ' + W + ' GROUP BY d ORDER BY d', A);
  const by_hour = await q(pool, "SELECT HOUR(COALESCE(created_at_mtn, created_at_utc)) h, COUNT(*) n FROM " + AIW + ' GROUP BY h ORDER BY h', A);
  const by_dow = await q(pool, "SELECT local_dow d, COUNT(*) n FROM " + W + " AND event_name='ai_call' GROUP BY local_dow ORDER BY n DESC", A);

  // ---- other interactions ----
  const attach = await q(pool, "SELECT attachment_type t, COUNT(*) n FROM " + W + " AND event_name='attachment_viewed' AND attachment_type IS NOT NULL GROUP BY attachment_type ORDER BY n DESC", A);
  const corr = await q(pool, "SELECT correction_scope s, COUNT(*) n FROM " + W + " AND event_name='correction_added' AND correction_scope IS NOT NULL GROUP BY correction_scope ORDER BY n DESC", A);
  const errors = await q(pool, "SELECT error_type e, COUNT(*) n FROM " + W + " AND event_name='error' GROUP BY error_type", A);

  // ---- health (whole table, unfiltered — DB-size + test-row figure) ----
  const health = (await q(pool, "SELECT COUNT(*) rows_total, SUM(CASE WHEN is_test=1 THEN 1 ELSE 0 END) test_rows, DATE_FORMAT(MAX(CASE WHEN event_name<>'dashboard_view' THEN created_at_mtn END), '%b %e, %Y %l:%i %p') latest FROM `" + T + "`"))[0] || {};
  const sizerow = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [T]))[0] || {};

  const calls = n0(ai.calls);
  const data = {
    days: days,
    visits: cmap.page_view || 0,
    unique_users: n0(users.uniq), new_users: n0(users.new_u), repeat_users: n0(users.ret_u), operators: n0(users.operators),
    threads_opened: cmap.thread_opened || 0,
    acknowledgements: cmap.acknowledge_sent || 0,
    ai: {
      calls: calls, ok: n0(ai.ok), failed: n0(ai.failed),
      success_pct: pct(n0(ai.ok), calls),
      avg_ms: Math.round(n0(ai.avg_ms)), max_ms: Math.round(n0(ai.max_ms)),
      with_images: n0(ai.with_images), grounded: n0(ai.grounded), grounded_pct: pct(n0(ai.grounded), calls),
      avg_reply_chars: Math.round(n0(ai.avg_reply)), corrections_used: n0(ai.corrections_used)
    },
    by_action: by_action.map(function (r) { return { action: r.a || '?', n: n0(r.n) }; }),
    by_provider: by_provider.map(function (r) { return { provider: r.p || '?', n: n0(r.n), avg_ms: Math.round(n0(r.avg_ms)) }; }),
    by_verdict: by_verdict.map(function (r) { return { verdict: r.v, n: n0(r.n) }; }),
    by_model: by_model.map(function (r) { return { model: r.m, n: n0(r.n) }; }),
    ai_errors: ai_errors.map(function (r) { return { error: r.e, n: n0(r.n) }; }),
    by_queue: by_queue.map(function (r) { return { queue: r.qn, events: n0(r.events), ai_calls: n0(r.ai_calls), threads: n0(r.threads) }; }),
    top_operators: top_ops.map(function (r) { return { actor: String(r.a || ''), ai_calls: n0(r.ai_calls), threads: n0(r.threads), events: n0(r.events), last_seen: r.last_seen || null }; }),
    recent_operators: recent_ops.map(function (r) { return { actor: String(r.a || ''), events: n0(r.events), ai_calls: n0(r.ai_calls), last_seen: r.last_seen || null }; }),
    visitors: visitors.map(function (r) { return { id: String(r.v || ''), returning: n0(r.ret), actor: String(r.actor || ''), tz: r.tz || null, viewport: r.viewport || null, visits: n0(r.visits), threads: n0(r.threads), queues: n0(r.queues), events: n0(r.events), last_seen: r.last_seen || null }; }),
    by_day: by_day.map(function (r) {
      var d = r.d, day = (d && d.toISOString) ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
      return { day: day, visits: n0(r.visits), threads: n0(r.threads), ai_calls: n0(r.ai_calls), acks: n0(r.acks) };
    }),
    by_hour: by_hour.map(function (r) { return { hour: n0(r.h), n: n0(r.n) }; }),
    by_dow: by_dow.map(function (r) { return { dow: n0(r.d), n: n0(r.n) }; }),
    attachments: attach.map(function (r) { return { type: r.t || '?', n: n0(r.n) }; }),
    corrections: corr.map(function (r) { return { scope: r.s || '?', n: n0(r.n) }; }),
    errors: errors.map(function (r) { return { type: r.e || '?', n: n0(r.n) }; }),
    funnel: [
      { stage: 'Visits', n: cmap.page_view || 0 },
      { stage: 'Threads opened', n: cmap.thread_opened || 0 },
      { stage: 'AI calls', n: calls },
      { stage: 'Drafts produced', n: n0(ai.ok) },
      { stage: 'Acknowledgements', n: cmap.acknowledge_sent || 0 }
    ],
    health: {
      rows: n0(health.rows_total),
      test_rows: n0(health.test_rows),   // is_test=1 rows (deliberate test runs) — purgeable from /admin
      mb: (sizerow.mb != null ? Number(sizerow.mb) : null),
      latest_mtn: health.latest || null
    }
  };

  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const prov_str = data.by_provider.map(function (p) { return p.provider + ' ' + p.n; }).join(', ') || 'none';
  const verdict_str = data.by_verdict.map(function (v) { return v.verdict + ' ' + v.n; }).join(', ') || 'none';
  const report = {
    title: 'Salesforce Email Queue Assistant — Metrics (last ' + days + ' days)',
    range: 'MTN reporting calendar · app=' + cfg.APP,
    sections: [
      { heading: 'Usage', lines: [
        data.visits + ' visits · ' + data.unique_users + ' unique users · ' + data.operators + ' operators',
        data.threads_opened + ' threads opened · ' + data.acknowledgements + ' acknowledgements sent'
      ] },
      { heading: 'AI flow', lines: [
        data.ai.calls + ' AI calls · ' + data.ai.success_pct + '% succeeded · avg ' + data.ai.avg_ms + ' ms',
        'providers: ' + prov_str,
        'verdicts: ' + verdict_str,
        'grounded with context: ' + data.ai.grounded_pct + '% · ' + data.ai.with_images + ' used images · ' + data.ai.corrections_used + ' corrections applied'
      ] },
      { heading: 'Where', lines: [
        'busiest queue: ' + (data.by_queue[0] ? data.by_queue[0].queue + ' (' + data.by_queue[0].ai_calls + ' AI calls)' : 'n/a'),
        'busiest day: ' + (data.by_dow[0] ? dows[data.by_dow[0].dow] : 'n/a') +
          ' · busiest hour: ' + (data.by_hour.length ? data.by_hour.slice().sort(function (a, b) { return b.n - a.n; })[0].hour + ':00' : 'n/a')
      ] },
      { heading: 'Quality & errors', lines: [
        'attachments viewed: ' + (data.attachments.map(function (a) { return a.type + ' ' + a.n; }).join(', ') || 'none'),
        'AI errors: ' + (data.ai_errors.map(function (e) { return e.error + ' ' + e.n; }).join(', ') || 'none'),
        'app errors: ' + (data.errors.map(function (e) { return e.type + ' ' + e.n; }).join(', ') || 'none')
      ] }
    ]
  };
  report.data = data;
  return report;
}

async function report_text(pool, opts) { return render.to_text(await build_report(pool, opts)); }
async function size(pool) { return retention.size(pool, T); }
async function cleanup(pool, opts) { return retention.purge_keep_years(pool, T, (opts && opts.years) || cfg.KEEP_YEARS, cfg.REPORTING_TZ); }
async function purge_all(pool) { return retention.purge_all(pool, T); }
async function purge_test(pool) { return retention.purge_test(pool, T); }

module.exports = { get_pool, build_report, report_text, size, cleanup, purge_all, purge_test, TABLE: T, cfg: cfg };

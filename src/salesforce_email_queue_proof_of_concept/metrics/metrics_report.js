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
function usd6(v) { return Math.round((Number(v) || 0) * 1e6) / 1e6; }   // USD cost, 6dp

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
    'AVG(ai_reply_chars) avg_reply, SUM(ai_correction_count) corrections_used, ' +
    'SUM(ai_prompt_tokens) ptok, SUM(ai_completion_tokens) ctok, SUM(ai_cost_usd) cost ' +
    'FROM ' + AIW, A))[0] || {};
  const by_action = await q(pool, 'SELECT ai_action a, COUNT(*) n FROM ' + AIW + ' GROUP BY ai_action ORDER BY n DESC', A);
  const by_provider = await q(pool, 'SELECT ai_provider p, COUNT(*) n, AVG(ai_latency_ms) avg_ms FROM ' + AIW + ' GROUP BY ai_provider ORDER BY n DESC', A);
  const by_verdict = await q(pool, "SELECT ai_verdict v, COUNT(*) n FROM " + AIW + " AND ai_verdict IS NOT NULL AND ai_verdict<>'' GROUP BY ai_verdict ORDER BY n DESC", A);
  const by_model = await q(pool, "SELECT ai_model m, COUNT(*) n, SUM(ai_prompt_tokens) ptok, SUM(ai_completion_tokens) ctok, SUM(ai_cost_usd) cost FROM " + AIW + " AND ai_model IS NOT NULL AND ai_model<>'' GROUP BY ai_model ORDER BY cost DESC, n DESC LIMIT 8", A);
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
  // Per-visitor activity (browser-level), with location proxy (client timezone) + new/returning.
  // visitor_id is anonymous and per-BROWSER, not per-login: one browser shared by several staff logins
  // collapses to a single row, so we show the MOST-RECENT actor plus actor_n = how many distinct logins
  // were seen on that browser. (Server-logged AI calls now also carry visitor_id via the request meta.)
  const visitors = await q(pool,
    "SELECT visitor_id v, MAX(is_returning) ret, " +
    "SUBSTRING_INDEX(GROUP_CONCAT(NULLIF(actor,'') ORDER BY created_at_mtn DESC SEPARATOR 0x1f), 0x1f, 1) actor, " +
    "COUNT(DISTINCT NULLIF(actor,'')) actor_n, MAX(client_tz) tz, MAX(viewport) viewport, " +
    "SUM(event_name='page_view') visits, SUM(event_name='thread_opened') threads, " +
    "SUM(event_name='queue_viewed') queues, COUNT(*) events, " +
    "DATE_FORMAT(MAX(CASE WHEN event_name<>'dashboard_view' THEN created_at_mtn END), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND visitor_id IS NOT NULL GROUP BY visitor_id ORDER BY events DESC LIMIT 15", A);
  const by_day = await q(pool,
    "SELECT DATE(COALESCE(created_at_mtn, created_at_utc)) d, " +
    "SUM(event_name='page_view') visits, SUM(event_name='thread_opened') threads, " +
    "SUM(event_name='ai_call') ai_calls, SUM(event_name='ai_call' AND ai_action='acknowledge') acks " +
    'FROM ' + W + ' GROUP BY d ORDER BY d', A);
  const by_hour = await q(pool, "SELECT HOUR(COALESCE(created_at_mtn, created_at_utc)) h, COUNT(*) n FROM " + AIW + ' GROUP BY h ORDER BY h', A);
  const by_dow = await q(pool, "SELECT local_dow d, COUNT(*) n FROM " + W + " AND event_name='ai_call' GROUP BY local_dow ORDER BY n DESC", A);

  // ---- other interactions ----
  const attach = await q(pool, "SELECT attachment_type t, COUNT(*) n FROM " + W + " AND event_name='attachment_viewed' AND attachment_type IS NOT NULL GROUP BY attachment_type ORDER BY n DESC", A);
  const corr = await q(pool, "SELECT correction_scope s, COUNT(*) n FROM " + W + " AND event_name='correction_added' AND correction_scope IS NOT NULL GROUP BY correction_scope ORDER BY n DESC", A);
  const errors = await q(pool, "SELECT error_type e, COUNT(*) n FROM " + W + " AND event_name='error' GROUP BY error_type", A);

  // ---- Salesforce writes (send / status change) + acknowledgements ----
  const sfw = (await q(pool,
    "SELECT SUM(event_name='send_email') sends, SUM(event_name='send_email' AND sf_ok=1) sends_ok, " +
    "SUM(event_name='status_change') status_changes, SUM(event_name='status_change' AND sf_ok=1) status_ok, " +
    "SUM(event_name='ai_call' AND ai_action='acknowledge') acks " +
    'FROM ' + W, A))[0] || {};
  const sf_errors = await q(pool, "SELECT sf_action a, sf_error e, COUNT(*) n FROM " + W +
    " AND sf_ok=0 AND sf_error IS NOT NULL AND sf_error<>'' GROUP BY sf_action, sf_error ORDER BY n DESC LIMIT 8", A);

  // ---- context-file changes, reply-copied, corrections-by-scope (surfaced on the dashboard) ----
  const ctxchg = await q(pool, "SELECT context_action a, COUNT(*) n FROM " + W + " AND event_name='context_changed' AND context_action IS NOT NULL AND context_action<>'' GROUP BY context_action ORDER BY n DESC", A);
  const replies_copied = n0(((await q(pool, "SELECT COUNT(*) n FROM " + W + " AND event_name='reply_copied'", A))[0] || {}).n);

  // ---- per-case activity (cases worked, most recent first) + the case funnel ----
  const cases = await q(pool,
    "SELECT case_number cn, MAX(case_id) cid, MAX(queue) queue, MAX(actor) actor, COUNT(*) events, " +
    "SUM(event_name='ai_call') ai_calls, SUM(event_name='ai_call' AND ai_action='ask') asks, " +
    "SUM(event_name='ai_call' AND ai_action='respond' AND ai_verdict='DRAFT') drafts, " +
    "SUM(event_name='correction_added') corrections, SUM(event_name='context_changed') context_changes, " +
    "SUM(event_name='send_email') sends, SUM(event_name='status_change') status_changes, SUM(event_name='attachment_viewed') attachments, " +
    "SUM(ai_cost_usd) cost, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %l:%i %p') last_seen " +
    'FROM ' + W + " AND case_number IS NOT NULL AND case_number<>'' GROUP BY case_number ORDER BY MAX(created_at_mtn) DESC LIMIT 15", A);
  const cfun = (await q(pool,
    "SELECT COUNT(DISTINCT case_number) opened, " +
    "COUNT(DISTINCT CASE WHEN event_name='ai_call' THEN case_number END) assisted, " +
    "COUNT(DISTINCT CASE WHEN event_name='ai_call' AND ai_action='respond' AND ai_verdict='DRAFT' THEN case_number END) drafted, " +
    "COUNT(DISTINCT CASE WHEN event_name='send_email' THEN case_number END) sent, " +
    "COUNT(DISTINCT CASE WHEN event_name='status_change' THEN case_number END) status_changed " +
    'FROM ' + W + " AND case_number IS NOT NULL AND case_number<>''", A))[0] || {};

  // ---- health (whole table, unfiltered — DB-size + test-row figure) ----
  const health = (await q(pool, "SELECT COUNT(*) rows_total, SUM(CASE WHEN is_test=1 THEN 1 ELSE 0 END) test_rows, DATE_FORMAT(MAX(CASE WHEN event_name<>'dashboard_view' THEN created_at_mtn END), '%b %e, %Y %l:%i %p') latest FROM `" + T + "`"))[0] || {};
  const sizerow = (await q(pool, 'SELECT ROUND((data_length+index_length)/1024/1024,2) mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [T]))[0] || {};

  const calls = n0(ai.calls);
  const data = {
    days: days,
    visits: cmap.page_view || 0,
    unique_users: n0(users.uniq), new_users: n0(users.new_u), repeat_users: n0(users.ret_u), operators: n0(users.operators),
    threads_opened: cmap.thread_opened || 0,
    acknowledgements: n0(sfw.acks),
    sf: { sends: n0(sfw.sends), sends_ok: n0(sfw.sends_ok), status_changes: n0(sfw.status_changes), status_ok: n0(sfw.status_ok) },
    sf_errors: sf_errors.map(function (r) { return { action: r.a || '?', error: r.e, n: n0(r.n) }; }),
    context_changes: ctxchg.map(function (r) { return { action: r.a || '?', n: n0(r.n) }; }),
    replies_copied: replies_copied,
    cases: cases.map(function (r) { return { case_number: String(r.cn || ''), case_id: String(r.cid || ''), queue: r.queue || '', actor: String(r.actor || ''), events: n0(r.events), ai_calls: n0(r.ai_calls), asks: n0(r.asks), drafts: n0(r.drafts), corrections: n0(r.corrections), context_changes: n0(r.context_changes), sends: n0(r.sends), status_changes: n0(r.status_changes), attachments: n0(r.attachments), cost_usd: usd6(r.cost), last_seen: r.last_seen || null }; }),
    case_funnel: [
      { stage: 'Opened', n: n0(cfun.opened) },
      { stage: 'AI-assisted', n: n0(cfun.assisted) },
      { stage: 'Drafted', n: n0(cfun.drafted) },
      { stage: 'Sent', n: n0(cfun.sent) },
      { stage: 'Status changed', n: n0(cfun.status_changed) }
    ],
    ai: {
      calls: calls, ok: n0(ai.ok), failed: n0(ai.failed),
      success_pct: pct(n0(ai.ok), calls),
      avg_ms: Math.round(n0(ai.avg_ms)), max_ms: Math.round(n0(ai.max_ms)),
      with_images: n0(ai.with_images), grounded: n0(ai.grounded), grounded_pct: pct(n0(ai.grounded), calls),
      avg_reply_chars: Math.round(n0(ai.avg_reply)), corrections_used: n0(ai.corrections_used),
      prompt_tokens: n0(ai.ptok), completion_tokens: n0(ai.ctok), cost_usd: usd6(ai.cost)
    },
    by_action: by_action.map(function (r) { return { action: r.a || '?', n: n0(r.n) }; }),
    by_provider: by_provider.map(function (r) { return { provider: r.p || '?', n: n0(r.n), avg_ms: Math.round(n0(r.avg_ms)) }; }),
    by_verdict: by_verdict.map(function (r) { return { verdict: r.v, n: n0(r.n) }; }),
    by_model: by_model.map(function (r) { return { model: r.m, n: n0(r.n), prompt_tokens: n0(r.ptok), completion_tokens: n0(r.ctok), cost_usd: usd6(r.cost) }; }),
    ai_errors: ai_errors.map(function (r) { return { error: r.e, n: n0(r.n) }; }),
    by_queue: by_queue.map(function (r) { return { queue: r.qn, events: n0(r.events), ai_calls: n0(r.ai_calls), threads: n0(r.threads) }; }),
    top_operators: top_ops.map(function (r) { return { actor: String(r.a || ''), ai_calls: n0(r.ai_calls), threads: n0(r.threads), events: n0(r.events), last_seen: r.last_seen || null }; }),
    recent_operators: recent_ops.map(function (r) { return { actor: String(r.a || ''), events: n0(r.events), ai_calls: n0(r.ai_calls), last_seen: r.last_seen || null }; }),
    visitors: visitors.map(function (r) { return { id: String(r.v || ''), returning: n0(r.ret), actor: String(r.actor || ''), actors: n0(r.actor_n), tz: r.tz || null, viewport: r.viewport || null, visits: n0(r.visits), threads: n0(r.threads), queues: n0(r.queues), events: n0(r.events), last_seen: r.last_seen || null }; }),
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
        data.visits + ' visits · ' + data.unique_users + ' unique users · ' + data.operators + ' actors',
        data.threads_opened + ' threads opened · ' + data.acknowledgements + ' acknowledgements sent'
      ] },
      { heading: 'AI flow', lines: [
        data.ai.calls + ' AI calls · ' + data.ai.success_pct + '% succeeded · avg ' + data.ai.avg_ms + ' ms',
        'providers: ' + prov_str,
        'verdicts: ' + verdict_str,
        'grounded with context: ' + data.ai.grounded_pct + '% · ' + data.ai.with_images + ' used images · ' + data.ai.corrections_used + ' corrections applied',
        'tokens: ' + data.ai.prompt_tokens + ' in / ' + data.ai.completion_tokens + ' out · estimated cost: $' + data.ai.cost_usd.toFixed(4)
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

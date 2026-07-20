'use strict';
// salesforce_merge module — server API (Phase 1). The domain handlers from the standalone app
// (src/salesforce_merge/api/routes.js) ported verbatim, re-namespaced under /api/salesforce-merge/* and
// gated by the single `merge` panel (platform Admin grants it). Dropped: auth/login/logout/me, the admin
// user/panel endpoints, and the metrics endpoints — the platform owns those. Server-side usage logging is
// a no-op shim here; Phase 4 reroutes merge events into the platform analytics (usat_apps_events).
// Salesforce writes stay guarded by MERGE_ENABLE_EXECUTION in the store layer; Phase 3 moves
// execute/restore/refresh to a worker.
const http = require('http');
const { require_panel, require_auth, require_admin } = require('../../auth/require_auth');
const dashboard = require('./store/duplicates_read');
const reviews = require('./store/reviews_read');
const refresh = require('./store/refresh_runner');
const cluster = require('./store/cluster_detail');
const mqueue = require('./store/merge_queue');
const mexec = require('./store/merge_execute');
const mhist = require('./store/merge_history');
const mrun = require('./store/merge_run');
const mrestore = require('./store/merge_restore');
const rdiff = require('./store/restore_diff');
const stagebase = require('./store/merge_stage_baseline');
const msnap = require('./store/merge_snapshot');
const mdossier = require('./store/merge_dossier');
const sfread = require('./store/salesforce_read');
const sfwrite = require('./store/salesforce_write');
const api_usage = require('./store/api_usage');
const api_estimate = require('./store/api_estimate');
const msettings = require('./store/merge_settings');
const msettings_store = require('./store/merge_settings_store');
const pm2ctl = require('./store/pm2_control');
const { plan_job, make_job_id, should_parallelize } = require('./store/chunk');
const harness = require('./stress_test');   // reuse the tested random selection helpers (no CLI side-effects on require)
const log_tail = require('../ops/log_tail');   // shared pm2 log SSE multiplexer (same one Ops → Server cards use)

// Phase 1: server-side event logging is a no-op (Phase 4 wires merge usage into usat_apps_events via the
// platform analytics). Kept as a shim so the ported handler bodies stay byte-for-byte.
const analytics = require('./metrics/events');
const metrics_report = require('./metrics/metrics_report');

// Port of the isolated Salesforce write worker (server_salesforce_merge_worker_8021.js). The web tier
// only ENQUEUES jobs; this worker drains them. Overridable for non-default deployments.
const WORKER_PORT = Number(process.env.MERGE_WORKER_PORT) || 8021;

// Stamp each queued set with the connected org id so the merge-time alignment guard has a hard
// org pin (not just the Sandbox/Production label). org id is stable per org, so cache it per
// environment for the process lifetime; this is BEST-EFFORT — if Salesforce is unreachable we
// store null and queueing still succeeds (the environment label remains the live guard).
const _orgIdCache = new Map(); // is_test(boolean) -> org_id(string)
async function resolve_org_id(is_test) {
  if (_orgIdCache.has(is_test)) return _orgIdCache.get(is_test);
  let org_id = null;
  try { const oi = await sfread.get_org_identity({ is_test }); org_id = (oi && oi.org_id) || null; } catch (e) { /* best effort */ }
  if (org_id) _orgIdCache.set(is_test, org_id); // cache positive results only, so a transient failure can be retried
  return org_id;
}

// is_test for a server-side action log is driven ONLY by the metrics_test=1 parameter (the client
// attaches it to every request when the admin "flag as test" toggle is on). Nothing else sets is_test.
function mtest(req) {
  try { return (String((req.query && req.query.metrics_test) || (req.body && req.body.metrics_test) || '') === '1') ? 1 : 0; }
  catch (e) { return 0; }
}

function mount(app) {
  const gate = require_panel('merge');
  const opsGate = require_panel('merge-ops');   // admin-only Merge Ops panel (grantable in Users & Access)

  // Table create/normalize is LAZY, not at boot: mrun.* and msettings_store.* each call their own
  // ensure_table()/ensure() (idempotent, _ensured-guarded) on first real use — so the merge tables + the
  // job-column self-heal + the live-settings table are still created on demand ("restart is enough, no
  // manual migration"), WITHOUT opening a DB pool at create_app() time. That keeps the no-DB smoke tests
  // (which build the app but never touch these endpoints) able to exit cleanly.

  // ---- Merge Ops (Phase 2): live operational settings (parallel/chunk/max_batch/apex cap), DB-backed so
  // an admin tunes them without env edits or a redeploy. Read + write gated by the merge-ops panel. ----
  app.get('/api/salesforce-merge/ops/settings', opsGate, async function (req, res) {
    try { res.json({ ok: true, settings: await msettings_store.get_all(), last_saved: await msettings_store.last_saved() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.put('/api/salesforce-merge/ops/settings', opsGate, async function (req, res) {
    try {
      const stored = await msettings_store.set_many(req.body || {}, current_user(req));
      analytics.log({ event_name: 'merge_ops_settings', actor: req.user, role: req.role, panel: 'merge-ops', is_test: mtest(req), outcome: 'ok' });
      res.json({ ok: true, stored, settings: await msettings_store.get_all(), last_saved: await msettings_store.last_saved() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live worker/queue snapshot for the Merge Ops panel (queue depth, workers actively draining, held, jobs).
  app.get('/api/salesforce-merge/ops/workers', opsGate, async function (req, res) {
    try { res.json({ ok: true, workers: await mrun.ops_status() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // pm2 cluster online count (on-demand, not polled — it shells to `pm2 jlist`).
  app.get('/api/salesforce-merge/ops/pm2', opsGate, async function (req, res) {
    try { res.json({ ok: true, ...(await pm2ctl.online_count()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live worker log tail (pm2 logs --nostream). Polled only while the panel is open.
  app.get('/api/salesforce-merge/ops/logs', opsGate, async function (req, res) {
    try { res.json({ ok: true, ...(await pm2ctl.tail_logs(req.query.lines || 80)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live worker log STREAM (SSE) — same multiplexer + line format as Ops → Server cards, but gated by the
  // merge-ops PANEL (user-based grant) instead of admin, so a granted user sees the worker logs.
  app.get('/api/salesforce-merge/ops/logs/stream', opsGate, function (req, res) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (res.flushHeaders) res.flushHeaders();
    // name=<process> filters to one pm2 process; empty or name=all streams EVERY process (so single-run
    // merges, which execute in the main app server rather than the worker cluster, are visible too).
    const q = String((req.query || {}).name || '').trim();
    const name = (q && q.toLowerCase() !== 'all') ? q : null;
    log_tail.subscribe(res, name, (req.query || {}).lines);   // lines = how much history to backfill (clamped server-side)
  });
  // On-the-fly worker scaling: clamp 1–8, persist worker_target, then `pm2 scale`. Best-effort — a pm2
  // failure returns ok:false with the message (never a 500), and never touches the merge write path.
  app.post('/api/salesforce-merge/ops/scale', opsGate, async function (req, res) {
    try {
      const n = msettings.coerce('worker_target', (req.body || {}).n);
      await msettings_store.set('worker_target', n, current_user(req));
      const r = await pm2ctl.scale(n);
      analytics.log({ event_name: 'merge_ops_scale', actor: req.user, role: req.role, panel: 'merge-ops', is_test: mtest(req), outcome: r.ok ? 'ok' : 'error' });
      res.json({ ok: r.ok, n: r.n, output: r.output, error: r.error || null });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Batch run — RANDOM sample (stress): pick a seeded random sample of duplicate/merge-id sets by size
  // band + count (same options as menu item 32), queue + approve them, and return the ids to run. Selection
  // is read-only against the loaded dataset; the actual merge still needs execute + the server-side gates.
  app.post('/api/salesforce-merge/ops/batch/stage', opsGate, async function (req, res) {
    try {
      const b = req.body || {};
      const stamp = await harness.get_dataset_stamp();
      const source = String(b.source || 'duplicate').toLowerCase().startsWith('merge') ? 'merge_id' : 'group';
      // Full Select-Merges filter set, passed straight through to matching_keys (filter_cols + filter_map).
      const o = { env: stamp.env, source, filters: b.filters || {}, colFilters: b.colFilters || {},
        count: Math.max(1, Math.min(500, Number(b.count) || 10)), seed: Number(b.seed) || (Date.now() % 100000) };
      const sel = await harness.select_targets(o, stamp);
      const ids = await harness.queue_and_approve(sel.entries);
      analytics.log({ event_name: 'merge_ops_stage', actor: req.user, role: req.role, panel: 'merge-ops', is_test: mtest(req), outcome: 'ok', set_count: ids.length });
      res.json({ ok: true, ids, staged: ids.length, pool: sel.pool, sampled: sel.sampled, seed: o.seed, env: stamp.env });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live "N sets match these filters" count for the batch-run UI (same filter machinery as staging).
  app.post('/api/salesforce-merge/ops/batch/count', opsGate, async function (req, res) {
    try {
      const b = req.body || {};
      const view = String(b.source || 'duplicate').toLowerCase().startsWith('merge') ? 'merge-id' : 'duplicates';
      const count = await reviews.count_matching(view, { filters: b.filters || {}, colFilters: b.colFilters || {} });
      res.json({ ok: true, count });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Batch run — RESTORE job: fan out a restore over the given ids (same job model as merge), so the panel
  // can run an explicit "restore afterward" phase. Mirrors /merge/process for kind='restore'.
  app.post('/api/salesforce-merge/ops/batch/restore', opsGate, async function (req, res) {
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'no ids to restore' });
      const opts = { mode: b.mode, confirm: 'RESTORE', ack_post_merge: true, created_by: current_user(req) };
      const parallel_enabled = await msettings_store.get('parallel_enabled');
      const chunk_size = await msettings_store.get('chunk_size');
      if (should_parallelize(ids.length, chunk_size, parallel_enabled)) {
        const chunks = plan_job(ids, chunk_size);
        const job_id = make_job_id();
        for (let i = 0; i < chunks.length; i += 1) {
          await mrun.enqueue({ kind: 'restore', mode: b.mode, created_by: current_user(req),
            job_id, batch_index: i + 1, batch_total: chunks.length, current_label: 'Queued restore (batch ' + (i + 1) + '/' + chunks.length + ')',
            params: { ids: chunks[i], opts, job_id, batch_index: i + 1, batch_total: chunks.length } });
        }
        analytics.log({ event_name: 'merge_ops_restore', actor: req.user, role: req.role, panel: 'merge-ops', is_test: mtest(req), outcome: 'queued', set_count: ids.length });
        return res.json({ ok: true, job_id, runs: chunks.length, parallel: true, kind: 'restore' });
      }
      const r = await mrun.enqueue({ kind: 'restore', mode: b.mode, created_by: current_user(req), params: { ids, opts } });
      analytics.log({ event_name: 'merge_ops_restore', actor: req.user, role: req.role, panel: 'merge-ops', is_test: mtest(req), outcome: 'queued' });
      res.json({ ok: true, parallel: false, kind: 'restore', ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Skeleton health check retained for smoke tests.
  app.get('/api/salesforce-merge/ping', gate, function (req, res) { res.json({ ok: true, module: 'merge' }); });

  // Worker liveness — the web tier only ENQUEUES; the isolated worker (:8021) drains the queue. If it's
  // down, jobs sit 'queued' and never run, so the UI shows a "no worker online" banner. This proxies the
  // worker's own /api/status with a short timeout; online:false on any error/timeout (fail-safe = offline).
  app.get('/api/salesforce-merge/worker/health', gate, function (req, res) {
    let finished = false;
    const done = function (online, detail) { if (finished) return; finished = true; res.json({ ok: true, online: !!online, port: WORKER_PORT, detail: detail || null }); };
    const wreq = http.get({ host: '127.0.0.1', port: WORKER_PORT, path: '/api/status', timeout: 1500 }, function (r) {
      let b = ''; r.on('data', function (d) { b += d; });
      r.on('end', function () {
        let parsed = null; try { parsed = JSON.parse(b); } catch (e) { /* non-json */ }
        const online = r.statusCode < 400 && !!(parsed && parsed.ok);
        done(online, parsed ? { app: parsed.app, pid: parsed.pid, execution_enabled: parsed.execution_enabled, worker: parsed.worker } : null);
      });
    });
    wreq.on('timeout', function () { wreq.destroy(); done(false, { error: 'timeout' }); });
    wreq.on('error', function (e) { done(false, { error: (e && (e.code || e.message)) || 'error' }); });
  });

  // ---- SF Merge metrics panel: usage analytics on salesforce_merge_events (its own table) ----
  app.post('/api/salesforce-merge/event', gate, function (req, res) {
    analytics.ingest_http(req, req.user, req.role).finally(function () { try { res.status(204).end(); } catch (e) { /* gone */ } });
  });
  app.get('/api/salesforce-merge/metrics-report', require_panel('merge-metrics'), async function (req, res) {
    try {
      const pool = await require('../../store/db').get_pool();
      await analytics.ensure(pool);
      res.json({ ok: true, report: await metrics_report.build_report(pool, { days: Number(req.query.days) || 7, include_test: String(req.query.test) === '1' }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/metrics-purge-test', require_admin, async function (req, res) {
    try {
      const pool = await require('../../store/db').get_pool();
      res.json({ ok: true, ...(await metrics_report.purge_test(pool)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/metrics-ask-models', require_panel('merge-metrics'), function (req, res) {
    try { res.json({ ok: true, ...require('./metrics/ask').list_models() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/metrics-ask', require_panel('merge-metrics'), async function (req, res) {
    try {
      const b = req.body || {};
      const pool = await require('../../store/db').get_pool();
      res.json(await require('./metrics/ask').ask(pool, { question: b.question, model: b.model, history: b.history, mode: b.mode, sql: b.sql }));
    } catch (e) { res.status(e.code === 'NO_AI_KEY' ? 501 : 400).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/metrics-ask-correct', require_panel('merge-metrics'), function (req, res) {
    try {
      const b = req.body || {};
      const note = String(b.note || '').trim();
      if (!note) return res.status(400).json({ ok: false, error: 'no correction text' });
      const n = require('./metrics/ask').add_correction(note, b.question, b.answer, req.user);
      res.json({ ok: true, count: n });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/dashboard', gate, async function (req, res) {
    try {
      res.json({ ok: true, data: await dashboard.dashboard_counts() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/salesforce-merge/dataset', gate, async function (req, res) {
    try { res.json({ ok: true, data: await dashboard.dataset_info() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/salesforce-merge/tuning', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await dashboard.sweep_profiles()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/tuning/export', gate, async function (req, res) {
    try { await write_rows(req, res, await dashboard.sweep_export_rows(), 'tuning_' + new Date().toISOString().slice(0, 10), 'tuning'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/salesforce-merge/runs', gate, async function (req, res) {
    try { res.json({ ok: true, runs: await dashboard.recent_runs(req.query.limit) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- R1: data-refresh runner (spawns the detection job; read-only against Salesforce) ----
  app.post('/api/salesforce-merge/refresh/start', gate, function (req, res) {
    const b = req.body || {};
    const r = refresh.start({ env: b.env, scope: b.scope, job: b.job });
    analytics.log({ event_name: 'data_build', actor: req.user, role: req.role, panel: 'get-duplicates', is_test: mtest(req), mode: b.scope || null, outcome: r.ok ? 'started' : 'skipped' });
    res.status(r.ok ? 202 : 409).json(r);
  });
  app.get('/api/salesforce-merge/refresh/status', gate, function (req, res) {
    res.json({ ok: true, ...refresh.status() });
  });
  app.post('/api/salesforce-merge/refresh/cancel', gate, function (req, res) {
    const r = refresh.cancel();
    res.status(r.ok ? 200 : 409).json(r);
  });

  // ---- Phase 1 review pages (read-only, server-side paged) ----
  // Per-column "contains" filters arrive as f_<column>=text query params.
  const col_filters = (req) => {
    const o = {};
    for (const [k, v] of Object.entries(req.query)) if (k.startsWith('f_')) o[k.slice(2)] = v;
    return o;
  };
  const current_user = (req) => (req && req.user) || null;
  const page_opts = (req) => ({
    page: req.query.page, page_size: req.query.page_size, q: req.query.q,
    sort: req.query.sort, dir: req.query.dir, colFilters: col_filters(req),
  });

  // ---- export (CSV / Excel) — same search/filters/sort as the on-screen view, no paging ----
  const csv_cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const to_csv = (rows) => {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const lines = [headers.map(csv_cell).join(',')];
    for (const r of rows) lines.push(headers.map((h) => csv_cell(r[h])).join(','));
    return lines.join('\r\n');
  };
  // Stream a set of rows as CSV or Excel (shared by every export endpoint).
  const write_rows = async (req, res, rows, fname, sheet) => {
    if (String(req.query.format) === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheet || 'export');
      const headers = rows.length ? Object.keys(rows[0]) : [];
      ws.addRow(headers);
      for (const r of rows) ws.addRow(headers.map((h) => r[h]));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '.xlsx"');
      await wb.xlsx.write(res);
      res.end();
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '.csv"');
      res.send(to_csv(rows));
    }
  };
  const send_export = async (req, res, view, opts) => {
    const rows = await reviews.export_rows(view, opts);
    await write_rows(req, res, rows, view.replace('-', '_') + '_export_' + new Date().toISOString().slice(0, 10), view);
  };

  app.get('/api/salesforce-merge/duplicates', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await reviews.list_duplicates({ ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, foundation_state: req.query.foundation_state, size_eq: req.query.size, match_type: req.query.match_type, best_min: req.query.best_min, tier: req.query.tier } })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/duplicates/facets', gate, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('duplicates') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/duplicates/export', gate, async function (req, res) {
    try { await send_export(req, res, 'duplicates', { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, foundation_state: req.query.foundation_state, size_eq: req.query.size, match_type: req.query.match_type, best_min: req.query.best_min, tier: req.query.tier } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Members of one consolidated cluster (account-level detail for the Duplicates "view group" popup).
  app.get('/api/salesforce-merge/cluster', gate, async function (req, res) {
    try { res.json({ ok: true, data: await reviews.cluster_accounts(req.query.key) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/cluster/export', gate, async function (req, res) {
    try {
      const { accounts } = await reviews.cluster_accounts(req.query.key);
      const safe = String(req.query.key || 'group').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      await write_rows(req, res, accounts, 'cluster_' + safe + '_' + new Date().toISOString().slice(0, 10), 'cluster');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Phase 2 — read-only deep detail (live Salesforce, snapshot fallback) + dry-run merge preview.
  app.get('/api/salesforce-merge/cluster/detail', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_detail(req.query.key, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/cluster/preview', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_preview(req.query.key, req.query.survivor, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/cluster/children', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_children(req.query.key, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/cluster/detail/export', gate, async function (req, res) {
    try {
      const d = await cluster.cluster_detail(req.query.key, { kind: req.query.source });
      const safe = String(req.query.key || 'cluster').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      await write_rows(req, res, d.accounts || [], 'accounts_' + safe + '_' + new Date().toISOString().slice(0, 10), 'accounts');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- Merge Admin sources + queue ----
  app.get('/api/salesforce-merge/merge-groups', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await reviews.list_merge_groups({ ...page_opts(req), bucket: req.query.bucket, foundation_state: req.query.foundation_state, size: req.query.size, which_list: req.query.which_list })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge-queue', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await mqueue.list(undefined, req.query.status) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge-queue/approve', gate, async function (req, res) {
    try {
      const ids = (req.body || {}).ids || [];
      const r = await mqueue.set_status(ids, 'approved');
      analytics.log({ event_name: 'queue_approve', actor: req.user, role: req.role, panel: 'select-merges', is_test: mtest(req), set_count: Array.isArray(ids) ? ids.length : undefined, outcome: 'ok' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Move approved sets back to queued (un-approve). Guarded: only approved -> queued.
  app.post('/api/salesforce-merge/merge-queue/unapprove', gate, async function (req, res) {
    try {
      const ids = (req.body || {}).ids || [];
      const r = await mqueue.transition(ids, 'queued', ['approved']);
      analytics.log({ event_name: 'queue_unapprove', actor: req.user, role: req.role, panel: 'select-merges', is_test: mtest(req), set_count: Array.isArray(ids) ? ids.length : undefined, outcome: 'ok' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge-queue/export', gate, async function (req, res) {
    try { await write_rows(req, res, await mqueue.list(undefined, req.query.status || null), 'merge_queue_' + new Date().toISOString().slice(0, 10), 'merge_queue'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge-queue', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const ds0 = await dashboard.dataset_info().catch(() => null);
      const org_id = b.org_id || await resolve_org_id(!ds0 || ds0.environment !== 'Production');
      // Insert IMMEDIATELY using the child count the UI already fetched (display-only; the merge itself
      // re-fetches children live at process time). The authoritative live count is backfilled in the
      // BACKGROUND (below) so the "Add to queue" click isn't blocked by a Salesforce round-trip.
      const r = await mqueue.add({ created_by: current_user(req), source_type: b.source_type, source_key: b.source_key, environment: ds0 ? ds0.environment : null, org_id,
        survivor_account: b.survivor_account, survivor_contact: b.survivor_contact, survivor_name: b.survivor_name, field_overrides: b.field_overrides, child_counts: b.child_counts || null,
        loser_accounts: b.loser_accounts, master_rule: b.master_rule, notes: b.notes });
      // Stage-time baseline: capture the field values the user just reviewed so the merge can flag
      // drift at process time. Best-effort — a failure here must never block queueing.
      if (r && r.id && b.staged_fields && typeof b.staged_fields === 'object') {
        try { await stagebase.save(r.id, b.staged_fields); } catch (e) { /* non-fatal */ }
      }
      analytics.log({ event_name: 'queue_add', actor: req.user, role: req.role, panel: 'select-merges', is_test: mtest(req), source_type: b.source_type, source_key: b.source_key, set_count: 1, outcome: 'ok' });
      res.status(201).json({ ok: true, ...r });
      // --- background backfill: authoritative live child count (fire-and-forget, never blocks the response) ---
      if (r && r.id && b.source_key && b.source_type) {
        const losers = Array.isArray(b.loser_accounts) ? b.loser_accounts : String(b.loser_accounts || '').split(';').map((s) => s.trim()).filter(Boolean);
        if (losers.length) {
          (async () => {
            try {
              const cc = await cluster.cluster_children(b.source_key, { kind: b.source_type });
              if (cc && cc.source === 'salesforce' && cc.children) {
                let total = 0; const by = {};
                for (const lid of losers) { const c = cc.children[lid]; if (c) { total += Number(c.total) || 0; for (const [k, v] of Object.entries(c.by || {})) by[k] = (by[k] || 0) + v; } }
                await mqueue.set_child_counts(r.id, { total, by });
              }
            } catch (e) { /* keep the client-sent count */ }
          })();
        }
      }
      return;
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge-queue/bulk', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const src = b.source === 'group' ? 'group' : (b.source === 'merge_id' ? 'merge_id' : null);
      if (!src) return res.status(400).json({ ok: false, error: 'bulk add supports the merge_id or group source' });
      const dsb = await dashboard.dataset_info().catch(() => null);
      const org_id = await resolve_org_id(!dsb || dsb.environment !== 'Production'); // resolved once, reused for the whole batch
      const groups = src === 'merge_id'
        ? await reviews.resolve_merge_groups({ q: b.q, bucket: b.bucket, foundation_state: b.foundation_state, size: b.size, which_list: b.which_list, keys: b.keys })
        // nest the list filters under `filters` so build_clauses applies them — this makes
        // "select all matching" honour the same merge-id/member/foundation/size/match-type filters
        // the list is showing.
        : await reviews.resolve_duplicate_groups({ q: b.q, keys: b.keys, filters: { merge_id_state: b.merge_id_state, member_number_state: b.member_number_state, foundation_state: b.foundation_state, size_eq: b.size, match_type: b.match_type, best_min: b.best_min, tier: b.tier } });
      const keyOf = (g) => (src === 'merge_id' ? g.merge_id : g.source_key);
      const CAP = 1000;
      const resolvable = groups.filter((g) => g.resolvable);
      const unresolved = groups.length - resolvable.length;
      const capped = resolvable.length > CAP;
      const entries = resolvable.slice(0, CAP).map((g) => ({ created_by: current_user(req), source_type: src, source_key: keyOf(g), survivor_account: g.survivor, survivor_name: g.name, loser_accounts: g.losers, master_rule: g.rule || 'cascade', environment: dsb ? dsb.environment : null, org_id }));
      const r = await mqueue.add_many(entries);
      // Stage baseline for each newly-added set — from the local snapshot (canonical drift handles the
      // snapshot-vs-live shape difference). Best-effort; never blocks bulk queueing.
      try {
        const addedRows = (r.added || []).filter((x) => x && x.id);
        if (addedRows.length) {
          const allIds = [...new Set(addedRows.flatMap((x) => [x.entry.survivor_account].concat(x.entry.loser_accounts || [])).filter(Boolean).map(String))];
          const accts = await reviews.accounts_by_ids(allIds);
          const byId = new Map((accts || []).map((a) => [a.account, a]));
          for (const x of addedRows) {
            const setIds = [x.entry.survivor_account].concat(x.entry.loser_accounts || []).filter(Boolean);
            const map = {};
            for (const id of setIds) if (byId.has(id)) map[id] = byId.get(id);
            if (Object.keys(map).length) await stagebase.save(x.id, map);
          }
        }
      } catch (e) { /* non-fatal */ }
      analytics.log({ event_name: 'queue_bulk_add', actor: req.user, role: req.role, panel: 'select-merges', is_test: mtest(req), source_type: src, set_count: r.queued, outcome: 'ok' });
      res.json({ ok: true, queued: r.queued, skipped: r.skipped, merged: r.merged, unresolved, total: groups.length, capped });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/status', gate, async function (req, res) {
    try {
      // Effective parallel state (DB -> env -> default), so the main Process Merges UI can show whether a run
      // will fan out — read-only, no admin gate needed. chunk_size drives the "≈ N batches" prediction.
      let parallel_enabled = false; let chunk_size = 5;
      try { parallel_enabled = !!(await msettings_store.get('parallel_enabled')); chunk_size = Number(await msettings_store.get('chunk_size')) || 5; } catch (e) { /* settings table not ready */ }
      res.json({ ok: true, max_batch: Math.min(500, Math.max(1, Number(process.env.MERGE_MAX_BATCH) || 100)), max_batch_hard: 500, parallel_enabled, chunk_size, ...(await mexec.status()) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge/process', gate, async function (req, res) {
    try {
      const b = req.body || {};
      // Batch safety limit: cap how many sets one job can run. Now resolved from the live settings store
      // (DB -> env MERGE_MAX_BATCH -> default), so an admin can tune it without a redeploy. Only gates
      // real writes; simulate/dry-run is unlimited.
      const HARD_MAX = 500;   // absolute ceiling the user's setting can never exceed
      const dfltMax = await msettings_store.get('max_batch');   // DB -> env -> default (admin-tunable, live)
      const reqMax = (b.max_batch != null && b.max_batch !== '') ? Math.min(HARD_MAX, Math.max(1, Number(b.max_batch) || dfltMax)) : dfltMax;
      if (b.mode === 'execute' && !b.dry_run && Array.isArray(b.ids) && b.ids.length > reqMax) {
        return res.status(400).json({ ok: false, error: 'Batch too large: ' + b.ids.length + ' sets exceeds the limit of ' + reqMax + ' per Execute (hard cap ' + HARD_MAX + ').' });
      }
      const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : [];
      const opts = { mode: b.mode, confirm: b.confirm, dry_run: !!b.dry_run, stamp_merged: !!b.stamp_merged, ack_drift: !!b.ack_drift, attach_dossier: b.attach_dossier !== false, created_by: current_user(req) };
      // PARALLEL FAN-OUT (Phase 1): when parallel is enabled and the job is bigger than one chunk, split
      // it into N chunk-runs that share a job_id so the worker CLUSTER drains them side by side. Small jobs
      // (or parallel disabled) enqueue exactly one run — byte-identical to the pre-parallel path.
      const parallel_enabled = await msettings_store.get('parallel_enabled');
      const chunk_size = await msettings_store.get('chunk_size');
      if (should_parallelize(ids.length, chunk_size, parallel_enabled)) {
        const chunks = plan_job(ids, chunk_size);
        const job_id = make_job_id();
        for (let i = 0; i < chunks.length; i += 1) {
          await mrun.enqueue({ kind: 'merge', mode: b.mode, created_by: current_user(req),
            job_id, batch_index: i + 1, batch_total: chunks.length,
            current_label: 'Queued (batch ' + (i + 1) + '/' + chunks.length + ')',
            params: { ids: chunks[i], opts, job_id, batch_index: i + 1, batch_total: chunks.length } });
        }
        analytics.log({ event_name: 'merge_run', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req),
          mode: (b.dry_run || b.mode !== 'execute') ? 'simulate' : 'execute', outcome: 'queued', set_count: ids.length });
        return res.json({ ok: true, queued: true, job_id, runs: chunks.length, parallel: true });
      }
      // Single-run path (parallel off, or job <= one chunk) — the worker claims + runs it, exactly as before.
      const r = await mrun.enqueue({ kind: 'merge', mode: b.mode, created_by: current_user(req),
        params: { ids, opts } });
      analytics.log({ event_name: 'merge_run', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req),
        mode: (b.dry_run || b.mode !== 'execute') ? 'simulate' : 'execute', outcome: 'queued' });
      res.json({ ok: true, queued: true, parallel: false, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Job-aware live progress: aggregate all the parallel chunk-runs of one job (sets done, workers active,
  // paused/held count, rolled-up status). The UI polls this for the single aggregate progress bar.
  app.get('/api/salesforce-merge/merge/job/:jobId/progress', gate, async function (req, res) {
    try { res.json({ ok: true, job: await mrun.job_progress(req.params.jobId) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Cancel the whole job (all its batches): flag running chunks + drop queued ones.
  app.post('/api/salesforce-merge/merge/job/:jobId/cancel', gate, async function (req, res) {
    try {
      const r = await mrun.cancel_job(req.params.jobId);
      analytics.log({ event_name: 'merge_job_cancel', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req), outcome: 'ok' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Resume a paused job (async-Apex cap or manual hold): put held chunks back to queued so the cluster
  // drains them again. Already-merged sets drop out via the executor's drift check.
  app.post('/api/salesforce-merge/merge/job/:jobId/resume', gate, async function (req, res) {
    try {
      const r = await mrun.resume_job(req.params.jobId);
      analytics.log({ event_name: 'merge_job_resume', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req), outcome: 'ok' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Finalize a completed job into the SAME Excel workbook + sweep row the CLI harness writes — so runs
  // started from the UI or the Merge Ops panel get a report too. Best-effort; returns the file path.
  app.post('/api/salesforce-merge/merge/job/:jobId/report', gate, async function (req, res) {
    try {
      // Optional restore_job_id folds a paired restore job into the SAME workbook (Restores tab); seed
      // records the random-sample seed used (blank for approved runs).
      const b = req.body || {};
      const report = await harness.report_job(req.params.jobId, { restore_job_id: b.restore_job_id || null, seed: b.seed });
      analytics.log({ event_name: 'merge_job_report', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req), outcome: report ? 'ok' : 'empty' });
      res.json({ ok: true, report: report || null });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Same workbook + sweep row for a SINGLE run (parallel off / no fan-out).
  app.post('/api/salesforce-merge/merge/run/:runId/report', gate, async function (req, res) {
    try {
      const report = await harness.report_run(req.params.runId, { seed: (req.body || {}).seed });
      analytics.log({ event_name: 'merge_run_report', actor: req.user, role: req.role, panel: 'merge-process', is_test: mtest(req), outcome: report ? 'ok' : 'empty' });
      res.json({ ok: true, report: report || null });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/history', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await mhist.list({ limit: req.query.limit, result: req.query.result, mode: req.query.mode, q: req.query.q }) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/history/export', gate, async function (req, res) {
    try { await write_rows(req, res, await mhist.list({ limit: req.query.limit || 5000, result: req.query.result, mode: req.query.mode, q: req.query.q }), 'merge_history_' + new Date().toISOString().slice(0, 10), 'merge_history'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Run-level Job history: one row per job/run with sets, batches, workers, times, sec/merge, and the
  // HONEST per-job API/Apex — the whole-run before→after delta across the job's run_ids (NOT the sum of the
  // per-batch org-wide windows, which overcounts in parallel). api_per_merge = api_total ÷ sets (approx).
  app.get('/api/salesforce-merge/merge/job-history', gate, async function (req, res) {
    try {
      const jobs = await mrun.list_jobs({ limit: req.query.limit, env: req.query.env, kind: req.query.kind });
      let pool = null; try { pool = await require('../../store/db').get_pool(); } catch (e) { pool = null; }
      for (const j of jobs) {
        let win = null;
        if (pool) { try { win = await api_usage.job_window(pool, j.run_ids); } catch (e) { win = null; } }
        j.api_total = (win && win.after.used != null && win.before.used != null) ? Math.max(0, win.after.used - win.before.used) : null;
        j.apex_total = (win && win.after.apex_used != null && win.before.apex_used != null) ? Math.max(0, win.after.apex_used - win.before.apex_used) : null;
        j.api_per_merge = (j.api_total != null && j.total_sets) ? Math.round(j.api_total / j.total_sets) : null;
        delete j.run_ids;   // internal — not shipped to the client
      }
      res.json({ ok: true, jobs });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Merge dossier: the archived multi-tab .xlsx for a lifecycle action. `list` returns the metadata
  // rows for a queue entry (History link source); `download` streams the DB copy of the workbook.
  app.get('/api/salesforce-merge/merge/dossier', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await mdossier.list_for_entry(req.query.queue_id) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/dossier/:id/download', gate, async function (req, res) {
    try {
      const d = await mdossier.get_blob(req.params.id);
      if (!d || !d.buffer) return res.status(404).json({ ok: false, error: 'dossier not found' });
      const name = String(d.filename || 'merge_dossier.xlsx');
      // HTTP headers are Latin-1 only, but the filename has an em-dash (—). Send an ASCII-safe `filename`
      // fallback plus an RFC-5987 UTF-8 `filename*` so browsers keep the real name (and Node doesn't throw).
      const ascii = name.replace(/[^\x20-\x7E]/g, '-').replace(/"/g, '');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(name));
      res.send(Buffer.isBuffer(d.buffer) ? d.buffer : Buffer.from(d.buffer));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live progress for the latest run (UI polls this for the progress bar + timer + ETA).
  app.get('/api/salesforce-merge/merge/progress', gate, async function (req, res) {
    try { res.json({ ok: true, run: req.query.run_id ? await mrun.get(req.query.run_id) : await mrun.latest(req.query.kind || null) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Cooperative stop: flag the latest RUNNING run so its loop halts at the next set boundary. The
  // in-flight set finishes cleanly (its snapshot/history/status are already written); remaining
  // approved sets are left untouched so they can be run again later.
  app.post('/api/salesforce-merge/merge/cancel', gate, async function (req, res) {
    try {
      const run = await mrun.latest((req.body && req.body.kind) || 'merge');
      if (!run || run.status !== 'running') return res.json({ ok: true, cancelled: false, reason: 'no running merge' });
      await mrun.request_cancel(run.run_id);
      res.json({ ok: true, cancelled: true, run_id: run.run_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Phase 4 restore — list completed merges with eligibility, and process a restore.
  app.get('/api/salesforce-merge/merge/restore', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await mrestore.list_restorable() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Restore diff / drift check — live compare of a merged set's survivor vs its pre-merge snapshot.
  app.get('/api/salesforce-merge/merge/restore/diff', gate, async function (req, res) {
    try { res.json({ ok: true, ...(await rdiff.diff_for_entry(req.query.id)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Post-merge diff — did the survivor change IN SALESFORCE after the merge? Compares live vs the
  // post-merge snapshot + LastModifiedDate. Bulk (button over selected sets) or single (row expand).
  app.post('/api/salesforce-merge/merge/restore/post-diff', gate, async function (req, res) {
    try {
      const ids = (req.body && req.body.ids) || [];
      const results = [];
      for (const id of ids) results.push(await rdiff.post_merge_diff(id));
      res.json({ ok: true, results });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge/restore', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const r = await mrun.enqueue({ kind: 'restore', mode: b.mode, created_by: current_user(req),
        params: { ids: b.ids, opts: { mode: b.mode, confirm: b.confirm, keep_fields: b.keep_fields || null, ack_post_merge: !!b.ack_post_merge, attach_dossier: b.attach_dossier !== false, stamp_merged: b.stamp_merged !== false, created_by: current_user(req) } } });
      analytics.log({ event_name: 'restore_run', actor: req.user, role: req.role, panel: 'restore', is_test: mtest(req), mode: b.mode, outcome: 'queued' });
      res.json({ ok: true, queued: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Secondary queue — sets routed to recreate-from-backup (their losers are gone from the Recycle
  // Bin). list shows the queue + reasons; recreate is the user-initiated rebuild (typed RECREATE).
  app.get('/api/salesforce-merge/merge/recreate', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await mrestore.list_recreatable() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/salesforce-merge/merge/recreate', gate, async function (req, res) {
    try {
      const b = req.body || {};
      const r = await mrun.enqueue({ kind: 'recreate', mode: b.mode, created_by: current_user(req),
        params: { ids: b.ids, opts: { mode: b.mode, confirm: b.confirm, keep_fields: b.keep_fields || null, attach_dossier: b.attach_dossier !== false, stamp_merged: b.stamp_merged !== false, created_by: current_user(req) } } });
      analytics.log({ event_name: 'recreate_run', actor: req.user, role: req.role, panel: 'restore', is_test: mtest(req), mode: b.mode, outcome: 'queued' });
      res.json({ ok: true, queued: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Read-only browse of the Recycle Bin (recently soft-deleted Accounts) for the loaded environment.
  app.get('/api/salesforce-merge/merge/recycle-bin', gate, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      // Query the Recycle Bin as the WRITE user — the identity that actually deletes records during a
      // merge — so the panel shows the tool's own deletions even when the read user differs and isn't an
      // admin. (queryAll is still scoped to that user's visibility, i.e. their recycle bin + View All.)
      const r = await sfread.list_recycle_bin({ is_test, limit: req.query.limit, connect: sfwrite.default_write_connect });
      res.json({ ok: true, environment: ds ? ds.environment : null, connected_as: 'write_user', rows: r.rows, error: r.error });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Whether the optional "stamp survivor as merged" custom fields exist (admin creates them manually).
  app.get('/api/salesforce-merge/merge/stamp-fields', gate, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      const conn = await sfwrite.default_write_connect(is_test);
      res.json({ ok: true, fields: sfwrite.STAMP_FIELDS, ...(await sfwrite.stamp_fields_status(conn)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Pre-merge snapshot browse (DB read) + CSV/Excel export. Read-only.
  app.get('/api/salesforce-merge/merge/snapshot', gate, async function (req, res) {
    try { res.json({ ok: true, rows: await msnap.list_recent(req.query.limit) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/snapshot/export', gate, async function (req, res) {
    try {
      let rows = await msnap.list_recent(req.query.limit || 5000);
      if (req.query.role) rows = rows.filter((r) => r.role === req.query.role);
      await write_rows(req, res, rows, 'premerge_snapshot_' + new Date().toISOString().slice(0, 10), 'snapshot');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Read-only probe: can the connected Salesforce user actually merge (update + delete on Account)?
  // is_test follows the currently loaded dataset's environment so it checks the right org.
  // ---- SF API usage (Phase 1): live daily API-request headroom from the SF Limits resource. Env-aware
  // (follows the loaded dataset's org), read-only, one lightweight call. Lives in the merge rail's Help section (merge panel gate).
  app.get('/api/salesforce-merge/sf-api/limits', gate, async function (req, res) {
    try {
      // env param picks the org explicitly (the Sandbox / Production tabs); with no param it follows
      // the loaded dataset. is_test=true -> Sandbox creds, false -> Production creds (default_connect).
      const envParam = String((req.query && req.query.env) || '').toLowerCase();
      let is_test;
      if (envParam === 'production' || envParam === 'prod') is_test = false;
      else if (envParam === 'sandbox' || envParam === 'test') is_test = true;
      else { const ds = await dashboard.dataset_info().catch(() => null); is_test = !ds || ds.environment !== 'Production'; }
      const lim = await sfread.get_api_limits({ is_test });
      const env = is_test ? 'Sandbox' : 'Production';
      const t = require('./store/timestamps').now_mtn_utc();
      // Record this live reading so the panel can show it later WITHOUT another SF call (op=probe).
      // Also capture async-Apex + Bulk so those limits build an over-time trend (merges spend Apex; the
      // Get-Duplicates full pull spends Bulk batches).
      const _apex = lim.other && lim.other.DailyAsyncApexExecutions;
      const _bulk = lim.other && lim.other.DailyBulkApiBatches;
      api_usage.record({ env: env, org_id: lim.org_id, op: 'probe', actor: req.user, used: lim.daily_api.used, max: lim.daily_api.max,
        apex_used: _apex && _apex.used, apex_max: _apex && _apex.max, bulk_used: _bulk && _bulk.used, bulk_max: _bulk && _bulk.max });
      const _shapeOther = (o) => (o && o.max != null) ? { used: o.used, max: o.max, remaining: o.remaining, pct_used: o.max > 0 ? Math.round(1000 * o.used / o.max) / 10 : null } : null;
      res.json({ ok: true, environment: env, at: t.utc, at_mtn: t.mtn, ...lim, daily_apex: _shapeOther(_apex), daily_bulk: _shapeOther(_bulk) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // SF API usage — CACHED (no live SF call): the latest captured snapshot + intraday trend + per-op
  // attribution, read from salesforce_merge_api_usage. This is what the panel loads on open; a live
  // reading only happens when the user hits Refresh (the /sf-api/limits route above).
  app.get('/api/salesforce-merge/sf-api/usage', gate, async function (req, res) {
    try {
      const pool = await require('../../store/db').get_pool();
      const days = Number(req.query.days) || 1;
      const ep = String((req.query && req.query.env) || '').toLowerCase();
      const env = (ep === 'production' || ep === 'prod') ? 'Production' : (ep === 'sandbox' || ep === 'test') ? 'Sandbox' : null;
      const _tsnow = require('./store/timestamps').now_mtn_utc();
      const mtnToday = String(_tsnow.mtn).slice(0, 10);
      const [lat, points, by_op, runs, approved] = await Promise.all([
        api_usage.latest(pool, env),
        api_usage.list_recent(pool, { mtn_date: mtnToday, env: env }),
        api_usage.summary_by_op(pool, { days: days, env: env }),
        api_usage.recent_runs(pool, { days: 7, env: env }),
        mqueue.list(undefined, 'approved'),
      ]);
      const shape = (used, max) => {
        const u = used == null ? null : Number(used); const m = max == null ? null : Number(max);
        const has = u != null && m != null;
        return { used: u, max: m, remaining: has ? Math.max(0, m - u) : null, pct_used: (has && m > 0) ? Math.round(1000 * u / m) / 10 : null };
      };
      const latest = lat ? { environment: lat.env, org_id: lat.org_id, at: lat.created_at_utc, at_mtn: lat.created_at_mtn, op: lat.op, daily_api: shape(lat.api_used, lat.api_max), daily_apex: shape(lat.apex_used, lat.apex_max), daily_bulk: shape(lat.bulk_used, lat.bulk_max) } : null;
      // Pre-flight: estimate the DailyApiRequests cost of running the approved queue vs the remaining
      // budget (from the last captured reading). Read-only, no SF call.
      const est = api_estimate.estimate_run_calls(approved, {});
      const da = latest && latest.daily_api ? latest.daily_api : null;
      const remaining = da ? da.remaining : null;
      const dapex = latest && latest.daily_apex ? latest.daily_apex : null;
      const apexRemaining = dapex ? dapex.remaining : null;
      const preflight = {
        approved_sets: est.sets,
        estimate: est.total,
        merge_calls: est.merge_calls,
        overhead_calls: est.overhead_calls,
        remaining: remaining,
        max: da ? da.max : null,
        would_exceed: (remaining != null) ? est.total > remaining : null,
        pct_after: (da && da.max && da.used != null) ? Math.round(1000 * (da.used + est.total) / da.max) / 10 : null,
        apex_estimate: est.apex_total,
        apex_remaining: apexRemaining,
        apex_max: dapex ? dapex.max : null,
        apex_would_exceed: (apexRemaining != null) ? est.apex_total > apexRemaining : null,
        apex_pct_after: (dapex && dapex.max && dapex.used != null) ? Math.round(1000 * (dapex.used + est.apex_total) / dapex.max) / 10 : null,
        reading_at: latest ? latest.at_mtn : null,
      };
      res.json({ ok: true, env: env, days: days, mtn_today: mtnToday, latest: latest, points: points, by_op: by_op, runs: runs, preflight: preflight });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge/whoami', gate, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      res.json({ ok: true, environment: ds ? ds.environment : null, ...(await sfread.get_user_capabilities({ is_test })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.delete('/api/salesforce-merge/merge-queue/:id', gate, async function (req, res) {
    try {
      const r = await mqueue.remove(req.params.id);
      // Clean up the set's stage-time drift baseline too, so removed items leave no orphan rows.
      try { await stagebase.remove(req.params.id); } catch (e) { /* non-fatal */ }
      analytics.log({ event_name: 'queue_remove', actor: req.user, role: req.role, panel: 'select-merges', is_test: mtest(req), set_count: 1, outcome: 'ok' });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/salesforce-merge/merge-id', gate, async function (req, res) {
    try {
      const opts = { ...page_opts(req), filters: { bucket: req.query.bucket, foundation_state: req.query.foundation_state } };
      const [list, summary] = await Promise.all([reviews.list_merge_id(opts), reviews.merge_id_summary()]);
      res.json({ ok: true, ...list, summary });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge-id/facets', gate, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('merge-id') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/merge-id/export', gate, async function (req, res) {
    try { await send_export(req, res, 'merge-id', { ...page_opts(req), filters: { bucket: req.query.bucket, foundation_state: req.query.foundation_state } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/salesforce-merge/accounts', gate, async function (req, res) {
    try {
      const opts = { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, in_cluster_state: req.query.in_cluster_state } };
      res.json({ ok: true, ...(await reviews.list_accounts(opts)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/accounts/facets', gate, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('accounts') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/salesforce-merge/accounts/export', gate, async function (req, res) {
    try { await send_export(req, res, 'accounts', { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, in_cluster_state: req.query.in_cluster_state } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { mount };

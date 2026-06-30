'use strict';
// JSON API for the merge tool (Phase 0/1 — read-only).
//   GET  /api/status     public health check
//   POST /api/login      { username, password } -> sets signed-cookie session
//   POST /api/logout     clears the session
//   GET  /api/me         current user (401 if not signed in)
//   GET  /api/dashboard  auth-gated; read-only counts from the existing duplicate tables
//   GET  /api/dataset    auth-gated; "data as of" — latest finder run from the run logbook
//   GET  /api/<view>           auth-gated; paged/searchable/sortable rows
//   GET  /api/<view>/facets    auth-gated; distinct values for header dropdown filters
//   GET  /api/<view>/export    auth-gated; CSV/Excel of the current filtered/sorted view
const session = require('../auth/session');
const store = require('../auth/auth_store');
const { require_auth, require_admin } = require('../auth/require_auth');
const dashboard = require('../store/duplicates_read');
const reviews = require('../store/reviews_read');
const refresh = require('../store/refresh_runner');
const cluster = require('../store/cluster_detail');
const mqueue = require('../store/merge_queue');
const mexec = require('../store/merge_execute');
const mhist = require('../store/merge_history');
const mrun = require('../store/merge_run');
const mctl = require('../store/merge_control');
const mrestore = require('../store/merge_restore');
const msnap = require('../store/merge_snapshot');
const sfread = require('../store/salesforce_read');
const sfwrite = require('../store/salesforce_write');

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

module.exports = function mount(app) {
  app.get('/api/status', function (req, res) {
    res.json({ ok: true, app: 'salesforce_merge', login_configured: store.login_configured(), time: new Date().toISOString() });
  });

  app.post('/api/login', function (req, res) {
    const body = req.body || {};
    const v = store.valid_user(body.username, body.password);
    if (!v) return res.status(401).json({ ok: false, error: 'invalid credentials' });
    const token = session.sign({ user: v.user, role: v.role, ts: Date.now() }, store.session_secret());
    res.setHeader('Set-Cookie', session.COOKIE + '=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000));
    res.json({ ok: true, user: v.user, role: v.role });
  });

  app.post('/api/logout', function (req, res) {
    res.setHeader('Set-Cookie', session.COOKIE + '=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', function (req, res) {
    const cookies = session.parse_cookies(req.headers.cookie);
    const p = session.verify(cookies[session.COOKIE], store.session_secret());
    if (!p) return res.status(401).json({ ok: false });
    res.json({ ok: true, user: p.user, role: p.role || 'user' });
  });

  app.get('/api/dashboard', require_auth, async function (req, res) {
    try {
      res.json({ ok: true, data: await dashboard.dashboard_counts() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/dataset', require_auth, async function (req, res) {
    try { res.json({ ok: true, data: await dashboard.dataset_info() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/tuning', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await dashboard.sweep_profiles()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/tuning/export', require_auth, async function (req, res) {
    try { await write_rows(req, res, await dashboard.sweep_export_rows(), 'tuning_' + new Date().toISOString().slice(0, 10), 'tuning'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/runs', require_auth, async function (req, res) {
    try { res.json({ ok: true, runs: await dashboard.recent_runs(req.query.limit) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- R1: data-refresh runner (spawns the detection job; read-only against Salesforce) ----
  app.post('/api/refresh/start', require_admin, function (req, res) {
    const b = req.body || {};
    const r = refresh.start({ env: b.env, scope: b.scope, job: b.job });
    res.status(r.ok ? 202 : 409).json(r);
  });
  app.get('/api/refresh/status', require_auth, function (req, res) {
    res.json({ ok: true, ...refresh.status() });
  });
  app.post('/api/refresh/cancel', require_admin, function (req, res) {
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
  const current_user = (req) => {
    const cookies = session.parse_cookies(req.headers.cookie);
    const p = session.verify(cookies[session.COOKIE], store.session_secret());
    return p ? p.user : null;
  };
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

  app.get('/api/duplicates', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await reviews.list_duplicates({ ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, foundation_state: req.query.foundation_state } })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/duplicates/facets', require_auth, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('duplicates') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/duplicates/export', require_auth, async function (req, res) {
    try { await send_export(req, res, 'duplicates', { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state, foundation_state: req.query.foundation_state } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Members of one consolidated cluster (account-level detail for the Duplicates "view group" popup).
  app.get('/api/cluster', require_auth, async function (req, res) {
    try { res.json({ ok: true, data: await reviews.cluster_accounts(req.query.key) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/cluster/export', require_auth, async function (req, res) {
    try {
      const { accounts } = await reviews.cluster_accounts(req.query.key);
      const safe = String(req.query.key || 'group').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      await write_rows(req, res, accounts, 'cluster_' + safe + '_' + new Date().toISOString().slice(0, 10), 'cluster');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Phase 2 — read-only deep detail (live Salesforce, snapshot fallback) + dry-run merge preview.
  app.get('/api/cluster/detail', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_detail(req.query.key, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/cluster/preview', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_preview(req.query.key, req.query.survivor, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/cluster/children', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await cluster.cluster_children(req.query.key, { kind: req.query.source })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/cluster/detail/export', require_auth, async function (req, res) {
    try {
      const d = await cluster.cluster_detail(req.query.key, { kind: req.query.source });
      const safe = String(req.query.key || 'cluster').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      await write_rows(req, res, d.accounts || [], 'accounts_' + safe + '_' + new Date().toISOString().slice(0, 10), 'accounts');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ---- Merge Admin sources + queue ----
  app.get('/api/merge-groups', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await reviews.list_merge_groups({ ...page_opts(req), bucket: req.query.bucket, foundation_state: req.query.foundation_state })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-queue', require_auth, async function (req, res) {
    try { res.json({ ok: true, rows: await mqueue.list(undefined, req.query.status) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge-queue/approve', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await mqueue.set_status((req.body || {}).ids, 'approved')) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-queue/export', require_auth, async function (req, res) {
    try { await write_rows(req, res, await mqueue.list(undefined, req.query.status || null), 'merge_queue_' + new Date().toISOString().slice(0, 10), 'merge_queue'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge-queue', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      const ds0 = await dashboard.dataset_info().catch(() => null);
      const org_id = b.org_id || await resolve_org_id(!ds0 || ds0.environment !== 'Production');
      const r = await mqueue.add({ created_by: current_user(req), source_type: b.source_type, source_key: b.source_key, environment: ds0 ? ds0.environment : null, org_id,
        survivor_account: b.survivor_account, survivor_contact: b.survivor_contact, survivor_name: b.survivor_name, field_overrides: b.field_overrides, child_counts: b.child_counts,
        loser_accounts: b.loser_accounts, master_rule: b.master_rule, notes: b.notes });
      res.status(201).json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge-queue/bulk', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      if (b.source !== 'merge_id') return res.status(400).json({ ok: false, error: 'bulk add is supported for the merge-id source only' });
      const dsb = await dashboard.dataset_info().catch(() => null);
      const org_id = await resolve_org_id(!dsb || dsb.environment !== 'Production'); // resolved once, reused for the whole batch
      const groups = await reviews.resolve_merge_groups({ q: b.q, bucket: b.bucket, foundation_state: b.foundation_state, keys: b.keys });
      const CAP = 1000;
      const resolvable = groups.filter((g) => g.resolvable);
      const unresolved = groups.length - resolvable.length;
      const capped = resolvable.length > CAP;
      const entries = resolvable.slice(0, CAP).map((g) => ({ created_by: current_user(req), source_type: 'merge_id', source_key: g.merge_id, survivor_account: g.survivor, survivor_name: g.name, loser_accounts: g.losers, master_rule: g.rule || 'cascade', environment: dsb ? dsb.environment : null, org_id }));
      const r = await mqueue.add_many(entries);
      res.json({ ok: true, queued: r.queued, skipped: r.skipped, unresolved, total: groups.length, capped });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge/status', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await mexec.status()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge/process', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      res.json({ ok: true, ...(await mexec.process(b.ids, { mode: b.mode, confirm: b.confirm, dry_run: !!b.dry_run, stamp_merged: !!b.stamp_merged, created_by: current_user(req) })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge/history', require_auth, async function (req, res) {
    try { res.json({ ok: true, rows: await mhist.list({ limit: req.query.limit }) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge/history/export', require_auth, async function (req, res) {
    try { await write_rows(req, res, await mhist.list({ limit: req.query.limit || 5000 }), 'merge_history_' + new Date().toISOString().slice(0, 10), 'merge_history'); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Live progress for the latest run (UI polls this for the progress bar + timer + ETA).
  app.get('/api/merge/progress', require_auth, async function (req, res) {
    try { res.json({ ok: true, run: await mrun.latest(req.query.kind || null) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Cooperative stop: flag the latest RUNNING run so its loop halts at the next set boundary. The
  // in-flight set finishes cleanly (its snapshot/history/status are already written); remaining
  // approved sets are left untouched so they can be run again later.
  app.post('/api/merge/cancel', require_auth, async function (req, res) {
    try {
      const run = await mrun.latest((req.body && req.body.kind) || 'merge');
      if (!run || run.status !== 'running') return res.json({ ok: true, cancelled: false, reason: 'no running merge' });
      mctl.request(run.run_id);
      res.json({ ok: true, cancelled: true, run_id: run.run_id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Phase 4 restore — list completed merges with eligibility, and process a restore.
  app.get('/api/merge/restore', require_auth, async function (req, res) {
    try { res.json({ ok: true, rows: await mrestore.list_restorable() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge/restore', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      res.json({ ok: true, ...(await mrestore.restore(b.ids, { mode: b.mode, confirm: b.confirm, created_by: current_user(req) })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Secondary queue — sets routed to recreate-from-backup (their losers are gone from the Recycle
  // Bin). list shows the queue + reasons; recreate is the user-initiated rebuild (typed RECREATE).
  app.get('/api/merge/recreate', require_auth, async function (req, res) {
    try { res.json({ ok: true, rows: await mrestore.list_recreatable() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post('/api/merge/recreate', require_auth, async function (req, res) {
    try {
      const b = req.body || {};
      res.json({ ok: true, ...(await mrestore.recreate(b.ids, { mode: b.mode, confirm: b.confirm, created_by: current_user(req) })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Read-only browse of the Recycle Bin (recently soft-deleted Accounts) for the loaded environment.
  app.get('/api/merge/recycle-bin', require_auth, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      const r = await sfread.list_recycle_bin({ is_test, limit: req.query.limit });
      res.json({ ok: true, environment: ds ? ds.environment : null, rows: r.rows, error: r.error });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Whether the optional "stamp survivor as merged" custom fields exist (admin creates them manually).
  app.get('/api/merge/stamp-fields', require_auth, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      const conn = await sfwrite.default_write_connect(is_test);
      res.json({ ok: true, fields: sfwrite.STAMP_FIELDS, ...(await sfwrite.stamp_fields_status(conn)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Pre-merge snapshot browse (DB read) + CSV/Excel export. Read-only.
  app.get('/api/merge/snapshot', require_auth, async function (req, res) {
    try { res.json({ ok: true, rows: await msnap.list_recent(req.query.limit) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge/snapshot/export', require_auth, async function (req, res) {
    try {
      let rows = await msnap.list_recent(req.query.limit || 5000);
      if (req.query.role) rows = rows.filter((r) => r.role === req.query.role);
      await write_rows(req, res, rows, 'premerge_snapshot_' + new Date().toISOString().slice(0, 10), 'snapshot');
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Read-only probe: can the connected Salesforce user actually merge (update + delete on Account)?
  // is_test follows the currently loaded dataset's environment so it checks the right org.
  app.get('/api/merge/whoami', require_auth, async function (req, res) {
    try {
      const ds = await dashboard.dataset_info().catch(() => null);
      const is_test = !ds || ds.environment !== 'Production';
      res.json({ ok: true, environment: ds ? ds.environment : null, ...(await sfread.get_user_capabilities({ is_test })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.delete('/api/merge-queue/:id', require_auth, async function (req, res) {
    try { res.json({ ok: true, ...(await mqueue.remove(req.params.id)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/merge-id', require_auth, async function (req, res) {
    try {
      const opts = { ...page_opts(req), filters: { bucket: req.query.bucket, foundation_state: req.query.foundation_state } };
      const [list, summary] = await Promise.all([reviews.list_merge_id(opts), reviews.merge_id_summary()]);
      res.json({ ok: true, ...list, summary });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-id/facets', require_auth, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('merge-id') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-id/export', require_auth, async function (req, res) {
    try { await send_export(req, res, 'merge-id', { ...page_opts(req), filters: { bucket: req.query.bucket, foundation_state: req.query.foundation_state } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/accounts', require_auth, async function (req, res) {
    try {
      const opts = { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state } };
      res.json({ ok: true, ...(await reviews.list_accounts(opts)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/accounts/facets', require_auth, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('accounts') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/accounts/export', require_auth, async function (req, res) {
    try { await send_export(req, res, 'accounts', { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state } }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
};

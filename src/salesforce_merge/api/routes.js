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
    try { res.json({ ok: true, ...(await reviews.list_duplicates({ ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state } })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/duplicates/facets', require_auth, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('duplicates') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/duplicates/export', require_auth, async function (req, res) {
    try { await send_export(req, res, 'duplicates', { ...page_opts(req), filters: { merge_id_state: req.query.merge_id_state, member_number_state: req.query.member_number_state } }); }
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

  app.get('/api/merge-id', require_auth, async function (req, res) {
    try {
      const opts = { ...page_opts(req), filters: { bucket: req.query.bucket } };
      const [list, summary] = await Promise.all([reviews.list_merge_id(opts), reviews.merge_id_summary()]);
      res.json({ ok: true, ...list, summary });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-id/facets', require_auth, async function (req, res) {
    try { res.json({ ok: true, facets: await reviews.facets('merge-id') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.get('/api/merge-id/export', require_auth, async function (req, res) {
    try { await send_export(req, res, 'merge-id', { ...page_opts(req), filters: { bucket: req.query.bucket } }); }
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

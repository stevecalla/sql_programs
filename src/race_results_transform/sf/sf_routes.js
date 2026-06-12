'use strict';
// Salesforce HTTP endpoints for the race-results app. Mounted on the existing Express app and
// gated by the SAME auth as the metrics dashboard (mx_session). The SF connection is cached and
// reused. File bytes are streamed straight to the browser — never written to the server's disk
// (the /save fallback writes to the USER's folder on the server machine, for non-Chrome browsers).
const fs = require('fs');
const path = require('path');
const sf = require('./index');

function bool(v) { return v === '1' || v === 'true' || v === true; }

function send_sf_error(res, e) {
  if (e && e.code === 'SF_UNCONFIGURED') return res.status(503).json({ ok: false, error: e.message });
  console.error('[sf] error:', (e && e.message) || e);
  return res.status(502).json({ ok: false, error: (e && e.message) || 'Salesforce error' });
}

// Only ever remove spreadsheet files we manage — never nuke unrelated files in the user's folder.
function clear_spreadsheets(folder) {
  fs.readdirSync(folder).forEach(function (f) {
    if (/\.(xlsx|xls|csv)$/i.test(f)) { try { fs.unlinkSync(path.join(folder, f)); } catch (e) { /* ignore */ } }
  });
}

function mount_sf_routes(app, require_auth) {
  let cache = { conn: null, is_test: null };

  async function get_conn(is_test) {
    if (cache.conn && cache.is_test === is_test) return cache.conn;
    const cfg = sf.sf_config({ is_test: is_test });
    const check = sf.check_sf_config(cfg);
    if (!check.ok) {
      const e = new Error('Salesforce is not configured (missing: ' + check.missing.join(', ') + ')');
      e.code = 'SF_UNCONFIGURED';
      throw e;
    }
    const conn = await sf.make_connection(cfg);
    cache = { conn: conn, is_test: is_test };
    return conn;
  }

  // List Race Results Doc files for a Mountain-Time date filter (no bytes).
  app.get('/api/sf/files', require_auth, async function (req, res) {
    try {
      const filter = {
        mode: req.query.mode || 'today',
        field: req.query.field || 'LastModifiedDate',
        date: req.query.date, start: req.query.start, end: req.query.end,
        tz: 'America/Denver'
      };
      // Optional broadened search: comma-separated terms OR'd in one SOSL (else the precise default).
      const search_terms = req.query.search ? String(req.query.search).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : undefined;
      const conn = await get_conn(bool(req.query.is_test));
      const files = await sf.list_race_results_files(conn, { filter: filter, search_terms: search_terms });
      res.json({ ok: true, count: files.length, files: files });
    } catch (e) { send_sf_error(res, e); }
  });

  // Stream one ContentVersion's bytes to the browser. In-memory; nothing persisted server-side.
  app.get('/api/sf/file/:id', require_auth, async function (req, res) {
    try {
      const conn = await get_conn(bool(req.query.is_test));
      const buf = await sf.fetch_content_version_bytes(conn, req.params.id);
      const name = sf.safe_file_name(req.query.name || (req.params.id + '.bin'));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
      res.send(buf);
    } catch (e) { send_sf_error(res, e); }
  });

  // Fallback for browsers without the File System Access API: write selected files to a folder on
  // the SERVER machine (the user's own box in local use). strategy: add_new | replace | wipe_all.
  app.post('/api/sf/save', require_auth, async function (req, res) {
    try {
      const body = req.body || {};
      const folder = String(body.folder || '');
      if (!folder) return res.status(400).json({ ok: false, error: 'folder is required' });
      const strategy = body.strategy || 'add_new';
      const items = Array.isArray(body.items) ? body.items : [];
      fs.mkdirSync(folder, { recursive: true });
      if (strategy === 'wipe_all') clear_spreadsheets(folder);
      const conn = await get_conn(bool(body.is_test));
      const saved = [];
      for (const it of items) {
        const name = sf.safe_file_name(it.name || (it.id + '.bin'));
        const dest = path.join(folder, name);
        if (strategy === 'add_new' && fs.existsSync(dest)) { saved.push({ name: name, skipped: true }); continue; }
        const buf = await sf.fetch_content_version_bytes(conn, it.id);
        fs.writeFileSync(dest, buf);
        saved.push({ name: name, skipped: false });
      }
      res.json({ ok: true, saved: saved });
    } catch (e) { send_sf_error(res, e); }
  });

  // List the spreadsheet files currently in a server-side folder (task-list source for the fallback).
  app.get('/api/sf/folder', require_auth, function (req, res) {
    try {
      const folder = String(req.query.path || '');
      if (!folder || !fs.existsSync(folder)) return res.json({ ok: true, files: [] });
      const files = fs.readdirSync(folder).filter(function (f) { return /\.(xlsx|xls|csv)$/i.test(f); });
      res.json({ ok: true, files: files });
    } catch (e) { send_sf_error(res, e); }
  });

  // Read ONE spreadsheet file's CURRENT bytes back from a server-side folder — powers "Reload from
  // disk" in the non-Chrome fallback so the queue can pick up edits the user made in Excel. Name is
  // basename-only (no path traversal); only spreadsheet extensions are served.
  app.get('/api/sf/folder-file', require_auth, function (req, res) {
    try {
      const folder = String(req.query.folder || '');
      const name = path.basename(String(req.query.name || ''));
      if (!folder || !name) return res.status(400).json({ ok: false, error: 'folder and name are required' });
      if (!/\.(xlsx|xls|csv)$/i.test(name)) return res.status(400).json({ ok: false, error: 'unsupported file type' });
      const dest = path.join(folder, name);
      if (!fs.existsSync(dest)) return res.status(404).json({ ok: false, error: 'file not found' });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
      res.send(fs.readFileSync(dest));
    } catch (e) { send_sf_error(res, e); }
  });
}

module.exports = { mount_sf_routes };

'use strict';
// Slack HTTP endpoints for the race-results app. Mounted on the existing Express app and gated by the
// SAME auth as the metrics dashboard (mx_session). The bot token stays server-side; file bytes are
// streamed straight to the browser — never written to the server's disk.
const fs = require('fs');
const path = require('path');
const slack = require('./index');

function bool(v) { return v === '1' || v === 'true' || v === true; }

// Only ever remove spreadsheet files we manage — never touch unrelated files in the user's folder.
function clear_spreadsheets(folder) {
  fs.readdirSync(folder).forEach(function (f) {
    if (/\.(xlsx|xls|csv)$/i.test(f)) { try { fs.unlinkSync(path.join(folder, f)); } catch (e) { /* ignore */ } }
  });
}

function send_slack_error(res, e) {
  if (e && e.code === 'SLACK_UNCONFIGURED') return res.status(503).json({ ok: false, error: e.message });
  console.error('[slack] error:', (e && e.message) || e);
  return res.status(502).json({ ok: false, error: (e && e.message) || 'Slack error' });
}

function mount_slack_routes(app, require_auth) {
  let cache = { conn: null, is_test: null };

  function get_conn(is_test) {
    if (cache.conn && cache.is_test === is_test) return cache.conn;
    const cfg = slack.slack_config({ is_test: is_test });
    const check = slack.check_slack_config(cfg);
    if (!check.ok) {
      const e = new Error('Slack is not configured (missing: ' + check.missing.join(', ') + ')');
      e.code = 'SLACK_UNCONFIGURED';
      throw e;
    }
    const conn = slack.make_connection(cfg);
    cache = { conn: conn, is_test: is_test };
    return conn;
  }

  // The bot's channels (for the picker) + the bot identity (its @handle drives the "/invite @bot" copy chip).
  app.get('/api/slack/channels', require_auth, async function (req, res) {
    try {
      const conn = get_conn(bool(req.query.is_test));
      const identity = await slack.auth_test(conn);
      const channels = await slack.list_member_channels(conn);
      const cfg = slack.slack_config({ is_test: bool(req.query.is_test) });
      res.json({
        ok: true,
        bot: { handle: identity.user, user_id: identity.user_id, team: identity.team },
        default_channel: cfg.default_channel || '',
        channels: channels
      });
    } catch (e) { send_slack_error(res, e); }
  });

  // Spreadsheet attachments in a channel for a Mountain-Time date filter (no bytes). The channel must be
  // one the bot is a member of (so a user can't probe arbitrary channels).
  app.get('/api/slack/files', require_auth, async function (req, res) {
    try {
      const channel = String(req.query.channel || '');
      if (!channel) return res.status(400).json({ ok: false, error: 'a channel is required' });
      const conn = get_conn(bool(req.query.is_test));
      const cfg = slack.slack_config({ is_test: bool(req.query.is_test) });
      const member = await slack.list_member_channels(conn);
      if (!member.some(function (c) { return c.id === channel; })) {
        return res.status(400).json({ ok: false, error: 'The bot is not in that channel. In Slack, invite it (/invite) to the channel first, then refresh.' });
      }
      const filter = {
        mode: req.query.mode || 'all',
        date: req.query.date, start: req.query.start, end: req.query.end,
        tz: 'America/Denver'
      };
      const files = await slack.list_channel_files(conn, { channel: channel, filter: filter, exts: cfg.file_types });
      res.json({ ok: true, count: files.length, files: files });
    } catch (e) { send_slack_error(res, e); }
  });

  // Stream one Slack file's bytes to the browser. In-memory; nothing persisted server-side.
  app.get('/api/slack/file/:id', require_auth, async function (req, res) {
    try {
      const conn = get_conn(bool(req.query.is_test));
      const buf = await slack.fetch_file_bytes(conn, req.params.id);
      const name = slack.safe_file_name(req.query.name || (req.params.id + '.bin'));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
      res.send(buf);
    } catch (e) { send_slack_error(res, e); }
  });

  // Fallback for browsers without the File System Access API: write selected files to a folder on the
  // SERVER machine (the user's own box in local use). strategy: add_new | replace | wipe_all.
  app.post('/api/slack/save', require_auth, async function (req, res) {
    try {
      const body = req.body || {};
      const folder = String(body.folder || '');
      if (!folder) return res.status(400).json({ ok: false, error: 'folder is required' });
      const strategy = body.strategy || 'add_new';
      const items = Array.isArray(body.items) ? body.items : [];
      fs.mkdirSync(folder, { recursive: true });
      if (strategy === 'wipe_all') clear_spreadsheets(folder);
      const conn = get_conn(bool(body.is_test));
      const saved = [];
      for (const it of items) {
        const name = slack.safe_file_name(it.name || (it.id + '.bin'));
        const dest = path.join(folder, name);
        if (strategy === 'add_new' && fs.existsSync(dest)) { saved.push({ name: name, skipped: true }); continue; }
        const buf = await slack.fetch_file_bytes(conn, it.id);
        fs.writeFileSync(dest, buf);
        saved.push({ name: name, skipped: false });
      }
      res.json({ ok: true, saved: saved });
    } catch (e) { send_slack_error(res, e); }
  });
}

module.exports = { mount_slack_routes };

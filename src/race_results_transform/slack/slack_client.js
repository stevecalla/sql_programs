'use strict';
// Slack Web API access for race-results file intake. The connection is INJECTED (conn.call(method,
// params)) so this is unit-testable with a mock conn — no network. Mirrors sf_client:
//   files.list (channel + ts window) -> filter to spreadsheets -> MT date filter -> newest-first
//   -> enrich uploader (users.info). Channel picker comes from users.conversations (bot's channels).
const slack_dates = require('./slack_dates');
const { build_download_file_name } = require('./slack_naming');

const DEFAULT_EXTS = ['xls', 'xlsx', 'csv', 'pptx', 'ppt'];   // spreadsheets + PowerPoint (Slack intake is broader than SF/folder)
const MAX_PAGES = 50;          // files.list page guard
const PAGE_COUNT = 200;        // files per page
const CHAN_PAGE_LIMIT = 200;   // users.conversations page size

// Real transport: POST a Slack Web API method (form-encoded, Bearer auth) and return the JSON, throwing
// a clear error when ok=false. conn.call is what tests stub out.
async function slack_call(api_base, token, method, params) {
  const body = new URLSearchParams();
  const p = params || {};
  Object.keys(p).forEach(function (k) { if (p[k] != null) body.append(k, String(p[k])); });
  const response = await fetch(api_base + '/' + method, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: body
  });
  const json = await response.json().catch(function () { return { ok: false, error: 'non_json_response_http_' + response.status }; });
  if (!json.ok) {
    const err = new Error('Slack ' + method + ' failed: ' + (json.error || ('HTTP ' + response.status)));
    err.slack_error = json.error;
    throw err;
  }
  return json;
}

// Build an injectable connection from slack_config(). conn.call(method, params) is the only seam.
function make_connection(cfg) {
  const token = cfg.token;
  const api_base = cfg.api_base || 'https://slack.com/api';
  return {
    token: token,
    api_base: api_base,
    call: function (method, params) { return slack_call(api_base, token, method, params); }
  };
}

// Confirm the token + return the bot identity (auth.test). Used by the picker (for the @handle in the
// "/invite @bot" copy chip) and the CLI probe.
async function auth_test(conn) {
  const a = await conn.call('auth.test', {});
  return { user: a.user, user_id: a.user_id, team: a.team, team_id: a.team_id, url: a.url };
}

// Channels the BOT is a member of (public + private), for the UI picker. Membership IS the config:
// invite the bot to a channel and it shows up here.
async function list_member_channels(conn, opts) {
  const o = opts || {};
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await conn.call('users.conversations', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: o.limit || CHAN_PAGE_LIMIT,
      cursor: cursor || undefined
    });
    (page.channels || []).forEach(function (c) {
      out.push({ id: c.id, name: c.name, is_private: !!c.is_private });
    });
    cursor = page.response_metadata && page.response_metadata.next_cursor;
    if (!cursor) break;
  }
  out.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
  return out;
}

// Basic info about one channel (id, name, is_private). Degrades to { id } if not visible.
async function channel_info(conn, channel) {
  try {
    const r = await conn.call('conversations.info', { channel: channel });
    const c = r.channel || {};
    return { id: c.id || channel, name: c.name || '', is_private: !!c.is_private };
  } catch (e) {
    return { id: channel, name: '', is_private: null };
  }
}

// Resolve uploader display names for a set of user ids (best-effort; a failed lookup just leaves it blank).
async function resolve_users(conn, user_ids) {
  const by_id = new Map();
  const ids = Array.from(new Set((user_ids || []).filter(Boolean)));
  for (const id of ids) {
    try {
      const r = await conn.call('users.info', { user: id });
      const u = (r && r.user) || {};
      const profile = u.profile || {};
      by_id.set(id, u.real_name || profile.display_name || u.name || '');
    } catch (e) { by_id.set(id, ''); }
  }
  return by_id;
}

// List spreadsheet attachments in a channel for a Mountain-Time date filter. Returns normalized records
// (newest first) shaped to reuse the shared #sfTable / Files queue (content_version_id = Slack file id).
// opts: { channel, filter, exts, tz, max_pages }.
async function list_channel_files(conn, opts) {
  const o = opts || {};
  const channel = o.channel;
  if (!channel) throw new Error('a channel id is required');
  const tz = (o.filter && o.filter.tz) || o.tz || slack_dates.DEFAULT_TZ;
  const exts = o.exts || DEFAULT_EXTS;
  const window = slack_dates.slack_ts_window(o.filter || { mode: 'all' });

  // Page through files.list for the channel + (padded) ts window.
  const raw = [];
  const max_pages = o.max_pages || MAX_PAGES;
  for (let page = 1; page <= max_pages; page++) {
    const r = await conn.call('files.list', {
      channel: channel,
      ts_from: window.ts_from,
      ts_to: window.ts_to,
      count: PAGE_COUNT,
      page: page
    });
    (r.files || []).forEach(function (f) { raw.push(f); });
    const paging = r.paging || {};
    if (!paging.pages || page >= paging.pages) break;
  }

  // ext filter + precise MT date filter + dedupe by file id + newest-first.
  const keep_date = slack_dates.make_date_filter(o.filter || { mode: 'all', tz: tz });
  const seen = new Set();
  const channel_meta = await channel_info(conn, channel);

  const records = raw
    .map(function (f) {
      const ext = file_ext(f);
      const created_ms = (Number(f.created) || 0) * 1000;
      return {
        _ext: ext,
        created_ms: created_ms,
        file_id: f.id,
        name: f.name || f.title || (f.id + '.' + ext),
        title: f.title || '',
        filetype: f.filetype || ext,
        size: f.size || 0,
        user: f.user || '',
        created_utc: created_ms ? new Date(created_ms).toISOString() : '',
        url_private_download: f.url_private_download || f.url_private || ''
      };
    })
    .filter(function (r) { return exts.indexOf(r._ext) >= 0; })
    .filter(keep_date)
    .sort(function (a, b) { return b.created_ms - a.created_ms; })
    .filter(function (r) { if (seen.has(r.file_id)) return false; seen.add(r.file_id); return true; });

  if (records.length === 0) return [];

  const uploader_by_id = await resolve_users(conn, records.map(function (r) { return r.user; }));

  return records.map(function (r) {
    const uploader_name = uploader_by_id.get(r.user) || '';
    const file_obj = { id: r.file_id, name: r.name, title: r.title, filetype: r._ext };
    return {
      // reuse the SF field name so the shared sort/search/select/download work unchanged
      content_version_id: r.file_id,
      file_id: r.file_id,
      name: r.name,
      title: r.title,
      file_extension: r._ext,
      filetype: r.filetype,
      size: r.size,
      created_utc: r.created_utc,
      created_ms: r.created_ms,
      created_mtn: slack_dates.datetime_in_time_zone(r.created_ms, tz),
      created_mtn_ymd: slack_dates.ymd_in_time_zone(r.created_ms, tz),
      uploader_id: r.user,
      uploader_name: uploader_name,
      owner_name: uploader_name,                 // alias: shared queue/download reuse owner_name
      channel_id: channel,
      channel_name: channel_meta.name || '',
      url_private_download: r.url_private_download,
      target_name: build_download_file_name(file_obj, channel_meta.name || channel, uploader_name)
    };
  });
}

function file_ext(f) {
  if (f && f.filetype) return String(f.filetype).toLowerCase();
  const n = (f && (f.name || f.title)) || '';
  return n.indexOf('.') >= 0 ? n.split('.').pop().toLowerCase() : '';
}

module.exports = {
  slack_call, make_connection, auth_test, list_member_channels, channel_info, list_channel_files,
  file_ext, DEFAULT_EXTS
};

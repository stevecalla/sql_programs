'use strict';
/**
 * events.js — lightweight usage analytics for the usat_apps platform (counts/enums only, never PII).
 *
 * Mirrors reporting/merge metrics/events (ensure / log / ingest_http) but stays self-contained and
 * best-effort: a logging failure must NEVER break a page. Rows are written to `usat_apps_events` in
 * the shared usat_sales_db and stamped app='usat_apps'.
 *
 * The base table keeps a `ts` timestamp + a `meta` JSON blob (legacy rows survive). The Metrics
 * dashboard also reads flat analytics columns (panel/view/visitor_id/tz/…); ensure() adds them
 * idempotently via ADD COLUMN IF NOT EXISTS so existing rows are untouched.
 */
const db = require('../store/db');

let _ensured = false;

// Flat analytics columns the /metrics dashboard aggregates.
const EXTRA_COLUMNS = [
  ['panel', 'VARCHAR(64) NULL'],
  ['view', 'VARCHAR(96) NULL'],
  ['filter_name', 'VARCHAR(96) NULL'],
  ['export_format', 'VARCHAR(16) NULL'],
  ['visitor_id', 'VARCHAR(64) NULL'],
  ['is_returning', 'TINYINT NULL'],
  ['client_tz', 'VARCHAR(64) NULL'],
  ['viewport', 'VARCHAR(8) NULL'],
  ['local_hour', 'TINYINT NULL'],
  ['local_dow', 'TINYINT NULL'],
  ['duration_ms', 'INT NULL'],
  ['row_count', 'INT NULL'],
  ['error_type', 'VARCHAR(64) NULL'],
];

async function ensure(pool) {
  if (_ensured) return;
  const p = pool || (await db.get_pool());
  await p.query(
    'CREATE TABLE IF NOT EXISTS usat_apps_events (' +
    '  id BIGINT AUTO_INCREMENT PRIMARY KEY,' +
    '  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    '  app VARCHAR(32) NOT NULL DEFAULT "usat_apps",' +
    '  event_name VARCHAR(64) NOT NULL,' +
    '  actor VARCHAR(128) NULL,' +
    '  role VARCHAR(32) NULL,' +
    '  panel VARCHAR(64) NULL,' +
    '  is_test TINYINT NOT NULL DEFAULT 0,' +
    '  meta JSON NULL,' +
    '  INDEX ix_ts (ts), INDEX ix_event (event_name)' +
    ')'
  );
  // Idempotently add the flat analytics columns to a pre-existing table. Older MySQL/MariaDB reject
  // "ADD COLUMN IF NOT EXISTS", so fall back to catching the duplicate-column error per column.
  for (const [name, ddl] of EXTRA_COLUMNS) {
    try {
      await p.query('ALTER TABLE usat_apps_events ADD COLUMN IF NOT EXISTS ' + name + ' ' + ddl);
    } catch (e) {
      try { await p.query('ALTER TABLE usat_apps_events ADD COLUMN ' + name + ' ' + ddl); }
      catch (e2) { /* already exists (dup column) — fine */ }
    }
  }
  try { await p.query('ALTER TABLE usat_apps_events ADD INDEX ix_visitor (visitor_id)'); }
  catch (e) { /* index already there — fine */ }
  _ensured = true;
}

// Fire-and-forget insert. Resolves even on failure (best-effort analytics).
async function log(evt) {
  try {
    const pool = await db.get_pool();
    await ensure(pool);
    const e = evt || {};
    const FLAT = ['event_name', 'actor', 'role', 'panel', 'is_test', 'view', 'filter_name',
      'export_format', 'visitor_id', 'is_returning', 'client_tz', 'viewport', 'local_hour',
      'local_dow', 'duration_ms', 'row_count', 'error_type'];
    const meta = {};
    Object.keys(e).forEach(function (k) {
      if (FLAT.indexOf(k) < 0 && e[k] !== undefined) meta[k] = e[k];
    });
    const num = function (v) { return (v === undefined || v === null || v === '') ? null : Number(v); };
    await pool.query(
      'INSERT INTO usat_apps_events (app, event_name, actor, role, panel, is_test, view, filter_name, ' +
      'export_format, visitor_id, is_returning, client_tz, viewport, local_hour, local_dow, duration_ms, ' +
      'row_count, error_type, meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['usat_apps', String(e.event_name || 'event'), e.actor || null, e.role || null, e.panel || null,
        e.is_test ? 1 : 0, e.view || null, e.filter_name || null, e.export_format || null,
        e.visitor_id || null, (e.is_returning == null ? null : (e.is_returning ? 1 : 0)),
        e.client_tz || null, e.viewport || null, num(e.local_hour), num(e.local_dow),
        num(e.duration_ms), num(e.row_count), e.error_type || null,
        Object.keys(meta).length ? JSON.stringify(meta) : null]
    );
  } catch (e) { /* best-effort — never throw */ }
}

// Ingest a browser event (POST /api/event). The server stamps the authoritative actor/role; the
// is_test flag comes ONLY from the metrics_test parameter (?metrics_test=1 or the body flag).
async function ingest_http(req, user, role) {
  const b = (req && req.body) || {};
  const is_test = String((req.query && req.query.metrics_test) || b.metrics_test || '') === '1' ? 1 : 0;
  return log({
    event_name: b.event_name || 'page_view',
    actor: user || null,
    role: role || null,
    panel: b.panel || null,
    is_test: is_test,
    view: b.view || null,
    filter_name: b.filter_name || null,
    export_format: b.export_format || null,
    visitor_id: b.visitor_id || null,
    is_returning: b.is_returning,
    client_tz: b.client_tz || null,
    viewport: b.viewport || null,
    local_hour: b.local_hour,
    local_dow: b.local_dow,
    duration_ms: b.duration_ms,
    row_count: b.row_count,
    error_type: b.error_type || null,
    // preserved in meta for anything not flattened
    page_path: b.page_path || null,
    session_id: b.session_id || null,
    theme: b.theme || null,
  });
}

module.exports = { ensure, log, ingest_http, EXTRA_COLUMNS };
// end events.js

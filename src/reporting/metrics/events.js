'use strict';
/**
 * events.js — lightweight usage analytics for the reporting app (counts/enums only, never PII).
 *
 * Mirrors the shape of the merge tool's metrics/events (ensure / log / ingest_http) but stays
 * self-contained and best-effort: a logging failure must NEVER break a page. Rows are written to
 * `reporting_events` in the shared usat_sales_db and stamped app='reporting', so a single metrics
 * view could union merge + reporting later (see plans_and_notes/METRICS_AND_ADMIN_OVERLAP.md).
 */
const db = require('../store/db');

let _ensured = false;

async function ensure(pool) {
  if (_ensured) return;
  const p = pool || (await db.get_pool());
  await p.query(
    'CREATE TABLE IF NOT EXISTS reporting_events (' +
    '  id BIGINT AUTO_INCREMENT PRIMARY KEY,' +
    '  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
    '  app VARCHAR(32) NOT NULL DEFAULT "reporting",' +
    '  event_name VARCHAR(64) NOT NULL,' +
    '  actor VARCHAR(128) NULL,' +
    '  role VARCHAR(32) NULL,' +
    '  panel VARCHAR(64) NULL,' +
    '  is_test TINYINT NOT NULL DEFAULT 0,' +
    '  meta JSON NULL,' +
    '  INDEX ix_ts (ts), INDEX ix_event (event_name)' +
    ')'
  );
  _ensured = true;
}

// Fire-and-forget insert. Resolves even on failure (best-effort analytics).
async function log(evt) {
  try {
    const pool = await db.get_pool();
    await ensure(pool);
    const e = evt || {};
    const meta = {};
    Object.keys(e).forEach(function (k) {
      if (['event_name', 'actor', 'role', 'panel', 'is_test'].indexOf(k) < 0 && e[k] !== undefined) meta[k] = e[k];
    });
    await pool.query(
      'INSERT INTO reporting_events (app, event_name, actor, role, panel, is_test, meta) VALUES (?,?,?,?,?,?,?)',
      ['reporting', String(e.event_name || 'event'), e.actor || null, e.role || null, e.panel || null, e.is_test ? 1 : 0,
        Object.keys(meta).length ? JSON.stringify(meta) : null]
    );
  } catch (e) { /* best-effort — never throw */ }
}

// Ingest a browser event (POST /api/event). The server stamps the authoritative actor/role.
async function ingest_http(req, user, role) {
  const b = (req && req.body) || {};
  return log({
    event_name: b.event_name || 'page_view',
    actor: user || null,
    role: role || null,
    panel: b.panel || null,
    is_test: String((req.query && req.query.metrics_test) || (b.metrics_test) || '') === '1' ? 1 : 0,
    view: b.view || null,
  });
}

module.exports = { ensure, log, ingest_http };

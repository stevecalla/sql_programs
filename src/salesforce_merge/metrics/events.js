'use strict';
// Server-side event logger for the Salesforce Merge tool. Fire-and-forget: it must NEVER throw or
// block a request (analytics can't break the app). Wraps utilities/analytics/event_ingest with the
// merge tool's MySQL pool (store/db) + metrics_config. Mirrors how the email-queue logs `ai_call`
// server-side and ingests browser events on /api/event.
const { insert_event } = require('../../../utilities/analytics/event_ingest');
const { ensure_table } = require('../../../utilities/analytics/ensure_table');
const { query_create_salesforce_merge_events_table } = require('../../queries/create_drop_db_table/query_create_salesforce_merge_events_table');
const db = require('../store/db');
const cfg = require('./metrics_config');

const ALLOW = new Set(cfg.COLUMNS);

let _ready = null;
async function ensure(pool) {
  if (_ready) return _ready;
  _ready = (async () => { await ensure_table(pool, await query_create_salesforce_merge_events_table(cfg.TABLE)); })();
  return _ready;
}

// is_test policy: the `metrics_test=1` parameter is the SINGLE driver of the is_test column — not
// role, not env, not session. The client attaches metrics_test=1 to all of its requests when the
// admin "flag as test" toggle is on; the server just honors the parameter.
function resolve_is_test(url_hint) { return url_hint ? 1 : 0; }

// Cached Sandbox/Production env for the env DIMENSION only (the dashboard's Sandbox-vs-Production
// split). is_test is decoupled from this — see resolve_is_test. Avoids a DB hit per event.
let _envCache = null; let _envAt = 0;
async function current_env() {
  const now = Date.now();
  if (_envCache && (now - _envAt) < 60000) return _envCache;
  let env = 'prod';
  try {
    const ds = await require('../store/duplicates_read').dataset_info();
    if (ds && ds.environment && ds.environment !== 'Production') env = 'sandbox';
  } catch (e) { /* default to prod */ }
  _envCache = env; _envAt = now;
  return _envCache;
}

// Low-level fire-and-forget insert. Stamps env (dimension) + is_test (from role) when not supplied.
// `event.url_test` is an internal hint (browser ?metrics_test=1); it is consumed, never stored.
async function log(event) {
  try {
    const e = Object.assign({ app: cfg.APP, source: 'web' }, event || {});
    if (e.env === undefined) e.env = await current_env();
    if (e.is_test === undefined) e.is_test = resolve_is_test(e.url_test);
    delete e.url_test;
    const pool = await db.get_pool();
    await ensure(pool);
    await insert_event(pool, cfg.TABLE, ALLOW, cfg.REPORTING_TZ, e);
  } catch (err) { /* analytics must never break the app */ }
}

// HTTP ingest for browser events (POST /api/event). Server stamps the authoritative fields (app,
// actor + role from the session, env, is_test) OVER whatever the client sent; the client supplies the
// rest (event_name, panel, view, filter_name, viewport, client_tz, ...) plus the ?metrics_test hint.
// Always resolves.
async function ingest_http(req, user, role) {
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const url_hint = (Number(body.metrics_test) === 1 || Number(body.is_test) === 1) ? 1 : 0;   // ?metrics_test=1
  const clean = Object.assign({}, body); delete clean.is_test; delete clean.metrics_test;
  try {
    await log(Object.assign(clean, { app: cfg.APP, actor: user || body.actor || null, role: role || null, is_test: resolve_is_test(url_hint), source: 'web' }));
  } catch (e) { /* never throws */ }
}

module.exports = { log, ingest_http, ensure, current_env, resolve_is_test, TABLE: cfg.TABLE, COLUMNS: cfg.COLUMNS };

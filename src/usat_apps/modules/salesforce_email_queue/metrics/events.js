'use strict';
// Server-side event logger for the Salesforce Email Queue module. Fire-and-forget: it must NEVER throw
// or block a request (analytics can't break the app). Wraps utilities/analytics/event_ingest with the
// module's MySQL pool (store/db) + metrics_config. Logs `ai_call` / `send_email` / `status_change`
// server-side and ingests browser events on POST /api/salesforce-email-queue/event.
const { insert_event } = require('../../../../../utilities/analytics/event_ingest');
const { ensure_table } = require('../../../../../utilities/analytics/ensure_table');
const { query_create_salesforce_email_queue_events_table } = require('../../../../queries/create_drop_db_table/query_create_salesforce_email_queue_events_table');
const db = require('../../../store/db');
const cfg = require('./metrics_config');

const ALLOW = new Set(cfg.COLUMNS);

let _ready = null;
async function ensure(pool) {
  if (_ready) return _ready;
  _ready = (async () => { await ensure_table(pool, await query_create_salesforce_email_queue_events_table(cfg.TABLE)); })();
  return _ready;
}

// is_test policy: the `metrics_test=1` parameter is the SINGLE driver of the is_test column — not role,
// not env, not session. The client attaches it when the admin "flag as test" toggle is on.
function resolve_is_test(url_hint) { return url_hint ? 1 : 0; }

// Cached Sandbox/Production env for the env DIMENSION only (dashboard's sandbox-vs-prod split). Read from
// the module config (services/knowledge/data_dir.read_config().sf_env). Decoupled from is_test.
let _envCache = null; let _envAt = 0;
async function current_env() {
  const now = Date.now();
  if (_envCache && (now - _envAt) < 60000) return _envCache;
  let env = 'prod';
  try { const cfgd = require('../../../services/knowledge/data_dir').read_config() || {}; if (cfgd.sf_env === 'sandbox') env = 'sandbox'; } catch (e) { /* default prod */ }
  _envCache = env; _envAt = now;
  return _envCache;
}

// Low-level fire-and-forget insert. Stamps env (dimension) + is_test when not supplied.
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

// HTTP ingest for browser events (POST /event). Server stamps authoritative fields (app, actor + role
// from the session, env, is_test) OVER the client body; the client supplies the rest + a metrics_test hint.
async function ingest_http(req, user, role) {
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const url_hint = (Number(body.metrics_test) === 1 || Number(body.is_test) === 1) ? 1 : 0;
  const clean = Object.assign({}, body); delete clean.is_test; delete clean.metrics_test;
  try { await log(Object.assign(clean, { app: cfg.APP, actor: user || body.actor || null, is_test: resolve_is_test(url_hint), source: 'web' })); }
  catch (e) { /* never throws */ }
}

module.exports = { log, ingest_http, ensure, current_env, resolve_is_test, TABLE: cfg.TABLE, COLUMNS: cfg.COLUMNS };

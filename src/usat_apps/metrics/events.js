"use strict";
// Server-side event logger for the usat_apps platform. Fire-and-forget: it must NEVER throw or block
// a request (analytics can't break the app). Uses the shared analytics core (utilities/analytics/*)
// + metrics_config — the SAME stack salesforce_merge uses — writing to usat_apps_events with the two
// canonical timestamps (created_at_utc + created_at_mtn) stamped in Node (TZ-safe, no CONVERT_TZ).
const { insert_event } = require("../../../utilities/analytics/event_ingest");
const { ensure_table } = require("../../../utilities/analytics/ensure_table");
const { query_create_usat_apps_events_table } = require("../../queries/create_drop_db_table/query_create_usat_apps_events_table");
const db = require("../store/db");
const cfg = require("./metrics_config");

const ALLOW = new Set(cfg.COLUMNS);

let _ready = null;
async function ensure(pool) {
  if (_ready) return _ready;
  _ready = (async () => {
    const p = pool || (await db.get_pool());
    await ensure_table(p, await query_create_usat_apps_events_table(cfg.TABLE));
  })();
  return _ready;
}

// usat_apps has no Salesforce sandbox/prod split; env reflects the run mode (nodemon dev vs pm2 prod).
function current_env() { return process.env.NODE_ENV === "development" ? "dev" : "prod"; }

// Low-level fire-and-forget insert. Stamps app/source/env/is_test defaults; created_at_* are added by
// insert_event. `event` is whitelisted to cfg.COLUMNS inside insert_event.
async function log(event) {
  try {
    const e = Object.assign({ app: cfg.APP, source: "web" }, event || {});
    if (e.env === undefined) e.env = current_env();
    if (e.is_test === undefined) e.is_test = 0;
    const pool = await db.get_pool();
    await ensure(pool);
    await insert_event(pool, cfg.TABLE, ALLOW, cfg.REPORTING_TZ, e);
  } catch (err) { /* analytics must never break the app */ }
}

// HTTP ingest for browser events (POST /api/event). The server stamps the authoritative fields
// (app, actor + role from the session, env, is_test) OVER whatever the client sent; the client
// supplies the rest (event_name, panel, view, session_id, viewport, …). Always resolves.
async function ingest_http(req, user, role) {
  const body = (req && req.body && typeof req.body === "object") ? req.body : {};
  const q = (req && req.query) || {};
  const is_test = (String(q.metrics_test || body.metrics_test || "") === "1" || Number(body.is_test) === 1) ? 1 : 0;
  const clean = Object.assign({}, body);
  delete clean.metrics_test; delete clean.is_test;
  try {
    await log(Object.assign(clean, { app: cfg.APP, actor: user || body.actor || null, role: role || null, is_test: is_test, source: "web", env: current_env() }));
  } catch (e) { /* never throws */ }
}

module.exports = { ensure, log, ingest_http, current_env, TABLE: cfg.TABLE, COLUMNS: cfg.COLUMNS };

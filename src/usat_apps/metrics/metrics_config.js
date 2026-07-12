"use strict";
// Per-app analytics config for the usat_apps platform — the only app-specific input the shared
// analytics core (utilities/analytics/*) needs. Reused by the server ingest, the metrics_report
// aggregator, and the dashboard. Modeled on src/salesforce_merge/metrics/metrics_config.js, but with
// a GENERIC column set: no merge-domain fields (set_count / mode / outcome / source_*). A module that
// needs domain data logs it into the `meta` JSON column, keeping the core columns app-agnostic.
const APP = "usat_apps";
const TABLE = "usat_apps_events";
const KEEP_YEARS = 2;                 // retention: current + prior calendar year
const REPORTING_TZ = "America/Denver";

// Whitelist of insertable columns (everything except id + the stamped created_at_*). Authoritative
// guard on the server; the browser client mirrors it. Adding analytics = add here + to the
// create-table DDL (query_create_usat_apps_events_table); ensure_columns migrates existing tables.
// NO member PII — actor (staff username), panel/view, counts, and a meta JSON blob only.
const COLUMNS = [
  // who / session
  "app", "event_name", "page_path", "session_id", "visitor_id", "is_returning", "actor", "role",
  // where in the app
  "panel", "view", "filter_name", "export_format",
  // counts + timing (generic)
  "row_count", "duration_ms", "error_type", "error_msg",
  // environment
  "event_at_local", "client_tz", "local_hour", "local_dow", "app_version", "engine",
  "viewport", "theme", "is_test", "env", "source",
  // per-module domain escape hatch (JSON) — keeps domain fields OUT of the generic core
  "meta",
];

// Canonical event_name values (documentation + a guard for tests). Grouped by purpose.
const EVENTS = {
  view: ["panel_view", "filter_run", "search_run", "report_export"],
  session: ["login", "logout", "access_change"],
  ui: ["map_style", "theme_change"],
  issues: ["not_found", "not_authorized", "error"],
};

module.exports = { APP, TABLE, KEEP_YEARS, REPORTING_TZ, COLUMNS, EVENTS };

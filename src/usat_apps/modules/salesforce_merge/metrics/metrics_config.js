'use strict';
// Per-app analytics config for the Salesforce Merge tool — the only app-specific inputs the generic
// analytics core (utilities/analytics/*) needs. Reused by the server (ingest + dashboard), the
// metrics_report aggregator, and the CLI. Mirrors src/salesforce_email_queue_proof_of_concept/
// metrics/metrics_config.js.
const APP = 'salesforce_merge';
const TABLE = 'salesforce_merge_events';
const KEEP_YEARS = 2;                 // retention: current + prior calendar year
const REPORTING_TZ = 'America/Denver';

// Whitelist of insertable columns (everything except id + the stamped created_at_*). Authoritative
// guard on the server; the browser client mirrors it. Adding analytics = add here + to the
// create-table DDL (query_create_salesforce_merge_events_table); ensure_columns migrates existing
// tables on startup. NO member PII — actor (staff username), panel, record-pointer keys + counts only.
const COLUMNS = [
  // who / session
  'app', 'event_name', 'page_path', 'session_id', 'visitor_id', 'is_returning', 'actor', 'role',
  // where in the app (panel = this tool's version of the email-queue's "queue" dimension)
  'panel', 'view', 'filter_name', 'export_format',
  // merge-tool domain context (record pointers + enums only)
  'source_type', 'source_key', 'mode', 'outcome',
  // counts + timing (generic; reused across build / queue / merge / restore)
  'set_count', 'account_count', 'child_count', 'row_count', 'duration_ms', 'error_type', 'error_msg',
  // environment
  'event_at_local', 'client_tz', 'local_hour', 'local_dow', 'app_version', 'engine',
  'viewport', 'theme', 'is_test', 'env', 'source',
];

// Canonical event_name values (documentation + a guard for tests). Grouped by process.
const EVENTS = {
  view: ['panel_view', 'filter_run', 'search_run', 'report_export'],
  session: ['login', 'logout', 'access_change'],
  build: ['data_build'],
  queue: ['queue_add', 'queue_bulk_add', 'queue_approve', 'queue_remove'],
  merge: ['merge_run'],
  restore: ['restore_run', 'recreate_run'],
  misc: ['error'],
};

module.exports = { APP, TABLE, KEEP_YEARS, REPORTING_TZ, COLUMNS, EVENTS };

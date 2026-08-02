'use strict';
// Per-module analytics config for the Salesforce Email Queue module (ported from the standalone POC's
// metrics/metrics_config.js). The only app-specific inputs the shared analytics core (utilities/analytics/*)
// needs — reused by the server (ingest + dashboard) and the metrics report. Table + columns match the DDL
// at src/queries/create_drop_db_table/query_create_salesforce_email_queue_events_table.js.
const APP = 'salesforce_email_queue';
const TABLE = 'salesforce_email_queue_events';
const KEEP_YEARS = 2;                 // retention: current + prior calendar year
const REPORTING_TZ = 'America/Denver';

// Whitelist of insertable columns (everything except id + the stamped created_at_*). Authoritative guard
// on the server; the browser client mirrors it. Adding analytics = add here + to the create-table DDL.
const COLUMNS = [
  // who / session
  'app', 'event_name', 'page_path', 'session_id', 'visitor_id', 'is_returning', 'actor',
  // queue + case context (Salesforce record pointers + counts only — never message content / member PII)
  'queue', 'queue_id', 'case_id', 'case_number', 'thread_msg_count', 'has_attachment',
  // AI flow
  'ai_action', 'ai_provider', 'ai_model', 'ai_verdict', 'ai_intent', 'ai_latency_ms',
  'ai_prompt_chars', 'ai_reply_chars', 'ai_prompt_tokens', 'ai_completion_tokens', 'ai_cost_usd',
  'ai_used_images', 'ai_grounded', 'ai_correction_count', 'ai_ok', 'ai_error',
  // Salesforce-write outcome (send reply / status change — mocked in this build)
  'sf_action', 'sf_ok', 'sf_error', 'status_to',
  // other interactions
  'attachment_type', 'correction_scope', 'context_action', 'soql_chars',
  // environment
  'event_at_local', 'client_tz', 'local_hour', 'local_dow', 'app_version', 'engine',
  'viewport', 'theme', 'error_type', 'is_demo', 'is_test', 'env', 'source'
];

module.exports = { APP, TABLE, KEEP_YEARS, REPORTING_TZ, COLUMNS };

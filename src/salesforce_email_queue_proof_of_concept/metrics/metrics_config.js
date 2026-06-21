'use strict';
// Per-app analytics config for the Salesforce Email Queue Assistant POC — the only app-specific
// inputs the generic analytics core (utilities/analytics/*) needs. Reused by the server (ingest +
// dashboard) and the CLI (stats / purge-test). Mirrors src/race_results_transform/metrics/metrics_config.js.
const APP = 'salesforce_email_queue';
const TABLE = 'salesforce_email_queue_events';
const KEEP_YEARS = 2;                 // retention: current + prior calendar year
const REPORTING_TZ = 'America/Denver';

// Whitelist of insertable columns (everything except id + the stamped created_at_*). This is the
// authoritative guard on the server; the browser client mirrors it. Adding analytics = add here +
// to the create-table DDL (ensure_columns migrates already-created tables on startup).
const COLUMNS = [
  // who / session
  'app', 'event_name', 'page_path', 'session_id', 'visitor_id', 'is_returning', 'actor',
  // queue + case context. case_id/case_number identify the email being worked so all activity after a
  // thread is opened can be attributed to that case (per-case funnel). Case id/number are Salesforce
  // record pointers (not member name/body); no message content is ever stored.
  'queue', 'queue_id', 'case_id', 'case_number', 'thread_msg_count', 'has_attachment',
  // AI flow
  'ai_action', 'ai_provider', 'ai_model', 'ai_verdict', 'ai_intent', 'ai_latency_ms',
  'ai_prompt_chars', 'ai_reply_chars', 'ai_prompt_tokens', 'ai_completion_tokens', 'ai_cost_usd',
  'ai_used_images', 'ai_grounded', 'ai_correction_count', 'ai_ok', 'ai_error',
  // Salesforce-write outcome (send reply / status change). Lets us see attempts + whether SF accepted
  // them or errored, even while these are mocked/disabled. No member content.
  'sf_action', 'sf_ok', 'sf_error', 'status_to',
  // other interactions
  'attachment_type', 'correction_scope', 'context_action', 'soql_chars',
  // environment
  'event_at_local', 'client_tz', 'local_hour', 'local_dow', 'app_version', 'engine',
  'viewport', 'theme', 'error_type', 'is_demo', 'is_test', 'source'
];

module.exports = { APP, TABLE, KEEP_YEARS, REPORTING_TZ, COLUMNS };

'use strict';
// Per-app analytics config for race_results_transform — the only app-specific
// inputs the generic core (utilities/analytics/*) needs. Reused by the server
// (ingest + dashboard + digest) and the CLI (stats/size/cleanup).
const APP = 'race_results_transform';
const TABLE = 'race_results_transform_events';
const KEEP_YEARS = 2;                 // retention: current + prior calendar year
const REPORTING_TZ = 'America/Denver';

// Whitelist of insertable columns (everything except id + the stamped created_at_*).
// This is the authoritative guard on the server; the browser client mirrors it.
const COLUMNS = [
  'app', 'event_name', 'page_path', 'session_id', 'visitor_id', 'is_returning', 'upload_id',
  'file_name', 'file_name_hash', 'file_type', 'sheet_count', 'row_count', 'col_count',
  'size_bytes', 'cols_matched', 'cols_unmatched', 'scorecard_band', 'scorecard_pct',
  'flag_count', 'target_key', 'download_mode', 'file_out_count', 'selected_count',
  'split_basis', 'event_at_local', 'client_tz', 'local_hour', 'local_dow',
  'app_version', 'engine', 'viewport', 'theme', 'error_type'
];

module.exports = { APP, TABLE, KEEP_YEARS, REPORTING_TZ, COLUMNS };

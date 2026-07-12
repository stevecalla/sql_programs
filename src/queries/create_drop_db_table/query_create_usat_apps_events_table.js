// query_create_usat_apps_events_table.js
// Append-only usage-analytics events for the usat_apps platform (server 8022).
// CREATE TABLE IF NOT EXISTS (analytics is append-only — never drop/recreate in code).
//
// The GENERIC platform events table: one row per tracked interaction across every module. Mirrors
// query_create_salesforce_merge_events_table.js but WITHOUT the merge-domain columns — a module that
// needs domain fields logs them into the `meta` JSON column instead, so the core stays app-agnostic.
// No member PII: staff username (actor), panel/view, counts only. The two canonical created_at_*
// timestamps are the LAST data columns (usat_apps convention).

const identity_fields = `
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- WHO / SESSION
  app VARCHAR(40),
  event_name VARCHAR(40),
  page_path VARCHAR(255),        -- route the event came from (location.pathname)
  session_id CHAR(36),           -- one page-load lifetime (new tab / refresh = new session)
  visitor_id CHAR(36),           -- anonymous per-browser id
  is_returning TINYINT(1),
  actor VARCHAR(80),             -- logged-in STAFF username (internal operator; not a member)
  role VARCHAR(12),              -- 'admin' | 'user'
`;

const where_fields = `
  -- WHERE IN THE APP
  panel VARCHAR(40),             -- participation-maps | metrics | ops | admin | merge | ...
  view VARCHAR(60),              -- table/report on exports/filters; map style on map_style events
  filter_name VARCHAR(60),       -- which filter/tab was run
  export_format VARCHAR(8),      -- csv | xlsx (on report_export)
`;

const count_fields = `
  -- COUNTS + TIMING (generic; reused across modules)
  row_count INT,                 -- # rows produced / scanned
  duration_ms INT,               -- operation duration
  error_type VARCHAR(40),        -- error category (no content)
  error_msg VARCHAR(200),        -- short error message (no member content)
`;

const env_fields = `
  -- TIME-OF-DAY (user-local) + ENVIRONMENT
  event_at_local DATETIME,
  client_tz VARCHAR(40),
  local_hour TINYINT,
  local_dow TINYINT,
  app_version VARCHAR(20),
  engine VARCHAR(12),
  viewport VARCHAR(8),
  theme VARCHAR(8),
  is_test TINYINT(1),            -- 1 = deliberate test run (?metrics_test=1); purgeable
  env VARCHAR(10),               -- 'prod' | 'dev' (stamped server-side)
  source VARCHAR(16),            -- 'web' | 'cli'
`;

const domain_fields = `
  -- PER-MODULE DOMAIN ESCAPE HATCH (JSON) — domain fields live here, not as core columns
  meta JSON,
`;

const date_fields = `
  -- CREATED AT DATES — LAST columns (UTC instant + reporting-tz wall clock, stamped in Node)
  created_at_utc DATETIME,
  created_at_mtn DATETIME,
`;

const index_fields = `
  -- INDEXES
  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_event_name (event_name),
  INDEX idx_visitor_id (visitor_id),
  INDEX idx_session_id (session_id),
  INDEX idx_app_panel (app, panel)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${identity_fields}
      ${where_fields}
      ${count_fields}
      ${env_fields}
      ${domain_fields}
      ${date_fields}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_usat_apps_events_table: main,
};

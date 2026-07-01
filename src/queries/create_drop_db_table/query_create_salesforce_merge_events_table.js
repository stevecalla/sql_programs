// query_create_salesforce_merge_events_table.js
// Append-only usage-analytics events for the Salesforce Merge tool (server 8020).
// CREATE TABLE IF NOT EXISTS (analytics is append-only — never drop/recreate).
//
// Mirrors query_create_salesforce_email_queue_events_table.js. No member PII: we store the
// operator's staff username (actor), which panel/view they were on, and Salesforce record
// pointers (merge id / source key) + counts — NEVER member names, addresses, or field values.

const identity_fields = `
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- CREATED AT DATES (repo convention)
  created_at_utc DATETIME,
  created_at_mtn DATETIME,

  -- WHO / SESSION
  app VARCHAR(40),
  event_name VARCHAR(40),
  page_path VARCHAR(255),        -- which route the event came from (location.pathname[+search])
  session_id CHAR(36),
  visitor_id CHAR(36),           -- anonymous per-browser id
  is_returning TINYINT(1),
  actor VARCHAR(80),             -- logged-in STAFF username (internal operator; not a member)
  role VARCHAR(12),              -- 'admin' | 'user'
`;

const where_fields = `
  -- WHERE IN THE APP (the "panel" is this tool's version of the email-queue's "queue" dimension)
  panel VARCHAR(24),             -- dashboard | duplicates | merge-id | accounts | tuning | select-merges | merge-process | restore | admin | metrics
  view VARCHAR(40),              -- for exports/filters: which table/report (duplicates, merge-id, accounts, tuning, ...)
  filter_name VARCHAR(60),       -- which filter was run (bucket, foundation_state, merge_id_state, search, ...)
  export_format VARCHAR(8),      -- csv | xlsx (on report_export)
`;

const domain_fields = `
  -- MERGE-TOOL DOMAIN CONTEXT (record pointers + enums only — no member field values)
  source_type VARCHAR(24),       -- merge_id | duplicate | cluster (what a queued set came from)
  source_key VARCHAR(64),        -- Salesforce merge id / cluster key pointer (not member data)
  mode VARCHAR(12),              -- simulate | execute (merge / restore / recreate run mode)
  outcome VARCHAR(20),           -- done | failed | skipped | routed | eligible | not_eligible | ok
`;

const count_fields = `
  -- COUNTS + TIMING (generic; reused across build / queue / merge / restore events)
  set_count INT,                 -- # merge sets in a run (or # queued)
  account_count INT,             -- # accounts touched (losers + survivor, or snapshot rows)
  child_count INT,               -- # child records re-pointed
  row_count INT,                 -- # rows a data build produced / scanned
  duration_ms INT,               -- run / operation duration
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
  is_test TINYINT(1),            -- 1 = deliberate test run (Sandbox / ?metrics_test=1); purgeable via metrics:purge-test
  env VARCHAR(10),               -- Salesforce environment the app was pointed at: 'prod' | 'sandbox' (stamped server-side)
  source VARCHAR(16),            -- where activity originated: 'web' | 'cli'
`;

const index_fields = `
  -- INDEXES
  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_event_name (event_name),
  INDEX idx_visitor_id (visitor_id),
  INDEX idx_app (app),
  INDEX idx_panel (panel),
  INDEX idx_actor (actor)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${identity_fields}
      ${where_fields}
      ${domain_fields}
      ${count_fields}
      ${env_fields}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_salesforce_merge_events_table: main,
};

// query_create_salesforce_email_queue_events_table.js
// Append-only usage-analytics events for the Salesforce Email Queue Assistant POC (server 8019).
// CREATE TABLE IF NOT EXISTS (analytics is append-only — never drop/recreate).
//
// Mirrors query_create_race_results_transform_events_table.js. No member PII: we store the
// operator's staff username (actor) and queue name/id, but NEVER member names, email bodies,
// addresses, or Salesforce Case ids (a case id is a pointer to member data — omitted by design).

const identity_fields = `
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- CREATED AT DATES (repo convention)
  created_at_utc DATETIME,
  created_at_mtn DATETIME,

  -- WHO / SESSION
  app VARCHAR(40),
  event_name VARCHAR(40),
  page_path VARCHAR(255),        -- which page the event came from (location.pathname[+search])
  session_id CHAR(36),
  visitor_id CHAR(36),           -- anonymous per-browser id
  is_returning TINYINT(1),
  actor VARCHAR(80),             -- logged-in STAFF username (internal operator; not a member)
`;

const queue_fields = `
  -- QUEUE + CASE CONTEXT. case_id/case_number identify the email being worked, so all activity after a
  -- thread is opened is attributed to that case (per-case funnel). Salesforce record pointers only —
  -- NOT member name/email/body; no message content is ever stored.
  queue VARCHAR(120),            -- queue name (Group.Name) or developer name
  queue_id CHAR(18),             -- Salesforce Group (queue) id — not member data
  case_id CHAR(18),              -- Salesforce Case id of the opened email (current-case context)
  case_number VARCHAR(20),       -- human-friendly Case number (e.g. 00123456)
  thread_msg_count INT,          -- # messages in an opened thread
  has_attachment TINYINT(1),
`;

const ai_fields = `
  -- AI FLOW (the heart of this app's analytics)
  ai_action VARCHAR(16),         -- 'respond' | 'ask' | 'triage' | 'acknowledge'
  ai_provider VARCHAR(16),       -- 'chatgpt' | 'claude'
  ai_model VARCHAR(40),          -- resolved model string
  ai_verdict VARCHAR(16),        -- 'DRAFT' | 'NEED_INFO' | 'ANSWER_READY' | etc.
  ai_intent VARCHAR(40),         -- triage classification / detected intent
  ai_latency_ms INT,             -- round-trip time of the AI call
  ai_prompt_chars INT,           -- size of the assembled prompt (no content stored)
  ai_reply_chars INT,            -- size of the generated draft/answer (no content stored)
  ai_used_images TINYINT(1),     -- vision context attached?
  ai_grounded TINYINT(1),        -- knowledge/context injected?
  ai_correction_count INT,       -- operator corrections injected into grounding
  ai_ok TINYINT(1),              -- 1 = success, 0 = failed
  ai_error VARCHAR(60),          -- error category (no content)
`;

const sf_write_fields = `
  -- SALESFORCE-WRITE OUTCOME (send reply / status change). Records the ATTEMPT + whether SF accepted it
  -- or errored, even while these are mocked/disabled. No member content.
  sf_action VARCHAR(16),         -- 'send' | 'status_change'
  sf_ok TINYINT(1),              -- 1 = accepted by Salesforce, 0 = error / not enabled
  sf_error VARCHAR(120),         -- error category/message (no content)
  status_to VARCHAR(40),         -- the new Case status (on status_change)
`;

const interaction_fields = `
  -- OTHER INTERACTIONS
  attachment_type VARCHAR(16),   -- image | pdf | csv | xlsx | text (on attachment view)
  correction_scope VARCHAR(12),  -- me | queue | global (on correction added)
  context_action VARCHAR(16),    -- upload | exclude | include (on context change)
  soql_chars INT,                -- length of an executed read-only SOQL (no content)
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
  error_type VARCHAR(40),
  is_demo TINYINT(1),            -- 1 = event came from sample/demo data (not real activity)
  is_test TINYINT(1),            -- 1 = deliberate test run (browser opened with ?metrics_test=1); purgeable via metrics:purge-test
  source VARCHAR(16),            -- where activity originated: 'web' | 'cli' | 'demo'
`;

const index_fields = `
  -- INDEXES
  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_event_name (event_name),
  INDEX idx_visitor_id (visitor_id),
  INDEX idx_app (app),
  INDEX idx_queue (queue),
  INDEX idx_ai_provider (ai_provider)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${identity_fields}
      ${queue_fields}
      ${ai_fields}
      ${sf_write_fields}
      ${interaction_fields}
      ${env_fields}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_salesforce_email_queue_events_table: main,
};

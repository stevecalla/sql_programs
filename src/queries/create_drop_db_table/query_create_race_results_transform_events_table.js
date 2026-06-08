// query_create_race_results_transform_events_table.js
// Append-only usage-analytics events for the race_results_transform app.
// CREATE TABLE IF NOT EXISTS (analytics is append-only — never drop/recreate).

const identity_fields = `
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- CREATED AT DATES (repo convention)
  created_at_utc DATETIME,
  created_at_mtn DATETIME,

  -- WHO / SESSION (anonymous — no names, no IP)
  app VARCHAR(40),
  event_name VARCHAR(40),
  page_path VARCHAR(255),        -- which page the event came from (location.pathname[+search])
  session_id CHAR(36),
  visitor_id CHAR(36),
  is_returning TINYINT(1),
  upload_id CHAR(36),
`;

const file_fields = `
  -- FILE + CONVERSION
  file_name VARCHAR(255),
  file_name_hash CHAR(64),
  file_type VARCHAR(8),
  sheet_count INT,
  row_count INT,
  col_count INT,
  size_bytes INT,
  cols_matched INT,
  cols_unmatched INT,
  scorecard_band VARCHAR(16),
  scorecard_pct DECIMAL(5,2),
  flag_count INT,
  target_key VARCHAR(24),
`;

const download_fields = `
  -- DOWNLOAD KIND
  download_mode VARCHAR(12),
  file_out_count INT,
  selected_count INT,
  split_basis VARCHAR(12),
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
  is_demo TINYINT(1),            -- 1 = event came from the built-in "Try me" sample (fake data)
`;

const index_fields = `
  -- INDEXES
  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_event_name (event_name),
  INDEX idx_visitor_id (visitor_id),
  INDEX idx_app (app)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${identity_fields}
      ${file_fields}
      ${download_fields}
      ${env_fields}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_race_results_transform_events_table: main,
};

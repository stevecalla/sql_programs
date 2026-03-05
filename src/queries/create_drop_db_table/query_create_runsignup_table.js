// query_create_runsignup_race_event_extract_table.js
//
// Purpose:
// Create a MySQL table that matches the RunSignup streaming export structure
// (race + event fields in one “wide” table).
//
// Notes:
// - Designed to load the Excel/CSV extracts into MySQL for downstream querying.
// - Uses JSON for `event_registration_periods_json` so you can JSON_TABLE / JSON_EXTRACT later.
// - Event fields are nullable so race-only rows can exist if you ever enable them.
//
// Usage:
// const q = await query_create_runsignup_race_event_extract_table("runsignup_race_event_extract");
// await pool.query(q);

const traceability_fields = `
  -- TRACEABILITY
  page INT NULL,
  row_index BIGINT NULL,

  -- FIRST-OCCURRENCE FLAGS
  race_count_first TINYINT NULL,
  event_count_first TINYINT NULL,
`;

const race_fields = `
  -- RACE-LEVEL
  race_id BIGINT NULL,
  race_name VARCHAR(255) NULL,

  is_registration_open TINYINT NULL,
  is_private_race TINYINT NULL,
  is_draft_race TINYINT NULL,

  created VARCHAR(50) NULL,
  last_modified VARCHAR(50) NULL,

  description LONGTEXT NULL,
  timezone VARCHAR(64) NULL,
`;

const url_social_fields = `
  -- URLS / SOCIAL
  url VARCHAR(1024) NULL,
  external_race_url VARCHAR(1024) NULL,
  external_results_url VARCHAR(1024) NULL,
  fb_page_id VARCHAR(255) NULL,
  fb_event_id VARCHAR(255) NULL,
  logo_url VARCHAR(1024) NULL,
`;

const address_fields = `
  -- ADDRESS
  address_street VARCHAR(255) NULL,
  address_street2 VARCHAR(255) NULL,
  address_city VARCHAR(100) NULL,
  address_state VARCHAR(50) NULL,
  address_zipcode VARCHAR(25) NULL,
  address_country_code VARCHAR(10) NULL,
`;

const race_date_fields = `
  -- RACE DATES + HELPERS
  race_last_date VARCHAR(25) NULL,
  race_last_end_date VARCHAR(25) NULL,
  race_next_date VARCHAR(25) NULL,
  race_next_end_date VARCHAR(25) NULL,

  race_month INT NULL,
  race_year INT NULL,
`;

const event_fields = `
  -- EVENT-LEVEL
  event_id BIGINT NULL,
  race_event_days_id BIGINT NULL,

  event_name LONGTEXT NULL,
  event_details LONGTEXT NULL,

  event_type VARCHAR(100) NULL,
  distance VARCHAR(100) NULL,

  volunteer TINYINT NULL,
  require_dob TINYINT NULL,
  require_phone TINYINT NULL,

  participant_cap INT NULL,
`;

const event_date_fields = `
  -- EVENT DATES + HELPERS
  event_start_time VARCHAR(25) NULL,
  event_end_time VARCHAR(25) NULL,

  event_month INT NULL,
  event_year INT NULL,

  event_registration_opens VARCHAR(25) NULL,
  event_registration_opens_month INT NULL,
  event_registration_opens_year INT NULL,
`;

const registration_period_fields = `
  -- REGISTRATION PERIODS (RAW + BEST-EFFORT FIELDS)
  event_reg_opens VARCHAR(25) NULL,
  event_reg_closes VARCHAR(25) NULL,

  event_race_fee DECIMAL(10,2) NULL,
  event_processing_fee DECIMAL(10,2) NULL,

  event_registration_periods_json JSON NULL,
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME NULL,
  created_at_utc DATETIME NULL,
`;

const index_fields = `
  -- INDEXES
  INDEX idx_race_id (race_id),
  INDEX idx_event_id (event_id),
  INDEX idx_race_event_days_id (race_event_days_id),

  INDEX idx_address_state (address_state),
  INDEX idx_race_year (race_year),
  INDEX idx_event_year (event_year),

  INDEX idx_event_type (event_type),

  INDEX idx_race_next_date (race_next_date),
  INDEX idx_event_start_time (event_start_time),

  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_created_at_utc (created_at_utc)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

      ${traceability_fields}
      ${race_fields}
      ${url_social_fields}
      ${address_fields}
      ${race_date_fields}
      ${event_fields}
      ${event_date_fields}
      ${registration_period_fields}
      ${created_at_dates}

      PRIMARY KEY (id),
      ${index_fields}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  return query;
}

module.exports = {
  query_create_runsignup_race_event_extract_table: main,
};
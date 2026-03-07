// query_create_trifind_custom_search_extract_table.js
//
// Purpose:
// Create a MySQL table that matches the Trifind custom search enriched export
// structure (listing fields + enriched detail fields in one “wide” table).
//
// Notes:
// - Designed to load the CSV / Excel extracts into MySQL for downstream querying.
// - Keeps most scraped date/url/text fields as VARCHAR / LONGTEXT to preserve raw values.
// - Includes helper indexes for common filtering dimensions like year, month, state,
//   race type, sanctioned flag, and sanction number.
//
// Usage:
// const q = await query_create_trifind_custom_search_extract_table("trifind_custom_search_extract");
// await pool.query(q);

const listing_fields = `
  -- LISTING-LEVEL
  seq BIGINT NULL,

  title LONGTEXT NULL,
  url VARCHAR(1024) NULL,
  event_date DATE NULL,

  event_year INT NULL,
  event_month INT NULL,

  city VARCHAR(255) NULL,
  state VARCHAR(100) NULL,
  location VARCHAR(255) NULL,

  race_type VARCHAR(100) NULL,
  is_canceled VARCHAR(10) NULL,
  is_duplicate_listing VARCHAR(10) NULL,
`;

const detail_fields = `
  -- DETAIL-LEVEL
  register_now_url VARCHAR(1024) NULL,
  visit_race_website_url VARCHAR(1024) NULL,

  usat_link VARCHAR(1024) NULL,
  usat_link_text VARCHAR(255) NULL,
  usat_sanction_number VARCHAR(100) NULL,
  is_usat_sanctioned VARCHAR(10) NULL,

  previous_results_count INT NULL,
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME NULL,
  created_at_utc DATETIME NULL,
`;

const index_fields = `
  -- INDEXES
  INDEX idx_seq (seq),

  INDEX idx_event_year (event_year),
  INDEX idx_event_month (event_month),

  INDEX idx_city (city),
  INDEX idx_state (state),
  INDEX idx_race_type (race_type),

  INDEX idx_is_canceled (is_canceled),
  INDEX idx_is_duplicate_listing (is_duplicate_listing),
  INDEX idx_is_usat_sanctioned (is_usat_sanctioned),
  INDEX idx_usat_sanction_number (usat_sanction_number),

  INDEX idx_previous_results_count (previous_results_count),

  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_created_at_utc (created_at_utc),

  INDEX idx_event_year_month (event_year, event_month),
  INDEX idx_state_race_type (state, race_type),
  INDEX idx_state_usat (state, is_usat_sanctioned),
  INDEX idx_race_type_usat (race_type, is_usat_sanctioned),

  INDEX idx_url_prefix (url(255)),
  INDEX idx_register_now_url_prefix (register_now_url(255)),
  INDEX idx_visit_race_website_url_prefix (visit_race_website_url(255)),
  INDEX idx_usat_link_prefix (usat_link(255))
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

      ${listing_fields}
      ${detail_fields}
      ${created_at_dates}

      PRIMARY KEY (id),
      ${index_fields}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  return query;
}

module.exports = {
  query_create_trifind_custom_search_extract_table: main,
};
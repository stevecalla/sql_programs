// Single-row marker table recording HOW the reporting summary was last built, so the app can show
// whether it is serving TEST data (2024 & 2025 only) or the FULL data window. Written by step_3i at the
// end of each build (id is always 1 -> REPLACE INTO overwrites the one row).
const build_meta_fields = `
  id TINYINT NOT NULL DEFAULT 1,
  build_mode VARCHAR(20),
  min_year INT,
  max_year INT,
  built_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
`;

async function query_create_reporting_build_meta_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${build_meta_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_reporting_build_meta_table,
}

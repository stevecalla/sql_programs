const zip_fields = `
  zip5 VARCHAR(5) NOT NULL,
  lat DECIMAL(9,6),
  lng DECIMAL(9,6),
  city VARCHAR(120),
  state_code VARCHAR(10),
  county VARCHAR(150),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (zip5),
  INDEX idx_zip_state (state_code)
`;

async function query_create_zip_reference_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${zip_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_zip_reference_table,
}

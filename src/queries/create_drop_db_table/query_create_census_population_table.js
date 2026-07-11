const census_fields = `
  state_code VARCHAR(10) NOT NULL,
  state_name VARCHAR(120),
  population BIGINT,
  population_adult BIGINT,
  population_youth BIGINT,
  source VARCHAR(120),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (state_code)
`;

async function query_create_census_population_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${census_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_census_population_table,
}

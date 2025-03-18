const region_fields = `
  state_id INT,	
  region_code INT,
  state_name VARCHAR(100),	
  state_code VARCHAR(10),	
  region_name VARCHAR(100),
  region_abbr VARCHAR(10),
  created_at DATE
`;

async function query_create_region_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${region_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_region_table,
}
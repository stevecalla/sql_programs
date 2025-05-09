const id_fields = `
    id_profiles INT,
`;

const created_at_dates = `
    -- CREATED AT DATES
    created_at_mtn DATETIME,
    created_at_utc DATETIME,
`;

const index_fields = `
    PRIMARY KEY (id_profiles)
`;

async function query_create_rev_recognition_profile_ids_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${id_fields}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
    query_create_rev_recognition_profile_ids_table,
}
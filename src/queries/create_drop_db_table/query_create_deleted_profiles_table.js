async function query_create_deleted_profiles_table(table_name) {
  const query = `
    CREATE TABLE ${table_name} (

      id_profiles BIGINT PRIMARY KEY,

      deleted_at_profile DATETIME NOT NULL,
      created_at_mtn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP

    ) ENGINE=MEMORY;
  `;

  return query;
}

module.exports = {
  query_create_deleted_profiles_table,
}
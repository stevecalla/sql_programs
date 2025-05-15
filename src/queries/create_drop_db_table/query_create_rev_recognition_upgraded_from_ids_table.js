const upgrade_from_ids = `
  id_membership_periods_sa INT,
  upgraded_from_id_mp INT, 
  upgraded_to_id_mp INT,
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  PRIMARY KEY (id_membership_periods_sa),
    
  INDEX idx_upgrade_chain (upgraded_from_id_mp, id_membership_periods_sa)
`;

async function query_create_rev_recognition_upgraded_from_ids_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${upgrade_from_ids}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
    query_create_rev_recognition_upgraded_from_ids_table,
}
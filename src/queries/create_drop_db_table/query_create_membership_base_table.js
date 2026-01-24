// Summary table to store QUERY #1 output (stable counts + YTD counts)

const summary_dims = `
  year INT NOT NULL,
  membership_type VARCHAR(50) NOT NULL,
  new_member_category VARCHAR(50) NOT NULL,
`;

const summary_metrics = `
  unique_profiles INT NOT NULL,
  total_memberships_all_profiles_that_year INT NOT NULL,

  unique_profiles_sales_ytd INT NOT NULL,
  total_memberships_all_profiles_sales_ytd INT NOT NULL,
`;

const ytd_snapshot_fields = `
  ytd_as_of_run_date DATE NOT NULL,
  ytd_as_of_day_of_year INT NOT NULL,
`;

const created_at_dates = `
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  -- Uniqueness: one row per (year, membership_type, new_member_category, ytd_as_of_run_date)
  UNIQUE KEY uq_bucket_snapshot (year, membership_type, new_member_category, ytd_as_of_run_date),

  INDEX idx_year (year),
  INDEX idx_membership_type (membership_type),
  INDEX idx_new_member_category (new_member_category),
  INDEX idx_ytd_as_of_run_date (ytd_as_of_run_date)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${summary_dims}
      ${summary_metrics}
      ${ytd_snapshot_fields}
      ${created_at_dates}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_membership_base_table: main,
};

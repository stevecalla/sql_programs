const {
  id_fields,
  member_origin_types,
  key_dates,
  recursion_info,
  metrics,
  created_at_dates,
} = require("./query_create_rev_recognition_allocation_table");

const snapshot_id_fields = `
  as_of_snapshot_date_mtn DATETIME,
  snapshot_version VARCHAR(50),
`;

const id = `id INT,`;

const index_fields = `
  INDEX idx_profiles_periods (id_profiles, id_membership_periods_sa), -- id_profiles et al not primary due to intentional duplicates caused by recursion
  INDEX idx_profiles (id_profiles),
  INDEX idx_start_end_dates (starts_mp, ends_mp),
  INDEX idx_created_purchased (created_at_date_mp, created_year_month, purchased_on_date_adjusted_mp, purchased_on_adjusted_year_month),
  -- INDEX idx_sales_flags (is_sales_revenue_zero, is_duplicate_previous_period, is_overlaps_previous_mp, is_stacked_previous_mp),
  INDEX idx_membership_type (real_membership_types_sa, new_member_category_6_sa),
  INDEX idx_origin (origin_flag_ma),
  INDEX idx_revenue (sales_revenue)
`;

const snapshot_index_fields = `
  INDEX idx_as_of_snapshot_date_mtn (as_of_snapshot_date_mtn),
  INDEX idx_snapshot_version (snapshot_version),
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${snapshot_id_fields}
      ${id_fields}
      ${member_origin_types}
      ${key_dates}
      ${recursion_info}
      ${metrics}
      ${created_at_dates}
      ${id}
      ${snapshot_index_fields}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_rev_recognition_allocation_history_table: main,
};
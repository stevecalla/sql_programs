// Detail table to store QUERY #2 output (one row per year + id_profiles, after best-membership logic)

const detail_keys = `
  year INT NOT NULL,
  id_profiles INT NOT NULL,
  member_number_members_sa VARCHAR(50),
`;

const purchase_dates = `
  purchased_on_adjusted_mp DATETIME,
  purchased_on_year_adjusted_mp INT,
  purchased_on_quarter_adjusted_mp INT,
  purchased_on_month_adjusted_mp INT,
`;

const membership_period_dates = `
  starts_mp DATE,
  starts_year_mp INT,
  starts__quarter_mp INT,
  starts_month_mp INT,

  ends_mp DATE,
  ends_year_mp INT,
  ends_quarter_mp INT,
  ends_month_mp INT,
`;

const membership_dims = `
  real_membership_types_sa VARCHAR(50),
  new_member_category_6_sa VARCHAR(50),
`;

const member_lifecycle = `
  member_min_created_at_year INT,
  member_lapsed_renew_category VARCHAR(50),
  member_created_at_category VARCHAR(50),

  most_recent_prior_purchase_membership_type VARCHAR(50),
  most_recent_prior_purchase_membership_category VARCHAR(50),

  member_first_purchase_year_category VARCHAR(50),
  member_first_purchase_years_out INT,
  member_first_purchase_year INT,

  member_lifetime_frequency VARCHAR(50),
  member_lifetime_purchases INT,

  member_upgrade_downgrade_category VARCHAR(50),
  member_upgrade_downgrade_major VARCHAR(50),
`;

const demographics_geo = `
  age_at_end_of_year INT,
  age_as_year_end_bin VARCHAR(50),
  date_of_birth_year_mp INT,

  member_state_code_addresses VARCHAR(10),
  region_name_member VARCHAR(100),

  gender_id_profiles INT,
  gender_profiles VARCHAR(50),
`;

const detail_metrics_flags = `
  total_memberships_for_year INT NOT NULL,

  -- computed in Query #2 (best-membership logic ordering)
  membership_type_priority INT NOT NULL,

  -- computed in Query #2
  is_sales_ytd TINYINT NOT NULL,

  -- ✅ new: per-row contribution to Query #1 totals
  total_memberships_all_profiles_that_year INT NOT NULL,

  -- ✅ new: per-row contribution to Query #1 YTD totals
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

const detail_indexes = `
  -- One row per (snapshot, year, profile) for the best-membership output
  UNIQUE KEY uq_snapshot_year_profile (ytd_as_of_run_date, year, id_profiles),

  INDEX idx_year (year),
  INDEX idx_id_profiles (id_profiles),

  INDEX idx_membership_type (real_membership_types_sa),
  INDEX idx_new_member_category (new_member_category_6_sa),

  INDEX idx_membership_type_priority (membership_type_priority),
  INDEX idx_is_sales_ytd (is_sales_ytd),
  INDEX idx_purchased_on_adjusted_mp (purchased_on_adjusted_mp),

  -- ✅ helpful for rollups / audits
  INDEX idx_total_memberships_all_profiles_that_year (total_memberships_all_profiles_that_year),
  INDEX idx_total_memberships_all_profiles_sales_ytd (total_memberships_all_profiles_sales_ytd),

  INDEX idx_member_state_code (member_state_code_addresses),
  INDEX idx_region_name_member (region_name_member),

  INDEX idx_age_bin (age_as_year_end_bin),
  INDEX idx_gender (gender_profiles)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${detail_keys}
      ${purchase_dates}
      ${membership_period_dates}
      ${membership_dims}
      ${member_lifecycle}
      ${demographics_geo}
      ${detail_metrics_flags}
      ${ytd_snapshot_fields}
      ${created_at_dates}
      ${detail_indexes}
    );
  `;
  return query;
}

module.exports = {
  query_create_membership_detail_table: main,
};

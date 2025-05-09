const id_fields = `
  id_profiles INT,
  id_membership_periods_sa INT,
`;

const member_origin_types = `
  real_membership_types_sa VARCHAR(255),
  new_member_category_6_sa VARCHAR(255),
  origin_flag_ma VARCHAR(255),
`;

const key_dates = `         
  created_at_mp DATETIME,   
  created_at_date_mp DATE,
  created_at_mp_month INT,
  created_at_mp_quarter INT,
  created_at_mp_year INT,

  updated_at_mp DATETIME,
  updated_at_date_mp DATE,
  updated_at_mp_month INT,
  updated_at_mp_quarter INT,
  updated_at_mp_year INT,

  purchased_on_date_mp DATE,
  purchased_on_date_mp_month INT,
  purchased_on_date_mp_quarter INT,
  purchased_on_date_mp_year INT,

  purchased_on_date_adjusted_mp DATE,
  purchased_on_date_adjusted_mp_month INT,
  purchased_on_date_adjusted_mp_quarter INT,
  purchased_on_date_adjusted_mp_year INT,

  starts_mp DATE,
  starts_mp_month INT,
  starts_mp_quarter INT,
  starts_mp_year INT,

  ends_mp DATE,
  ends_mp_month INT,
  ends_mp_quarter INT,
  ends_mp_year INT,
`;

const mp_months = `
  months_mp_difference INT,
  months_mp_allocated_custom INT,
`;

const flags = `
  -- NOTE: Flag if the prior period (previous start and end) is the same as the current period's start and end
  is_duplicate_previous_period INT,
  
  -- Flag if the current period overlaps with the previous one (start of current <= end of previous)
  is_overlaps_previous_mp INT,

  is_stacked_previous_mp INT,

  days_between_previous_end_and_start INT,
  
  is_sales_revenue_zero INT,
  is_bulk INT,

  is_youth_premier INT,
  is_lifetime INT,

  has_created_at_gt_purchased_on INT,
`;

const metrics = `
  actual_membership_fee_6_rule_sa VARCHAR(255),
  sales_revenue DECIMAL(12, 2),
  sales_units INT,
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  PRIMARY KEY (id_profiles, id_membership_periods_sa),

  INDEX idx_profiles (id_profiles),
  INDEX idx_start_end_dates (starts_mp, ends_mp),
  INDEX idx_created_purchased (created_at_date_mp, purchased_on_date_mp),
  INDEX idx_sales_flags (is_sales_revenue_zero, is_duplicate_previous_period, is_overlaps_previous_mp, is_stacked_previous_mp),
  INDEX idx_membership_type (real_membership_types_sa, new_member_category_6_sa),
  INDEX idx_origin (origin_flag_ma),
  INDEX idx_revenue (sales_revenue)
`;

async function query_create_rev_recognition_base_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${id_fields}
      ${member_origin_types}
      ${key_dates}
      ${mp_months}
      ${flags}
      ${metrics}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
    query_create_rev_recognition_base_table,
}
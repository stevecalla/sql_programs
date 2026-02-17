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

  created_year_month VARCHAR(50),

  purchased_on_date_adjusted_mp DATE,
  purchased_on_date_adjusted_mp_month INT,
  purchased_on_date_adjusted_mp_quarter INT,
  purchased_on_date_adjusted_mp_year INT,

  purchased_on_adjusted_year_month VARCHAR(50),

  starts_mp DATE,
  starts_mp_month INT,
  starts_mp_quarter INT,
  starts_mp_year INT,

  ends_mp DATE,
  ends_mp_month INT,
  ends_mp_quarter INT,
  ends_mp_year INT,

  revenue_date DATE,
  revenue_month_date INT,
  revenue_quarter_date INT,
  revenue_year_date INT,
  
  revenue_year_month VARCHAR(50),

  is_current_month INT,
`;

const recursion_info = `
  recursion_month_index INT,  -- This shows the month used in recursion

  months_mp_allocation_recursive INT,
  months_mp_allocated_custom INT,
`;

// NOTE: Removed b/c produces too much data
// const flags = `
//     is_duplicate_previous_period INT,
    
//     is_overlaps_previous_mp INT,

//     is_stacked_previous_mp INT,

//     days_between_previous_end_and_start INT,
    
//     is_sales_revenue_zero INT,
//     is_bulk INT,

//     is_youth_premier INT,
//     is_lifetime INT,

//     has_created_at_gt_purchased_on INT,
// `;

const metrics = `
  sales_units INT, 
  monthly_sales_units DECIMAL(10, 4),
  sales_revenue DECIMAL(12, 2),
  monthly_revenue DECIMAL(12, 2),
  sales_revenue_less_deduction DECIMAL(12, 2),
  monthly_revenue_less_deduction DECIMAL(12, 2),
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,

  INDEX idx_profiles_periods (id_profiles, id_membership_periods_sa), -- id_profiles et al not primary due to intentional duplicates caused by recursion
  INDEX idx_profiles (id_profiles),
  INDEX idx_start_end_dates (starts_mp, ends_mp),
  INDEX idx_created_purchased (created_at_date_mp, created_year_month, purchased_on_date_adjusted_mp, purchased_on_adjusted_year_month),
  -- INDEX idx_sales_flags (is_sales_revenue_zero, is_duplicate_previous_period, is_overlaps_previous_mp, is_stacked_previous_mp),
  INDEX idx_membership_type (real_membership_types_sa, new_member_category_6_sa),
  INDEX idx_origin (origin_flag_ma),
  INDEX idx_revenue (sales_revenue)
`;

async function query_create_rev_recognition_allocation_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${id_fields}
      ${member_origin_types}
      ${key_dates}
      ${recursion_info}
      ${metrics}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
  query_create_rev_recognition_allocation_table,
}
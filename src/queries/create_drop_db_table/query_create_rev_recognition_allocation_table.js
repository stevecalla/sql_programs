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
  created_month VARCHAR(50),

  purchased_on_date_adjusted_mp DATE,
  purchased_on_adjusted_month VARCHAR(50),
  
  starts_mp DATE,
  ends_mp DATE,

  revenue_month VARCHAR(50),
`;

const recursion_info = `
  recursion_month_index INT,  -- This shows the month used in recursion
  total_months INT,
  total_months_recursive INT,
`;

const metrics = `
  sales_units INT, 
  monthly_sales_units DECIMAL(10, 4),
  sales_revenue DECIMAL(12, 2),
  monthly_revenue DECIMAL(12, 2),
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,

  INDEX idx_profiles_periods (id_profiles, id_membership_periods_sa),
  INDEX idx_profiles (id_profiles),
  INDEX idx_start_end_dates (starts_mp, ends_mp),
  INDEX idx_created_purchased (created_at_mp, created_month, purchased_on_date_adjusted_mp, purchased_on_adjusted_month),
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
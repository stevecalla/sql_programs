const all_membership_sales_data_2015_left = `
    id_profiles INT,
    id_membership_periods_sa INT,
    
    real_membership_types_sa VARCHAR(255),
    new_member_category_6_sa VARCHAR(255),
    origin_flag_ma VARCHAR(255),
    
    created_at_mp DATETIME,
    updated_at_mp DATETIME,
    purchased_on_date_mp DATE,
    purchased_on_date_adjusted_mp DATE,
    
    starts_mp DATE,
    ends_mp DATE,
    total_months INT,
    total_months_recursive INT,
    
    -- Flag if the prior period (previous start and end) is the same as the current period's start and end
    is_duplicate_previous_period INT,
    
    -- Flag if the current period overlaps with the previous one (start of current <= end of previous)
    is_overlaps_previous_mp INT,

    days_between_previous_end_and_start INT,
    
    is_sales_revenue_zero INT,
    is_bulk INT,

    is_youth_premier INT,
    is_lifetime INT,

    has_created_at_gt_purchased_on INT,

    actual_membership_fee_6_rule_sa VARCHAR(255),
    sales_revenue DECIMAL,
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
    INDEX idx_created_purchased (created_at_mp, purchased_on_date_mp),
    INDEX idx_sales_flags (is_sales_revenue_zero, is_duplicate_previous_period, is_overlaps_previous_mp),
    INDEX idx_membership_type (real_membership_types_sa, new_member_category_6_sa),
    INDEX idx_origin (origin_flag_ma),
    INDEX idx_revenue (sales_revenue)
`;

async function query_create_rev_recognition_base_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${all_membership_sales_data_2015_left}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
    query_create_rev_recognition_base_table,
}
// Table to store output of step_4a_discovery_join_to_sales_2023_forward_recursive.sql
// Intended final SELECT shape: detail_granular_atomic (fr.* + atomic rollup fields) + created_at_mtn/utc

const period_dims = `
  query_label VARCHAR(120) NOT NULL,

  report_year INT NOT NULL,
  period_type VARCHAR(10) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
`;

const original_membership_dims = `
  id_profiles BIGINT NOT NULL,
  member_number_members_sa VARCHAR(255) NULL,

  original_id_membership_periods_sa BIGINT NULL,

  original_purchased_on_adjusted_mp DATETIME NULL,
  original_purchased_on_date_adjusted_mp DATE NULL,
  original_purchased_on_year_adjusted_mp INT NULL,
  original_purchased_on_month_adjusted_mp INT NULL,

  original_start DATE NULL,
  original_start_year INT NULL,
  original_start_month INT NULL,

  original_end DATE NULL,
  original_end_year INT NULL,
  original_end_month INT NULL,

  original_type VARCHAR(100) NULL,
  original_category VARCHAR(50) NULL,

  original_origin_flag_category VARCHAR(255) NULL,
  original_origin_flag_ma VARCHAR(255) NULL,
`;

const next_membership_365 = `
  next_purchased_on_date_mp_365 DATE NULL,
  next_id_membership_periods_sa_365 BIGINT NULL,
  next_start_365 DATE NULL,
  next_end_365 DATE NULL,
  next_type_365 VARCHAR(100) NULL,
  next_category_365 VARCHAR(50) NULL,
  next_origin_flag_category_365 VARCHAR(255) NULL,
  next_origin_flag_ma_365 VARCHAR(255) NULL,

  renewed_flag_365 TINYINT(1) NOT NULL,
  days_to_renew_365 INT NULL,
  renewal_timing_category_365 VARCHAR(30) NULL,
`;

const next_membership_jan31 = `
  next_purchased_on_date_mp_jan31 DATE NULL,
  next_id_membership_periods_sa_jan31 BIGINT NULL,
  next_start_jan31 DATE NULL,
  next_end_jan31 DATE NULL,
  next_type_jan31 VARCHAR(100) NULL,
  next_category_jan31 VARCHAR(50) NULL,
  next_origin_flag_category_jan31 VARCHAR(255) NULL,
  next_origin_flag_ma_jan31 VARCHAR(255) NULL,

  renewed_flag_jan31 TINYINT(1) NOT NULL,
  days_to_renew_jan31 INT NULL,
  renewal_timing_category_jan31 VARCHAR(30) NULL,
`;

const next_membership_primary = `
  next_purchased_on_date_mp DATE NULL,
  next_id_membership_periods_sa BIGINT NULL,
  next_start DATE NULL,
  next_end DATE NULL,
  next_type VARCHAR(100) NULL,
  next_category VARCHAR(50) NULL,
  next_origin_flag_category VARCHAR(255) NULL,
  next_origin_flag_ma VARCHAR(255) NULL,

  renewed_flag TINYINT(1) NOT NULL,
  days_to_renew INT NULL,
  renewal_timing_category VARCHAR(30) NULL,
`;

const seq_and_atomic_metrics = `
  original_seq INT NOT NULL,

  -- atomic counts using the SAME field names as summary_by_dims (PRIMARY)
  ended_row_count INT NOT NULL,
  did_renew_row_count INT NOT NULL,
  did_not_renew_count INT NOT NULL,

  -- atomic “rates” (0/1). AVG() gives true rate
  did_renew_rate DECIMAL(10,6) NOT NULL,
  did_not_renew_rate DECIMAL(10,6) NOT NULL,

  -- 365 window atomic
  did_renew_row_count_365 INT NOT NULL,
  did_not_renew_count_365 INT NOT NULL,
  did_renew_rate_365 DECIMAL(10,6) NOT NULL,
  did_not_renew_rate_365 DECIMAL(10,6) NOT NULL,

  -- jan31 window atomic
  did_renew_row_count_jan31 INT NOT NULL,
  did_not_renew_count_jan31 INT NOT NULL,
  did_renew_rate_jan31 DECIMAL(10,6) NOT NULL,
  did_not_renew_rate_jan31 DECIMAL(10,6) NOT NULL,
`;

const created_at_dates = `
  created_at_mtn DATETIME NULL,
  created_at_utc DATETIME NULL,
`;

const index_fields = `
  -- Common query patterns: period + member dims + profile
  INDEX idx_period (report_year, period_type),
  INDEX idx_period_dates (period_start, period_end),

  INDEX idx_profile (id_profiles),
  INDEX idx_original_end (original_end),
  INDEX idx_original_type_cat (original_type, original_category),

  -- Renewal flags (filtering / rollups)
  INDEX idx_renewed_flag (renewed_flag),
  INDEX idx_renewed_flag_365 (renewed_flag_365),
  INDEX idx_renewed_flag_jan31 (renewed_flag_jan31),

  -- Helpful for drilldowns
  INDEX idx_period_profile (report_year, period_type, id_profiles),
  INDEX idx_period_type_cat (report_year, period_type, original_type, original_category)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${period_dims}
      ${original_membership_dims}
      ${next_membership_365}
      ${next_membership_jan31}
      ${next_membership_primary}
      ${seq_and_atomic_metrics}
      ${created_at_dates}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_sales_renewal_table: main,
};

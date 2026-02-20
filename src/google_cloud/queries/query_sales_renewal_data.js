async function main(batch_size = 10, offset = 0) {
  return `
    SELECT
      'DETAIL — atomic membership rows (safe to SUM/AVG)' AS query_label,

      report_year,
      period_type,

      DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start, 
      DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end, 

      id_profiles,
      member_number_members_sa,

      original_id_membership_periods_sa,
      DATE_FORMAT(original_purchased_on_adjusted_mp, '%Y-%m-%d %H:%i:%s') AS original_purchased_on_adjusted_mp,
      
      DATE_FORMAT(original_start, '%Y-%m-%d') AS original_start, 
      DATE_FORMAT(original_end, '%Y-%m-%d') AS original_end, 
      original_type,
      original_category,
      original_origin_flag_category,
      original_origin_flag_ma,

      -- =========================================================
      -- LATERAL #1: within 365 days
      -- =========================================================
      DATE_FORMAT(next_purchased_on_date_mp_365, '%Y-%m-%d') AS next_purchased_on_date_mp_365, 
      next_id_membership_periods_sa_365,
      DATE_FORMAT(next_start_365, '%Y-%m-%d') AS next_start_365, 
      DATE_FORMAT(next_end_365, '%Y-%m-%d') AS next_end_365, 
      
      next_type_365,
      next_category_365,
      next_origin_flag_category_365,
      next_origin_flag_ma_365,

      renewed_flag_365,
      days_to_renew_365,

      renewal_timing_category_365,

      -- =========================================================
      -- LATERAL #2: before 1/31 (Jan 31 inclusive ≈ before Feb 1)
      -- =========================================================
      DATE_FORMAT(next_purchased_on_date_mp_jan31, '%Y-%m-%d') AS next_purchased_on_date_mp_jan31, 
      next_id_membership_periods_sa_jan31,
      DATE_FORMAT(next_start_jan31, '%Y-%m-%d') AS next_start_jan31, 
      DATE_FORMAT(next_end_jan31, '%Y-%m-%d') AS next_end_jan31, 

      next_type_jan31,
      next_category_jan31,
      next_origin_flag_category_jan31,
      next_origin_flag_ma_jan31,

      renewed_flag_jan31,
      days_to_renew_jan31,
      renewal_timing_category_jan31,

      -- =========================================================
      -- OPTIONAL: pick a "primary" next membership
      -- Here: prefer jan31-window match, else fall back to 365-day match.
      -- =========================================================
      DATE_FORMAT(next_purchased_on_date_mp, '%Y-%m-%d') AS next_purchased_on_date_mp, 
      next_id_membership_periods_sa,
      DATE_FORMAT(next_start, '%Y-%m-%d') AS next_start, 
      DATE_FORMAT(next_end, '%Y-%m-%d') AS next_end, 

      next_type,
      next_category,
      next_origin_flag_category,
      next_origin_flag_ma,

      renewed_flag,
      days_to_renew,
      renewal_timing_category,
      original_seq,

      -- atomic counts using the SAME field names as summary_by_dims (PRIMARY)
      ended_row_count,
      did_renew_row_count,
      did_not_renew_count,

      -- atomic “rates” (0/1). These are safe to AVG to get the true rate.
      did_renew_rate,
      did_not_renew_rate,

      -- atomic counts/rates for 365 window
      did_renew_row_count_365,
      did_not_renew_count_365,
      did_renew_rate_365,
      did_not_renew_rate_365,

      -- atomic counts/rates for jan31 window
      did_renew_row_count_jan31,
      did_not_renew_count_jan31,
      did_renew_rate_jan31,
      did_not_renew_rate_jan31,
      
      -- CREATED AT DATES
      DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
      DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

    FROM usat_sales_db.sales_renewal_data
    WHERE 1 = 1
    ORDER BY
      period_type,
      report_year,
      original_type,
      original_category
    LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
  query_sales_renewal_data: main,
};

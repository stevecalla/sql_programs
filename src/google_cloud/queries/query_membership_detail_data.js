async function main(batch_size = 10, offset = 0) {
  return `
    SELECT
      -- GRAIN
      year,
      id_profiles,

      -- MEMBER
      member_number_members_sa,

      -- PURCHASED (ADJUSTED)
      DATE_FORMAT(purchased_on_adjusted_mp, '%Y-%m-%d %H:%i:%s') AS purchased_on_adjusted_mp,
      purchased_on_year_adjusted_mp,
      purchased_on_quarter_adjusted_mp,
      purchased_on_month_adjusted_mp,

      -- MEMBERSHIP PERIOD
      DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp,
      starts_year_mp,
      starts__quarter_mp,
      starts_month_mp,

      DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp,
      ends_year_mp,
      ends_quarter_mp,
      ends_month_mp,

      -- MEMBERSHIP DIMS
      real_membership_types_sa,
      new_member_category_6_sa,

      -- LIFECYCLE
      member_min_created_at_year,
      member_lapsed_renew_category,
      member_created_at_category,

      most_recent_prior_purchase_membership_type,
      most_recent_prior_purchase_membership_category,

      member_first_purchase_year_category,
      member_first_purchase_years_out,
      member_first_purchase_year,

      member_lifetime_frequency,
      member_lifetime_purchases,

      member_upgrade_downgrade_category,
      member_upgrade_downgrade_major,

      -- DEMOS / GEO
      age_at_end_of_year,
      age_as_year_end_bin,
      date_of_birth_year_mp,
      member_state_code_addresses,
      region_name_member,

      gender_id_profiles,
      gender_profiles,

      -- METRICS / FLAGS
      total_memberships_for_year,
      membership_type_priority,
      
      is_sales_through_day_of_year,
      is_sales_ytd,

      total_memberships_all_profiles_that_year,
      total_memberships_all_profiles_sales_through_day_of_year,
      total_memberships_all_profiles_sales_ytd,

      -- YTD WINDOW METADATA
      DATE_FORMAT(ytd_as_of_run_date, '%Y-%m-%d') AS ytd_as_of_run_date,
      ytd_as_of_day_of_year,

      -- BATCH TIMESTAMPS
      DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
      DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

    FROM usat_sales_db.membership_detail_data
    WHERE 1 = 1
    ORDER BY year DESC, id_profiles ASC
    -- LIMIT 100
    LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
  query_membership_detail_data: main,
};

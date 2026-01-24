async function main(batch_size = 10, offset = 0) {
  return `
    SELECT
      -- GRAIN
      year,

      -- DIMENSIONS
      membership_type,
      new_member_category,

      -- COUNTS
      unique_profiles,
      total_memberships_all_profiles_that_year,
      unique_profiles_sales_ytd,
      total_memberships_all_profiles_sales_ytd,

      -- YTD WINDOW METADATA
      DATE_FORMAT(ytd_as_of_run_date, '%Y-%m-%d') AS ytd_as_of_run_date,
      ytd_as_of_day_of_year,

      -- BATCH TIMESTAMPS
      DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
      DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

    FROM usat_sales_db.membership_base_data
    WHERE 1 = 1
    ORDER BY
      year DESC,
      membership_type ASC,
      new_member_category ASC
    LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
  query_membership_base_data: main,
};

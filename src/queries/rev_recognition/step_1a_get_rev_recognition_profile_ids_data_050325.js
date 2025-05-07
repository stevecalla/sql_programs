function step_1a_query_rev_recognition_profile_ids_data(created_at_mtn, created_at_utc, QUERY_OPTIONS) {
    return `
        SELECT DISTINCT 
            id_profiles,

            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc


        FROM all_membership_sales_data_2015_left
        WHERE ends_mp >= '${QUERY_OPTIONS.ends_mp}'
        -- LIMIT 7000
        ;
      `
    ;
  }
  

module.exports = {
    step_1a_query_rev_recognition_profile_ids_data,
}
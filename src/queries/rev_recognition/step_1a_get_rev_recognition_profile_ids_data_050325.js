function step_1a_query_rev_recognition_profile_ids_data(created_at_mtn, created_at_utc, QUERY_OPTIONS) {
    return `
        SELECT DISTINCT 
            id_profiles,

            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM all_membership_sales_data_2015_left
        WHERE 1 = 1
          AND ends_mp >= '${QUERY_OPTIONS.ends_mp}'
          
        -- TESTING EXAMPLES
        -- AND ends_mp = '${QUERY_OPTIONS.ends_mp}'
        -- AND id_profiles IN (54, 57, 60) -- basic test examples
        -- AND id_profiles IN (2599832, 2737677) -- upgraded from / to examples

        -- LIMIT 7000
        ;
      `
    ;
  }
  

module.exports = {
    step_1a_query_rev_recognition_profile_ids_data,
}
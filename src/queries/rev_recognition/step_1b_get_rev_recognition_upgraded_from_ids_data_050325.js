function step_1b_query_rev_recognition_upgraded_from_ids_data(created_at_mtn, created_at_utc, QUERY_OPTIONS) {
    return `
        SELECT DISTINCT 
            id_profiles,
            id_membership_periods_sa,
            upgraded_from_id_mp,
            id_membership_periods_sa AS upgraded_to_id_mp,

            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM all_membership_sales_data_2015_left
        WHERE 1 = 1
          AND ends_mp >= '${QUERY_OPTIONS.ends_mp}'
          -- NOTE: excludes 4486005 which appears to be an error
          AND id_membership_periods_sa != upgraded_from_id_mp 
          -- NOTE: excludes these combinations b/c the upgrade_from_id was included incorrectly for these records (a ticket was submitted to DS 5/15/25 to correct)
          AND (id_profiles, id_membership_periods_sa) NOT IN (
            (463550, 4828189), -- duplicate with (2865390, 4828189)
            (2701138, 4767827),
            (2738933, 4631539),
            (2390634, 4882173) -- best guess is that 4882173 shouldn't have upgraded from; the other possibility is 5019736
          )
          
        -- TESTING EXAMPLES
        -- AND ends_mp = '${QUERY_OPTIONS.ends_mp}'
        -- AND id_profiles IN (54, 57, 60) -- basic test examples
        -- AND id_profiles IN (2599832, 2737677) -- upgraded from / to examples

        ORDER BY id_membership_periods_sa, upgraded_from_id_mp

        -- LIMIT 7000
        ;
      `
    ;
  }
  

module.exports = {
    step_1b_query_rev_recognition_upgraded_from_ids_data,
}
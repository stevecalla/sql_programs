// SOURCE:
// C:\Users\calla\development\usat\sql_code\21_recognized_membership_revenue\step_0_create_recognized_revenue_all_query_base_table.sql

function step_1_query_rev_recognition_data(created_at_mtn, created_at_utc, QUERY_OPTIONS) {

  const { limit_size, offset_size } = QUERY_OPTIONS;
  console.log('limit = ', limit_size, 'offset =', offset_size);

  return `
    SELECT
        a.id_profiles,
        a.id_membership_periods_sa,

        a.real_membership_types_sa,
        a.new_member_category_6_sa,
        a.origin_flag_ma,

        a.created_at_mp,
        DATE_FORMAT(a.created_at_mp, '%Y-%m-%d') AS created_at_date_mp,
        MONTH(a.created_at_mp) AS created_at_mp_month,
        QUARTER(a.created_at_mp) AS created_at_mp_quarter,
        YEAR(a.created_at_mp) AS created_at_mp_year,

        a.updated_at_mp,
        DATE_FORMAT(a.updated_at_mp, '%Y-%m-%d') AS updated_at_date_mp,
        MONTH(a.updated_at_mp) AS updated_at_mp_month,
        QUARTER(a.updated_at_mp) AS updated_at_mp_quarter,
        YEAR(a.updated_at_mp) AS updated_at_mp_year,

        a.purchased_on_date_mp,
        MONTH(a.purchased_on_date_mp) AS purchased_on_date_mp_month,
        QUARTER(a.purchased_on_date_mp) AS purchased_on_date_mp_quarter,
        YEAR(a.purchased_on_date_mp) AS purchased_on_date_mp_year,

        a.purchased_on_date_adjusted_mp,
        MONTH(a.purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_month,
        QUARTER(a.purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_quarter,
        YEAR(a.purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_year,

        a.starts_mp,
        MONTH(a.starts_mp) AS starts_mp_month,
        QUARTER(a.starts_mp) AS starts_mp_quarter,
        YEAR(a.starts_mp) AS starts_mp_year,

        a.ends_mp,
        MONTH(a.ends_mp) AS ends_mp_month,
        QUARTER(a.ends_mp) AS ends_mp_quarter,
        YEAR(a.ends_mp) AS ends_mp_year,

        TIMESTAMPDIFF(MONTH, a.starts_mp, a.ends_mp) AS months_mp_difference,
        TIMESTAMPDIFF(MONTH, a.starts_mp, a.ends_mp) + 2 AS months_mp_allocated_custom,

        -- Definition: This flag indicates that the current membership period (based on start and end dates) is exactly the same as the previous period for the same profile.
        CASE
            WHEN a.starts_mp = LAG(a.starts_mp) OVER (PARTITION BY a.id_profiles ORDER BY a.starts_mp) 
              AND a.ends_mp = LAG(a.ends_mp) OVER (PARTITION BY a.id_profiles ORDER BY a.starts_mp)
            THEN 1 ELSE 0
        END AS is_duplicate_previous_period,

        -- Definition: This flag indicates that the start date of the current membership period is on or before the end date of the previous period for the same profile.
        CASE
            WHEN a.starts_mp <= LAG(a.ends_mp) OVER (PARTITION BY a.id_profiles ORDER BY a.starts_mp)
            THEN 1 ELSE 0
        END AS is_overlaps_previous_mp,
    
        -- Definition: Stacked membership is one where the start date of the current membership is within 30 days before or after the end date of the previous membership.
        CASE
            WHEN ABS(DATEDIFF(a.starts_mp, LAG(a.ends_mp) OVER (PARTITION BY a.id_profiles ORDER BY a.starts_mp))) <= 30
            THEN 1 ELSE 0
        END AS is_stacked_previous_mp,

        DATEDIFF(
            a.starts_mp,
            LAG(a.ends_mp) OVER (PARTITION BY a.id_profiles ORDER BY a.starts_mp)
        ) AS days_between_previous_end_and_start,

        CASE WHEN a.actual_membership_fee_6_sa <= 0 THEN 1 ELSE 0 END AS is_sales_revenue_zero,
        CASE WHEN a.origin_flag_ma = "ADMIN_BULK_UPLOADER" THEN 1 ELSE 0 END AS is_bulk,
        CASE WHEN a.new_member_category_6_sa LIKE "%Youth Premier%" THEN 1 ELSE 0 END AS is_youth_premier,
        CASE WHEN a.new_member_category_6_sa = 'Lifetime' THEN 1 ELSE 0 END AS is_lifetime,

        CASE 
            WHEN YEAR(a.created_at_mp) > YEAR(a.purchased_on_date_mp)
              OR (YEAR(a.created_at_mp) = YEAR(a.purchased_on_date_mp)
                  AND MONTH(a.created_at_mp) > MONTH(a.purchased_on_date_mp))
            THEN 1 ELSE 0
        END AS has_created_at_gt_purchased_on,

        a.actual_membership_fee_6_rule_sa,
        a.actual_membership_fee_6_sa AS sales_revenue,
        1 AS sales_units,

        '${created_at_mtn}' AS created_at_mtn,
        '${created_at_utc}' AS created_at_utc

    FROM all_membership_sales_data_2015_left a
      -- INNER JOIN rev_recognition_base_profile_ids_data p ON a.id_profiles = p.id_profiles
      
      INNER JOIN (
        SELECT 
          id_profiles
        FROM rev_recognition_base_profile_ids_data
        ORDER BY id_profiles

        LIMIT ${limit_size} OFFSET ${offset_size}
        -- LIMIT 100000 OFFSET 0
        
      ) p ON a.id_profiles = p.id_profiles

    ORDER BY a.id_profiles, a.starts_mp;
  `;
}
  

module.exports = {
    step_1_query_rev_recognition_data,
}


// THIS QUERY IS USED AS AN INSERT QUERY IN THE FETCH FUNCTION IN STEP 1 CREATE RECOGNIZTED BASE DATA
// function step_1_query_rev_recognition_data_v1(created_at_mtn, created_at_utc, QUERY_OPTIONS) {
        
//     const{ ends_mp } = QUERY_OPTIONS;
//     console.log('step 1 query = ', QUERY_OPTIONS);

//     return `
//         -- GET PROFILES IDS TO USE IN THE NEXT QUERY; THIS ENSURES THE QUERY RETRIEVES ALL PROFILE ID HISTORY
//         WITH get_n_profiles_ids AS (
//             SELECT DISTINCT 
//                 id_profiles, id_membership_periods_sa, starts_mp, ends_mp
//             FROM all_membership_sales_data_2015_left
//             WHERE 1 = 1
//                 AND id_profiles NOT IN (0) -- 0 is a bad / invalid profile id based on dates et al
//                 -- AND ends_mp >= DATE_FORMAT(NOW(), '%Y-01-01') -- current year dynamically without needing to manually change the date each year
//                 -- AND id_profiles IN (@id_profile_1, @id_profile_2, @id_profile_3)
                
//                 -- NODE JS
//                 -- AND ends_mp = ${ends_mp} -- TODO:
//                 -- AND id_profiles IN (54, 57, 60)
//                 AND ends_mp >= '2025-01-01'

//             ORDER BY id_profiles, starts_mp
//             -- LIMIT 100 OFFSET 0  -- Paginating on distinct profile IDs, not raw rows.
//         )
//         SELECT
//             id_profiles,
//             id_membership_periods_sa,
            
//             real_membership_types_sa,
//             new_member_category_6_sa,
//             origin_flag_ma,
            
//             created_at_mp AS created_at_mp,
//             MONTH(created_at_mp) AS created_at_mp_month,
//             QUARTER(created_at_mp) AS created_at_mp_quarter,
//             YEAR(created_at_mp) AS created_at_mp_year,

//             updated_at_mp AS updated_at_mp,
//             MONTH(updated_at_mp) AS updated_at_mp_month,
//             QUARTER(updated_at_mp) AS updated_at_mp_quarter,
//             YEAR(updated_at_mp) AS updated_at_mp_year,

//             purchased_on_date_mp,
//             MONTH(purchased_on_date_mp) AS purchased_on_date_mp_month,
//             QUARTER(purchased_on_date_mp) AS purchased_on_date_mp_quarter,
//             YEAR(purchased_on_date_mp) AS purchased_on_date_mp_year,

//             purchased_on_date_adjusted_mp,
//             MONTH(purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_month,
//             QUARTER(purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_quarter,
//             YEAR(purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp_year,

//             starts_mp,
//             MONTH(starts_mp) AS starts_mp_month,
//             QUARTER(starts_mp) AS starts_mp_quarter,
//             YEAR(starts_mp) AS starts_mp_year,

//             ends_mp,
//             MONTH(ends_mp) AS ends_mp_month,
//             QUARTER(ends_mp) AS ends_mp_quarter,
//             YEAR(ends_mp) AS ends_mp_year,

//             -- Standard difference (excludes the first partial month)
//             TIMESTAMPDIFF(MONTH, starts_mp, ends_mp) AS total_months,

//             -- Recursive months to allocate revenue -- todo: revise rules
//             TIMESTAMPDIFF(MONTH, starts_mp, ends_mp) + 2 AS total_months_recursive,

//             -- CASE 
//             --     WHEN real_membership_types_sa = 'Adult Annual' THEN 12
//             --     WHEN real_membership_types_sa = '1 Day' THEN 1
//             --     ELSE TIMESTAMPDIFF(MONTH, starts_mp, ends_mp) + 1
//             -- END AS total_months_recursive,
            
//             -- Flag if the prior period (previous start and end) is the same as the current period's start and end
//             CASE
//                 WHEN starts_mp = LAG(starts_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) 
//                     AND ends_mp = LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) 
//                 THEN 1 
//                 ELSE 0 
//             END AS is_duplicate_previous_period,
            
//             -- Flag if the current period overlaps with the previous one (start of current <= end of previous)
//             CASE
//                 WHEN starts_mp <= LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) THEN 1
//                 ELSE 0
//             END AS is_overlaps_previous_mp,

//             DATEDIFF(
//                 starts_mp,
//                 LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp)
//             ) AS days_between_previous_end_and_start,
            
//             CASE WHEN actual_membership_fee_6_sa <= 0 THEN 1 ELSE 0 END AS is_sales_revenue_zero,
//             CASE WHEN origin_flag_ma = "ADMIN_BULK_UPLOADER" THEN 1 ELSE 0 END AS is_bulk,
    
//             CASE WHEN new_member_category_6_sa LIKE "%Youth Premier%" THEN 1 ELSE 0 END AS is_youth_premier,
//             CASE WHEN new_member_category_6_sa = 'Lifetime' THEN 1 ELSE 0 END AS is_lifetime,

//             CASE 
//                 WHEN YEAR(created_at_mp) > YEAR(purchased_on_date_mp)
//                     OR (
//                         YEAR(created_at_mp) = YEAR(purchased_on_date_mp)
//                         AND MONTH(created_at_mp) > MONTH(purchased_on_date_mp)
//                     )
//                 THEN 1
//                 ELSE 0
//             END AS has_created_at_gt_purchased_on,

//             actual_membership_fee_6_rule_sa,
//             actual_membership_fee_6_sa AS sales_revenue,
//             1 AS sales_units,

//             -- CREATED AT DATES
//             '${created_at_mtn}' AS created_at_mtn,
//             '${created_at_utc}' AS created_at_utc
            
//         FROM all_membership_sales_data_2015_left
//         WHERE 1 = 1
//             AND id_profiles IN (SELECT id_profiles FROM get_n_profiles_ids)
//         ORDER BY id_profiles, starts_mp
//         ;
//     `;
// }
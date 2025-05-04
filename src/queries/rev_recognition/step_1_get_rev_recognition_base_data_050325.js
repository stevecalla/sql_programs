// SOURCE:
// C:\Users\calla\development\usat\sql_code\21_recognized_membership_revenue\step_0_create_recognized_revenue_all_query_base_table.sql

function step_1_query_rev_recognition_data(created_at_mtn, created_at_utc) {
    return `
        -- GET PROFILES IDS TO USE IN THE NEXT QUERY; THIS ENSURES THE QUERY RETRIEVES ALL PROFILE ID HISTORY
        WITH get_n_profiles_ids AS (
            SELECT DISTINCT 
                id_profiles, id_membership_periods_sa, starts_mp, ends_mp
            FROM all_membership_sales_data_2015_left
            WHERE 1 = 1
                AND id_profiles NOT IN (0) -- 0 is a bad / invalid profile id based on dates et al
                AND ends_mp >= DATE_FORMAT(NOW(), '%Y-01-01') -- current year dynamically without needing to manually change the date each year
                -- AND ends_mp >= '2025-01-01'
            ORDER BY id_profiles, starts_mp
            -- LIMIT 100 OFFSET 0  -- Paginating on distinct profile IDs, not raw rows.
        )
        SELECT
            id_profiles,
            id_membership_periods_sa,
            
            real_membership_types_sa,
            new_member_category_6_sa,
            origin_flag_ma,
            
            created_at_mp AS created_at_mp,
            updated_at_mp AS updated_at_mp,
            purchased_on_date_mp,
            purchased_on_date_adjusted_mp,
            
            starts_mp,
            ends_mp,

            -- Standard difference (excludes the first partial month)
            TIMESTAMPDIFF(MONTH, starts_mp, ends_mp) AS total_months,

            -- Recursive-style logic (includes the start month)
            TIMESTAMPDIFF(MONTH, starts_mp, ends_mp) + 1 AS total_months_recursive,
            
            -- Flag if the prior period (previous start and end) is the same as the current period's start and end
            CASE
                WHEN starts_mp = LAG(starts_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) 
                    AND ends_mp = LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) 
                THEN 1 
                ELSE 0 
            END AS is_duplicate_previous_period,
            
            -- Flag if the current period overlaps with the previous one (start of current <= end of previous)
            CASE
                WHEN starts_mp <= LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp) THEN 1
                ELSE 0
            END AS is_overlaps_previous_mp,

            DATEDIFF(
                starts_mp,
                LAG(ends_mp) OVER (PARTITION BY id_profiles ORDER BY starts_mp)
            ) AS days_between_previous_end_and_start,
            
            CASE WHEN actual_membership_fee_6_sa <= 0 THEN 1 ELSE 0 END AS is_sales_revenue_zero,
            CASE WHEN origin_flag_ma = "ADMIN_BULK_UPLOADER" THEN 1 ELSE 0 END AS is_bulk,
    
            CASE WHEN new_member_category_6_sa LIKE "%Youth Premier%" THEN 1 ELSE 0 END AS is_youth_premier,
            CASE WHEN new_member_category_6_sa = 'Lifetime' THEN 1 ELSE 0 END AS is_lifetime,

            CASE 
                WHEN YEAR(created_at_mp) > YEAR(purchased_on_date_mp)
                    OR (
                        YEAR(created_at_mp) = YEAR(purchased_on_date_mp)
                        AND MONTH(created_at_mp) > MONTH(purchased_on_date_mp)
                    )
                THEN 1
                ELSE 0
            END AS has_created_at_gt_purchased_on,

            actual_membership_fee_6_rule_sa,
            actual_membership_fee_6_sa AS sales_revenue,
            1 AS sales_units,

            -- CREATED AT DATES
            -- DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'America/Denver'), '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            -- DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS created_at_utc

            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc
            
        FROM all_membership_sales_data_2015_left
        WHERE 1 = 1
            AND id_profiles IN (SELECT id_profiles FROM get_n_profiles_ids)
            -- AND id_profiles = @id_profile
            -- AND id_profiles BETWEEN 35 AND 50
        ORDER BY id_profiles, starts_mp
        ;
    `;
}

module.exports = {
    step_1_query_rev_recognition_data,
}
// SOURCE:
// C:\Users\calla\development\usat\sql_code\21_recognized_membership_revenue\step_0_create_recognized_revenue_base_table.sql

function step_1_query_rev_recognition_data() {
    return `
        SELECT
            id_profiles,
            id_membership_periods_sa,
            
            real_membership_types_sa,
            new_member_category_6_sa,
            origin_flag_ma,
            
            DATE(created_at_mp) AS created_at_date_mp,
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
            
            CASE WHEN sales_revenue <= 0 THEN 1 ELSE 0 END AS is_sales_revenue_zero,
            CASE WHEN DATE(created_at_date_mp) > purchased_on_date_mp THEN 1 ELSE 0 END AS has_created_at_gt_purchased_on,

            actual_membership_fee_6_rule_sa,
            sales_revenue,
            sales_units

            -- created at mp > purchased_on_date
            -- # of months from start to end 
            -- find an upgrade - meaning a member has both a silver and gold at the same time or bronze upgrade
            -- find a 13 month id
            -- find a 37 month id
            
        FROM sales_key_stats_2015
        WHERE 1 = 1
            -- AND id_profiles = @id_profile
            AND id_profiles BETWEEN 35 AND 50
        ORDER BY id_profiles, id_membership_periods_sa, starts_mp
        LIMIT 100
    ;
    `;
}

module.exports = {
    step_1_query_rev_recognition_data,
}
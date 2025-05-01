// SOURCE:
// C:\Users\calla\development\usat\sql_code\6h_actual_vs_goal_metrics\discovery_actual_vs_goal.sql

function step_1_sales_actual_v_goal_data() {
    return `
        -- CREATE ACTUAL VS GOAL DATA
        DROP TABLE IF EXISTS sales_data_actual_v_goal;

        -- GET CURRENT DATE IN MTN (MST OR MDT) & UTC
        SET @created_at_mtn = (         
            SELECT CASE 
                WHEN UTC_TIMESTAMP() >= DATE_ADD(
                        DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01'),
                            INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01')) + 1) % 7 + 7) DAY),
                        INTERVAL 2 HOUR)
                AND UTC_TIMESTAMP() < DATE_ADD(
                        DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01'),
                            INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01')) + 1) % 7) DAY),
                        INTERVAL 2 HOUR)
                THEN DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -6 HOUR), '%Y-%m-%d %H:%i:%s')
                ELSE DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -7 HOUR), '%Y-%m-%d %H:%i:%s')
                END
        );
        SET @created_at_utc = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s');

        CREATE TABLE sales_data_actual_v_goal AS
            WITH sales_actuals AS (
                SELECT
                    MONTH(common_purchased_on_date_adjusted) AS month_actual,
                    QUARTER(common_purchased_on_date_adjusted) AS quarter_actual,
                    YEAR(common_purchased_on_date_adjusted) AS year_actual,

                    -- is_current_month: 1 if the month and year match current date
                    CASE 
                        WHEN MONTH(common_purchased_on_date_adjusted) = MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_current_month,
                    
                    -- is_year_to_date: 1 if the date is in the same year and month <= current month
                    CASE 
                        WHEN MONTH(common_purchased_on_date_adjusted) <= MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_year_to_date,

                    real_membership_types_sa AS type_actual,
                    new_member_category_6_sa AS category_actual,

                    -- category sort order using both type_actual and category_actual
                    CASE
                        -- adult_annual
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = '1-Year $50' THEN 1
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = '3-Year' THEN 2
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Silver' THEN 3
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Gold' THEN 4
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Lifetime' THEN 5
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Platinum - Foundation' THEN 6
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Platinum - Team USA' THEN 7
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Young Adult - $36' THEN 8
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Young Adult - $40' THEN 9
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Unknown' THEN 10

                        -- elite
                        WHEN real_membership_types_sa = 'elite' AND new_member_category_6_sa = 'Elite' THEN 11
                        WHEN real_membership_types_sa = 'elite' AND new_member_category_6_sa = 'Unknown' THEN 12

                        -- one_day
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'One Day - $15' THEN 13
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Relay' THEN 14
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Sprint' THEN 15
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Intermediate' THEN 16
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Ultra' THEN 17
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - AO' THEN 18
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - $0' THEN 19
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Distance Upgrade' THEN 20
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Club' THEN 21
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Unknown' THEN 22

                        -- youth_annual
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Annual' THEN 23
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Premier - $25' THEN 24
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Premier - $30' THEN 25
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Unknown' THEN 26

                        ELSE 999
                    END AS category_sort_order_actual,

                    SUM(revenue_current) AS sales_rev_2025_actual,
                    SUM(revenue_prior) AS sales_rev_2024_actual,
                    SUM(units_current_year) AS sales_units_2025_actual,
                    SUM(units_prior_year) AS sales_units_2024_actual,

                    IF(SUM(units_current_year) = 0, 0, SUM(revenue_current) / SUM(units_current_year)) AS rev_per_unit_2025_actual,
                    IF(SUM(units_prior_year) = 0, 0, SUM(revenue_prior) / SUM(units_prior_year)) AS rev_per_unit_2024_actual

                FROM sales_data_year_over_year AS sa
                GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
            ),
            sales_goals AS (
                SELECT
                    purchased_on_month_adjusted_mp AS month_goal,
                    CASE 
                        WHEN purchased_on_month_adjusted_mp IN (1,2,3) THEN 1
                        WHEN purchased_on_month_adjusted_mp IN (4,5,6) THEN 2
                        WHEN purchased_on_month_adjusted_mp IN (7,8,9) THEN 3
                        ELSE 4
                    END as quarter_goal,
                    "2025" AS year_goal,

                    -- is_current_month: 1 if the month and year match current date
                    CASE 
                        WHEN purchased_on_month_adjusted_mp = MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_current_month,
                    
                    -- is_year_to_date: 1 if the date is in the same year and month <= current month
                    CASE 
                        WHEN purchased_on_month_adjusted_mp <= MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_year_to_date,

                    real_membership_types_sa AS type_goal,
                    new_member_category_6_sa AS category_goal,

                    -- category sort order using both type_actual and category_actual
                    CASE
                        -- adult_annual
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = '1-Year $50' THEN 1
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = '3-Year' THEN 2
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Silver' THEN 3
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Gold' THEN 4
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Lifetime' THEN 5
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Platinum - Foundation' THEN 6
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Platinum - Team USA' THEN 7
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Young Adult - $36' THEN 8
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Young Adult - $40' THEN 9
                        WHEN real_membership_types_sa = 'adult_annual' AND new_member_category_6_sa = 'Unknown' THEN 10

                        -- elite
                        WHEN real_membership_types_sa = 'elite' AND new_member_category_6_sa = 'Elite' THEN 11
                        WHEN real_membership_types_sa = 'elite' AND new_member_category_6_sa = 'Unknown' THEN 12

                        -- one_day
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'One Day - $15' THEN 13
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Relay' THEN 14
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Sprint' THEN 15
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Intermediate' THEN 16
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Ultra' THEN 17
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - AO' THEN 18
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - $0' THEN 19
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Bronze - Distance Upgrade' THEN 20
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Club' THEN 21
                        WHEN real_membership_types_sa = 'one_day' AND new_member_category_6_sa = 'Unknown' THEN 22

                        -- youth_annual
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Annual' THEN 23
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Premier - $25' THEN 24
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Youth Premier - $30' THEN 25
                        WHEN real_membership_types_sa = 'youth_annual' AND new_member_category_6_sa = 'Unknown' THEN 26

                        ELSE 999
                    END AS category_sort_order_goal,

                    
                    -- METRICS
                    SUM(sales_revenue) AS sales_rev_2025_goal,
                    SUM(revenue_2024) AS sales_rev_2024_goal,
                    SUM(sales_units) AS sales_units_2025_goal,
                    SUM(units_2024) AS sales_units_2024_goal,
                    
                    IF(SUM(sales_units) = 0, 0, SUM(sales_revenue) / SUM(sales_units)) AS rev_per_unit_2025_goal,
                    IF(SUM(units_2024) = 0, 0, SUM(revenue_2024) / SUM(units_2024)) AS rev_per_unit_2024_goal

                FROM sales_goal_data AS sg
                GROUP BY 1, 2, 3, 4, 5, 6, 7
                -- ORDER BY 1

                UNION ALL

                -- Add a row for Unknown category per month/type since unknown doesn't exist in goals but might for actual (as it does for 3/2025 & 4/2025)
                SELECT
                    purchased_on_month_adjusted_mp AS month_goal,
                    CASE 
                        WHEN purchased_on_month_adjusted_mp IN (1,2,3) THEN 1
                        WHEN purchased_on_month_adjusted_mp IN (4,5,6) THEN 2
                        WHEN purchased_on_month_adjusted_mp IN (7,8,9) THEN 3
                        ELSE 4
                    END AS quarter_goal,
                    "2025" AS year_goal,

                    -- is_current_month: 1 if the month and year match current date
                    CASE 
                        WHEN purchased_on_month_adjusted_mp = MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_current_month,
                    
                    -- is_year_to_date: 1 if the date is in the same year and month <= current month
                    CASE 
                        WHEN purchased_on_month_adjusted_mp <= MONTH(CURRENT_DATE) THEN 1 
                        ELSE 0
                    END AS is_year_to_date,

                    real_membership_types_sa AS type_goal,
                    'Unknown' AS category_goal,

                    -- category sort order using both type_actual and category_actual
                    "" AS category_sort_order_goal,

                    0 AS sales_rev_2025_goal,
                    0 AS sales_rev_2024_goal,
                    0 AS sales_units_2025_goal,
                    0 AS sales_units_2024_goal,
                    0 AS rev_per_unit_2025_goal,
                    0 AS rev_per_unit_2024_goal

                FROM sales_goal_data
                GROUP BY 1, 2, 3, 4, 5, 6, 7
            )
            -- SELECT * FROM sales_actuals
            SELECT
                -- SALES GOAL DATA
                sg.month_goal,

                sg.type_goal,
                sg.category_goal,

                sg.sales_rev_2025_goal,
                sg.sales_rev_2024_goal,
                sg.sales_units_2025_goal,
                sg.sales_units_2024_goal,
                sg.rev_per_unit_2025_goal,
                sg.rev_per_unit_2024_goal,
                
                -- SALES ACTUAL DATA
                IFNULL(sa.month_actual, sg.month_goal) AS month_actual,
                IFNULL(sa.quarter_actual, sg.quarter_goal) AS quarter_actual,
                IFNULL(sa.year_actual, sg.year_goal) as year_actual,

                IFNULL(sa.is_current_month, sg.is_current_month) AS is_current_month,
                IFNULL(sa.is_year_to_date, sg.is_year_to_date) AS is_year_to_date,

                -- SEGMENTS
                IFNULL(sa.type_actual, sg.type_goal) AS type_actual,
                IFNULL(sa.category_actual, sg.category_goal) AS category_actual,
                IFNULL(sa.category_sort_order_actual, sg.category_sort_order_goal) AS category_sort_order_actual,

                -- METRICS
                IFNULL(sa.sales_rev_2025_actual, 0) AS sales_rev_2025_actual,
                IFNULL(sa.sales_rev_2024_actual, 0) AS sales_rev_2024_actual,
                IFNULL(sa.sales_units_2025_actual, 0) AS sales_units_2025_actual,
                IFNULL(sa.sales_units_2024_actual, 0) AS sales_units_2024_actual,
                IFNULL(sa.rev_per_unit_2025_actual, 0) AS rev_per_unit_2025_actual,
                IFNULL(sa.rev_per_unit_2024_actual, 0) AS rev_per_unit_2024_actual,
                
                -- ABSOLUTE DIFFERENCE = GOAL VS 2025 ACTUALS
                IFNULL(sa.sales_rev_2025_actual - sg.sales_rev_2025_goal, 0) AS goal_v_actual_rev_diff_abs,
                IFNULL(sa.sales_units_2025_actual - sg.sales_units_2025_goal, 0) AS goal_v_actual_units_diff_abs,
                IFNULL(sa.rev_per_unit_2025_actual - sg.rev_per_unit_2025_goal, 0) AS goal_v_actual_rev_per_unit_diff_abs,
                
                -- ABSOLUTE DIFFERENCE = 2025 ACTUALS VS 2024 ACTUALS
                IFNULL(sa.sales_rev_2025_actual  - sa.sales_rev_2024_actual, 0) AS "2025_v_2024_rev_diff_abs",
                IFNULL(sa.sales_units_2025_actual - sa.sales_units_2024_actual, 0) AS "2025_v_2024_units_diff_abs",
                IFNULL(sa.rev_per_unit_2025_actual - sa.rev_per_unit_2024_actual, 0) AS "2025_v_2024_rev_per_unit_diff_abs",
                
                -- Created at timestamps:
                @created_at_mtn AS created_at_mtn,
                @created_at_utc AS created_at_utc
                
            FROM sales_goals AS sg
                LEFT JOIN sales_actuals AS sa ON sg.month_goal = sa.month_actual
                    AND sg.type_goal = sa.type_actual
                    AND sg.category_goal = sa.category_actual

            -- This clause preserves everything except when: (a) The goal is "Unknown", and (b) The actual data shows no meaningful performance (0 revenue and 0 units).
            WHERE 1 = 1
                AND NOT (
                    sg.category_goal = 'Unknown'
                    AND (sa.sales_rev_2025_actual = 0 AND sa.sales_units_2025_actual = 0)
                )
            ORDER BY month_goal, category_sort_order_actual
        ;
    `;
}

module.exports = {
    step_1_sales_actual_v_goal_data,
}
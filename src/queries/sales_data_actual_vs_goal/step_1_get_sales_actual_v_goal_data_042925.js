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
                real_membership_types_sa AS type_actual,
                new_member_category_6_sa AS category_actual,
                SUM(revenue_current) AS sales_rev_2025_actual,
                SUM(revenue_prior) AS sales_rev_2024_actual,
                SUM(units_current_year) AS sales_units_2025_actual,
                SUM(units_prior_year) AS sales_units_2024_actual,

                IF(SUM(units_current_year) = 0, 0, SUM(revenue_current) / SUM(units_current_year)) AS rev_per_unit_2025_actual,
                IF(SUM(units_prior_year) = 0, 0, SUM(revenue_prior) / SUM(units_prior_year)) AS rev_per_unit_2024_actual

            FROM sales_data_year_over_year AS sa
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY 1
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
                2025 AS year_goal,

                real_membership_types_sa AS type_goal,
                new_member_category_6_sa AS category_goal,
                SUM(sales_revenue) AS sales_rev_2025_goal,
                SUM(revenue_2024) AS sales_rev_2024_goal,
                SUM(sales_units) AS sales_units_2025_goal,
                SUM(units_2024) AS sales_units_2024_goal,
                
                IF(SUM(sales_units) = 0, 0, SUM(sales_revenue) / SUM(sales_units)) AS rev_per_unit_2025_goal,
                IF(SUM(units_2024) = 0, 0, SUM(revenue_2024) / SUM(units_2024)) AS rev_per_unit_2024_goal

            FROM sales_goal_data AS sg
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY 1
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
            CASE WHEN sa.month_actual IS NULL THEN sg.month_goal ELSE sa.month_actual END AS month_actual,
            CASE WHEN sa.quarter_actual IS NULL THEN sg.quarter_goal ELSE sa.quarter_actual END AS quarter_actual,
            CASE WHEN sa.year_actual IS NULL THEN sg.year_goal ELSE sa.year_actual END AS year_actual,

            CASE WHEN sa.type_actual IS NULL THEN sg.type_goal ELSE sa.type_actual END AS type_actual,
            CASE WHEN sa.category_actual IS NULL THEN sg.category_goal ELSE sa.category_actual END AS category_actual,

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
        -- WHERE sg.month_goal = 2
        ;
    `;
}

module.exports = {
    step_1_sales_actual_v_goal_data,
}
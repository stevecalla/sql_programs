// SOURCE:
// C:\Users\calla\development\usat\sql_code\6g_year_over_year_metrics\discovery_year_over_year_common_date_011425.sql

function step_1_sales_year_over_year_data() {
    return `
        -- STEP #1 = CREATE YEAR OVER YEAR TABLE
        DROP TABLE IF EXISTS sales_data_year_over_year
        
        SET @current_year_date = CURDATE();
        SET @prior_year_date = @current_year_date - INTERVAL 1 YEAR;

        CREATE TABLE sales_data_year_over_year AS
            WITH all_data AS (
                SELECT
                    purchased_on_date_adjusted_mp AS current_year_date,
                    NULL AS prior_year_date,
                    purchased_on_date_adjusted_mp AS common_date,
                    real_membership_types_sa,
                    new_member_category_6_sa,
                    origin_flag_ma,
                    origin_flag_category,
                    member_created_at_category,
                    SUM(sales_revenue) AS current_revenue,
                    NULL AS prior_revenue,
                    SUM(sales_units) AS current_units,
                    NULL AS prior_units,
                    SUM(sales_revenue) / NULLIF(SUM(sales_units), 0) AS current_revenue_per_unit,
                    NULL AS prior_revenue_per_unit
                FROM usat_sales_db.sales_key_stats_2015
                WHERE 
                    purchased_on_date_adjusted_mp >= DATE_FORMAT(@current_year_date, '%Y-%m-01') 
                    AND purchased_on_date_adjusted_mp <= @current_year_date - INTERVAL 1 DAY
                GROUP BY purchased_on_date_adjusted_mp, 
                        real_membership_types_sa, 
                        new_member_category_6_sa, 
                        origin_flag_ma, 
                        origin_flag_category, 
                        member_created_at_category
                UNION ALL
                SELECT
                    NULL AS current_year_date,
                    purchased_on_date_adjusted_mp AS prior_year_date,
                    DATE_ADD(purchased_on_date_adjusted_mp, INTERVAL 1 YEAR) AS common_date,
                    real_membership_types_sa,
                    new_member_category_6_sa,
                    origin_flag_ma,
                    origin_flag_category,
                    member_created_at_category,
                    NULL AS current_revenue,
                    SUM(sales_revenue) AS prior_revenue,
                    NULL AS current_units,
                    SUM(sales_units) AS prior_units,
                    NULL AS current_revenue_per_unit,
                    SUM(sales_revenue) / NULLIF(SUM(sales_units), 0) AS prior_revenue_per_unit
                FROM usat_sales_db.sales_key_stats_2015
                WHERE 
                    purchased_on_date_adjusted_mp >= DATE_FORMAT(@prior_year_date, '%Y-%m-01') 
                    AND purchased_on_date_adjusted_mp <= @prior_year_date - INTERVAL 1 DAY
                GROUP BY purchased_on_date_adjusted_mp, 
                        real_membership_types_sa, 
                        new_member_category_6_sa, 
                        origin_flag_ma, 
                        origin_flag_category, 
                        member_created_at_category
            ),
            combined_data AS (
                SELECT
                    common_date AS common_purchased_on_date_adjusted,
                    CONCAT(
                        CASE DAYNAME(MAX(current_year_date))
                            WHEN 'Monday' THEN 'M'
                            WHEN 'Wednesday' THEN 'W'
                            WHEN 'Friday' THEN 'F'
                            ELSE UPPER(LEFT(DAYNAME(MAX(current_year_date)), 2))
                        END,
                        MAX(current_year_date),
                        '_v_',
                        CASE DAYNAME(MAX(prior_year_date))
                            WHEN 'Monday' THEN 'M'
                            WHEN 'Wednesday' THEN 'W'
                            WHEN 'Friday' THEN 'F'
                            ELSE UPPER(LEFT(DAYNAME(MAX(prior_year_date)), 2))
                        END,
                        MAX(prior_year_date)
                    ) AS combined_date_field,
                    MAX(current_year_date) AS current_year_date,
                    DAYNAME(MAX(current_year_date)) AS current_year_day_of_week,
                    MAX(prior_year_date) AS prior_year_date,
                    DAYNAME(MAX(prior_year_date)) AS prior_year_day_of_week,
                    real_membership_types_sa,
                    new_member_category_6_sa,
                    origin_flag_ma,
                    origin_flag_category,
                    member_created_at_category,
                    SUM(current_revenue) AS revenue_current,
                    SUM(prior_revenue) AS revenue_prior,
                    SUM(current_revenue) - SUM(prior_revenue) AS revenue_diff_abs,
                    CASE 
                        WHEN SUM(prior_revenue) = 0 THEN NULL
                        ELSE (SUM(current_revenue) - SUM(prior_revenue)) / SUM(prior_revenue) * 100
                    END AS revenue_diff_pct,
                    SUM(current_units) AS units_current_year,
                    SUM(prior_units) AS units_prior_year,
                    SUM(current_units) - SUM(prior_units) AS units_diff_abs,
                    CASE 
                        WHEN SUM(prior_units) = 0 THEN NULL
                        ELSE (SUM(current_units) - SUM(prior_units)) / SUM(prior_units) * 100
                    END AS units_diff_pct,
                    CURDATE() AS created_at_date
                FROM all_data
                GROUP BY 
                    common_date,
                    real_membership_types_sa, 
                    new_member_category_6_sa, 
                    origin_flag_ma, 
                    origin_flag_category, 
                    member_created_at_category
            )
            SELECT *
            FROM combined_data
            ORDER BY common_purchased_on_date_adjusted, real_membership_types_sa, new_member_category_6_sa, origin_flag_ma, origin_flag_category, member_created_at_category;

            -- SELECT SUM(current_revenue), SUM(prior_revenue), COUNT(*) FROM all_data
            ;
            -- *********************************************
    `;
}

module.exports = {
    step_1_sales_year_over_year_data,
}
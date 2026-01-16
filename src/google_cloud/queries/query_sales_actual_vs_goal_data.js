async function query_sales_actual_vs_goal_data(batch_size = 10, offset = 0, from_table_name) {
    return `
        SELECT 
            -- SALES GOAL DATA
            year_goal,
            month_goal,

            type_goal,
            category_goal,

            sales_rev_2025_goal,
            sales_rev_2024_goal,
            sales_units_2025_goal,
            sales_units_2024_goal,
            rev_per_unit_2025_goal,
            rev_per_unit_2024_goal,
            
            -- SALES ACTUAL DATA
            month_actual,
            quarter_actual,
            year_actual,

            is_current_month,
            is_year_to_date,

            -- SEGMENTS
            type_actual,
            category_actual,
            category_sort_order_actual,
            
            -- METRICS
            sales_rev_2025_actual,
            sales_rev_2024_actual,
            sales_units_2025_actual,
            sales_units_2024_actual,
            rev_per_unit_2025_actual,
            rev_per_unit_2024_actual,
            
            -- ABSOLUTE DIFFERENCE = GOAL VS 2025 ACTUALS
            goal_v_actual_rev_diff_abs,
            goal_v_actual_units_diff_abs,
            goal_v_actual_rev_per_unit_diff_abs,
            
            -- ABSOLUTE DIFFERENCE = 2025 ACTUALS VS 2024 ACTUALS
            2025_v_2024_rev_diff_abs,
            2025_v_2024_units_diff_abs,
            2025_v_2024_rev_per_unit_diff_abs,

            -- Created at timestamps:
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        -- FROM usat_sales_db.sales_data_actual_v_goal
        FROM usat_sales_db.${from_table_name}

        ORDER BY year_actual, quarter_actual, month_actual
        
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 100
        ;
    `;
};

module.exports = {
    query_sales_actual_vs_goal_data,
}
const { 
    step_1_sales_actual_v_goal_data, 
    step_2_query_join_sales_actual_vs_goal_2025_2026_tables, 
    step_3_query_drop_table 
} = require('./step_1_get_sales_actual_v_goal_data_042925');

async function query_step_0_actual_v_goal_data_master_logic() {
    const query_list = [
        step_1_sales_actual_v_goal_data, // create 2025 table
        step_1_sales_actual_v_goal_data, // create 2026 table

        step_2_query_join_sales_actual_vs_goal_2025_2026_tables, // join 2025 & 2026 table from above
        
        step_3_query_drop_table, // drop 2025
        step_3_query_drop_table, // drop 2026
    ]
    return query_list;
}

module.exports = {
    query_step_0_actual_v_goal_data_master_logic,
}
const { step_1_sales_actual_v_goal_data } = require('./step_1_get_sales_actual_v_goal_data_042925'); // step 1

async function query_step_0_actual_v_goal_data_master_logic() {
    const query_list = [
        step_1_sales_actual_v_goal_data, // create 2025 table
        step_1_sales_actual_v_goal_data, // create 2026 table
    ]
    return query_list;
}

module.exports = {
    query_step_0_actual_v_goal_data_master_logic,
}
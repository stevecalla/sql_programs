const { step_1_sales_year_over_year_data } = require('./step_1_get_sales_year_over_year_data_011425'); // step 1

async function query_step_0_year_over_year_data_master_logic() {
    const query_list = [
        step_1_sales_year_over_year_data,
    ]
    return query_list;
}

module.exports = {
    query_step_0_year_over_year_data_master_logic,
}
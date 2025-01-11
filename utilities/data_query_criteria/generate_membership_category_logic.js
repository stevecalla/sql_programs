const { query_one_day_sales_units_logic } = require('../../src/queries/sales_data/5b_one_day_sales_units_logic');
const { query_annual_sales_units_logic } = require('../../src/queries/sales_data/5c_annual_sales_units_logic');
const { query_coaches_sales_units_logic } = require('../../src/queries/sales_data/5d_coaches_sales_units_logic');

const generate_membership_category_logic = [
    {
        query: query_coaches_sales_units_logic,
        file_name: 'coaches_sales_units',
    },            
    {
        query: query_annual_sales_units_logic,
        file_name: 'annual_sales_units',
    },
    {
        query: query_one_day_sales_units_logic,
        file_name: 'one_day_sales_units',
    },
];

module.exports = {
    generate_membership_category_logic,
};
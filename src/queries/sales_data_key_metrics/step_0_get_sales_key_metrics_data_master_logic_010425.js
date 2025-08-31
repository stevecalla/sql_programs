const { step_0a_create_updated_at_data } = require('./step_0a_create_updated_at_data_082925');

const { step_1_member_minimum_first_created_at_dates } = require('./step_1_get_sales_data_010425'); // step 1
const { step_2_member_min_created_at_date } = require('./step_2_get_sales_data_010425'); // step 2
const { step_3_member_total_life_time_purchases } = require('./step_3_get_sales_data_010425'); // step 3
const { step_4_member_age_dimensions } = require('./step_4_get_sales_data_010425'); // step 4
const { step_5_member_age_at_sale_date } = require('./step_5_get_sales_data_010425'); // step 5
const { step_5a_member_age_at_end_of_year_of_sale } = require('./step_5a_get_sales_data_010425'); // step 5a
const { step_6_membership_period_stats } = require('./step_6_get_sales_data_010425'); // step 6
const { step_7_prior_purchase } = require('./step_7_get_sales_data_010425'); // step 7

const { step_8_sales_key_stats_2015, step_8_sales_key_stats_2015_upsert } = require('./step_8_get_sales_data_010425'); // step 8
const { step_8b_create_indexes } = require('./step_8b_get_sales_data_010425_indexes'); // step 8a

function step_noop() { return `DO 0`; }; // empty sql statement to provide dummy query

async function query_step_0_sales_key_metrics_master_logic(update_mode) {

    const query_list = [
        // step_0a_create_updated_at_data,

        // #0a doesn't need to run on full table replacement; added 8/29/25
        update_mode === 'full' ? step_noop                      : step_0a_create_updated_at_data,  

        step_1_member_minimum_first_created_at_dates,            // #1 Query results: 1664164, Elapsed Time: 332.76 sec
        step_2_member_min_created_at_date,                       // #2 Query results: 1664164, Elapsed Time: 88.19 sec
        step_3_member_total_life_time_purchases,                 // #3 Query results: 1664164, Elapsed Time: 120.10 sec
        step_4_member_age_dimensions,                            // #4 Query results: 1664164, Elapsed Time: 142.50 sec
        step_5_member_age_at_sale_date,                          // #5 Query results: 3831769, Elapsed Time: 95.02 sec
        step_5a_member_age_at_end_of_year_of_sale,               // #5a Query results: 3831769, Elapsed Time: 98.80 sec
        step_6_membership_period_stats,                          // #6 Query results: 3831769, Elapsed Time: 349.92 sec

        step_7_prior_purchase,                                   // #7 Query results: undefined, Elapsed Time: 840.97 sec

        // #8 / #8b on full drop & create table; on partial or updated_at upsert
        update_mode === 'full' ? step_8_sales_key_stats_2015    : step_8_sales_key_stats_2015_upsert,   // #8 Query results: 3831769, Elapsed Time: 2560.93 sec
        update_mode === 'full' ? step_8b_create_indexes         : step_noop,                            // #8b Query results: undefined, Elapsed Time: 2483.21 sec
    ]
    return query_list;
}

module.exports = {
    query_step_0_sales_key_metrics_master_logic,
}
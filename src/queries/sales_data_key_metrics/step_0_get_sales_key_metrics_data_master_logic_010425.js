const { step_1_member_minimum_first_created_at_dates } = require('./step_1_get_sales_data_010425'); // step 1
const { step_2_member_min_created_at_date } = require('./step_2_get_sales_data_010425'); // step 2
const { step_3_member_total_life_time_purchases } = require('./step_3_get_sales_data_010425'); // step 3
const { step_4_member_age_dimensions } = require('./step_4_get_sales_data_010425'); // step 4
const { step_5_member_age_at_sale_date } = require('./step_5_get_sales_data_010425'); // step 5
const { step_5a_member_age_at_end_of_year_of_sale } = require('./step_5a_get_sales_data_010425'); // step 5a
const { step_6_membership_period_stats } = require('./step_6_get_sales_data_010425'); // step 6
const { step_7_prior_purchase } = require('./step_7_get_sales_data_010425'); // step 7
const { step_8_sales_key_stats_2015 } = require('./step_8_get_sales_data_010425'); // step 8
const { step_8a_create_indexes} = require('./step_8a_get_sales_data_010425'); // step 8a

async function query_step_0_sales_key_metrics_master_logic() {
    const query_list = [
        step_1_member_minimum_first_created_at_dates, // #1 done 2:56, 1,621,815
        // step_2_member_min_created_at_date, // #2 done 1:10, 1,621,815
        // step_3_member_total_life_time_purchases, // #3 1:32, 1,621,815
        // step_4_member_age_dimensions, // #4 2:37, 1,621,815
        // step_5_member_age_at_sale_date, // #5 3:17, 3649353
        // step_5a_member_age_at_end_of_year_of_sale, // #6 3:10, 3649353
        // step_6_membership_period_stats, // #7 6:48, 3649353
        // step_7_prior_purchase, // #8 00:17:00... Query results: 3649353
        // step_8_sales_key_stats_2015, // #9 Timer: 00:18:03...Query results: 3649353
        // step_8a_create_indexes, //#10  Timer: 00:16:35...Query results: 0
    ]
    return query_list;
}

module.exports = {
    query_step_0_sales_key_metrics_master_logic,
}
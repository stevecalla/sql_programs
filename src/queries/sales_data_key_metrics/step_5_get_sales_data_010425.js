// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5_member_age_at_sale_date() {
    return `
        -- STEP #5 = CREATE MEMBER AGE AT SALE DATE TABLE
        DROP TABLE IF EXISTS step_5_member_age_at_sale_date;

        CREATE TABLE step_5_member_age_at_sale_date AS
            SELECT
                am.id_profiles,
                am.id_membership_periods_sa,
                
                (
                    YEAR(purchased_on_adjusted_mp) - YEAR(am.date_of_birth_profiles)) - 
                    (DATE_FORMAT(am.purchased_on_adjusted_mp, '%m%d') 
                    < DATE_FORMAT(am.date_of_birth_profiles, '%m%d')
                )   
                AS age_as_of_sale_date -- create age of of sale date

            FROM all_membership_sales_data_2015_left as am
            GROUP BY am.id_profiles, am.id_membership_periods_sa 
        ;

        -- *********************************************
    `;
}

module.exports = {
    step_5_member_age_at_sale_date,
}
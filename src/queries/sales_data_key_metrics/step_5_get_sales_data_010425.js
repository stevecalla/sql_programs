// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5_member_age_at_sale_date() {
    return `
        -- STEP #5 = CREATE MEMBER AGE AT SALE DATE TABLE
        DROP TABLE IF EXISTS step_5_member_age_at_sale_date;

        CREATE TABLE step_5_member_age_at_sale_date AS
            SELECT
                am.id_profiles,
                -- am.member_number_members_sa,
                am.id_membership_periods_sa,
                
                (
                    YEAR(MAX(purchased_on_adjusted_mp)) - YEAR(MAX(am.date_of_birth_profiles))) - 
                    (DATE_FORMAT(MAX(am.purchased_on_adjusted_mp), '%m%d') 
                    < DATE_FORMAT(MAX(am.date_of_birth_profiles), '%m%d')
                )   
                AS age_as_of_sale_date -- create age of of sale date

            FROM all_membership_sales_data_2015_left as am
            -- GROUP BY am.member_number_members_sa, am.id_membership_periods_sa 
            GROUP BY am.id_profiles, am.id_membership_periods_sa 
        ;

        ALTER TABLE step_5_member_age_at_sale_date              
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

module.exports = {
    step_5_member_age_at_sale_date,
}
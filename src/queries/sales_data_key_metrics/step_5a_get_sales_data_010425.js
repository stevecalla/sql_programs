// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5a_member_age_at_end_of_year_of_sale() {
    return `
        -- STEP #5a = CREATE AGE AT THE END OF EACH YEAR OF THE DATE OF SALE -- TODO: done 101 secs
        DROP TABLE IF EXISTS step_5a_member_age_at_end_of_year_of_sale;

            CREATE TABLE step_5a_member_age_at_end_of_year_of_sale AS
                SELECT
                    am.id_profiles,
                    -- am.member_number_members_sa,
                    am.id_membership_periods_sa,
                    
                    (
                        YEAR(MAX(am.purchased_on_adjusted_mp))
                        - YEAR(MAX(am.date_of_birth_profiles))) 
                        - (DATE_FORMAT(STR_TO_DATE(CONCAT(YEAR(MAX(am.purchased_on_adjusted_mp)), '-12-31'), '%Y-%m-%d'), '%m%d') 
                        < DATE_FORMAT(MAX(am.date_of_birth_profiles), '%m%d')
                    ) AS age_at_end_of_year

                FROM all_membership_sales_data_2015_left AS am
                -- GROUP BY  am.member_number_members_sa, am.id_membership_periods_sa
                GROUP BY am.id_profiles, am.id_membership_periods_sa
            ; 


        ALTER TABLE step_5a_member_age_at_end_of_year_of_sale   
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

module.exports = {
    step_5a_member_age_at_end_of_year_of_sale,
}
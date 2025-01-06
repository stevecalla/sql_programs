// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5a_member_age_at_end_of_year_of_sale() {
    return `
        -- STEP #5a = CREATE AGE AT THE END OF EACH YEAR OF THE DATE OF SALE -- TODO: done 101 secs
        DROP TABLE IF EXISTS step_5a_member_age_at_end_of_year_of_sale;

            CREATE TABLE step_5a_member_age_at_end_of_year_of_sale AS
                SELECT
                    am.member_number_members_sa,
                    am.id_membership_periods_sa,
                    
                    (YEAR(am.purchased_on_adjusted_mp) - YEAR(am.date_of_birth_profiles)) - 
                    (DATE_FORMAT(STR_TO_DATE(CONCAT(YEAR(am.purchased_on_adjusted_mp), '-12-31'), '%Y-%m-%d'), '%m%d') < DATE_FORMAT(am.date_of_birth_profiles, '%m%d')) AS age_at_end_of_year

                FROM all_membership_sales_data_2015_left AS am
                GROUP BY 1, 2;
                
            -- CREATE INDEX idx_member_number_members_sa ON step_5a_member_age_at_end_of_year_of_sale (member_number_members_sa);
            -- CREATE INDEX idx_id_membership_periods_sa ON step_5a_member_age_at_end_of_year_of_sale (id_membership_periods_sa);
            -- CREATE INDEX idx_age_at_end_of_year ON step_5a_member_age_at_end_of_year_of_sale (age_at_end_of_year);
        -- *********************************************
    `;
}

module.exports = {
    step_5a_member_age_at_end_of_year_of_sale,
}
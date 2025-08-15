// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_1_member_minimum_first_created_at_dates() {
    return `
        -- STEP #1 = CREATE MINIMUM FIRST CREATED AT DATES TABLE -- TODO: DONE 90 SECS
        DROP TABLE IF EXISTS step_1_member_minimum_first_created_at_dates;

            CREATE TABLE step_1_member_minimum_first_created_at_dates AS
                SELECT 
                    id_profiles,

                    MIN(created_at_members) AS first_created_at_members,
                    MIN(created_at_mp) AS first_created_at_mp,
                    MIN(created_at_profiles) AS first_created_at_profiles,
                    MIN(created_at_users) AS first_created_at_users,
                    MIN(purchased_on_adjusted_mp) AS first_purchased_on_adjusted_mp,
                    MIN(starts_mp) AS first_starts_mp,

                    YEAR(MIN(purchased_on_adjusted_mp)) AS first_purchased_on_year_adjusted_mp

                FROM all_membership_sales_data_2015_left
                GROUP BY id_profiles
            ;
                
                -- CREATE INDEX idx_member_number_members_sa ON step_1_member_minimum_first_created_at_dates (member_number_members_sa);
                -- CREATE INDEX idx_first_purchased_on_year_adjusted_mp ON step_1_member_minimum_first_created_at_dates (first_purchased_on_year_adjusted_mp);
        -- *********************************************
    `;
}

module.exports = {
    step_1_member_minimum_first_created_at_dates,
}
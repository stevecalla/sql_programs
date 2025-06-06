// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_2_member_min_created_at_date() {
    return `
    -- STEP #2 = CREATE MIN CREATED AT DATE TABLE -- TODO: DONE 26 SECS
    DROP TABLE IF EXISTS step_2_member_min_created_at_date;

        CREATE TABLE step_2_member_min_created_at_date AS
            SELECT 
                member_number_members_sa,

                -- Calculate the minimum date from the first created at fields, considering nulls
                LEAST(
                    COALESCE(first_created_at_members, '9999-12-31'),
                    COALESCE(first_created_at_mp, '9999-12-31'),
                    COALESCE(first_created_at_profiles, '9999-12-31'),
                    COALESCE(first_created_at_users, '9999-12-31'),
                    COALESCE(first_purchased_on_adjusted_mp, '9999-12-31'),
                    COALESCE(first_starts_mp, '9999-12-31')
                ) AS min_created_at

            FROM step_1_member_minimum_first_created_at_dates;
            
            -- CREATE INDEX idx_member_number_members_sa ON step_2_member_min_created_at_date (member_number_members_sa);
            -- CREATE INDEX idx_min_created_at ON step_2_member_min_created_at_date (min_created_at);
    -- ********************************************* 
    `;
}

module.exports = {
    step_2_member_min_created_at_date,
}
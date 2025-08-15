// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_4_member_age_dimensions() {
    return `
        -- STEP #4 = CREATE AGE NOW TABLE -- TODO: done 92
        DROP TABLE IF EXISTS step_4_member_age_dimensions;

            CREATE TABLE step_4_member_age_dimensions AS
                SELECT
                    id_profiles,

                    (YEAR(CURDATE()) - YEAR(date_of_birth_profiles)) - (DATE_FORMAT(CURDATE(), '%m%d') < DATE_FORMAT(date_of_birth_profiles, '%m%d')) AS age_now, -- create age as of now,
                    MIN(date_of_birth_profiles) AS date_of_birth_profiles

                FROM all_membership_sales_data_2015_left
                GROUP BY id_profiles, 2
            ;

                -- CREATE INDEX idx_member_number_members_sa ON step_4_member_age_dimensions (member_number_members_sa);
                -- CREATE INDEX idx_date_of_birth_profiles ON step_4_member_age_dimensions (date_of_birth_profiles);
        -- *********************************************
    `;
}

module.exports = {
    step_4_member_age_dimensions,
}
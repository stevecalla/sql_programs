// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_2_member_min_created_at_date() {
    return `
        -- STEP #2 = CREATE MIN CREATED AT DATE TABLE
        DROP TABLE IF EXISTS step_2_member_min_created_at_date;

            CREATE TABLE step_2_member_min_created_at_date AS
                SELECT 
                    -- member_number_members_sa,
                    id_profiles,

                    -- Calculate the minimum date from the first created at fields, considering nulls
                    LEAST(
                        COALESCE(first_created_at_members, '9999-12-31'),
                        COALESCE(first_created_at_mp, '9999-12-31'),
                        COALESCE(first_created_at_profiles, '9999-12-31'),
                        COALESCE(first_created_at_users, '9999-12-31'),
                        COALESCE(first_purchased_on_adjusted_mp, '9999-12-31'),
                        COALESCE(first_starts_mp, '9999-12-31')
                    ) AS min_created_at

                FROM step_1_member_minimum_first_created_at_dates
            ;

        ALTER TABLE step_2_member_min_created_at_date
            ADD INDEX (id_profiles);
        -- ********************************************* 
    `;
}

module.exports = {
    step_2_member_min_created_at_date,
}
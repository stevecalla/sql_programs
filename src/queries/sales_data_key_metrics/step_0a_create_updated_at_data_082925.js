// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_0a_created_updated_at_data() {
    return `
        -- STEP #0a = CREATE UPDATED AT DATA TABLE
        DROP TABLE IF EXISTS step_0a_created_updated_at_data;

            CREATE TABLE step_0a_created_updated_at_data AS
                WITH updated_profiles AS (
                    -- Finds the set of profile IDs that were touched since the where date indicated
                    SELECT DISTINCT id_profiles
                    FROM all_membership_sales_data_2015_left
                    WHERE 1 = 1
                        AND (
                            updated_at_mp           >= CURDATE() - INTERVAL 1 DAY
                            OR updated_at_members   >= CURDATE() - INTERVAL 1 DAY
                            OR updated_at_profiles  >= CURDATE() - INTERVAL 1 DAY
                        )
                )
                    -- Finds all records with id_profile from updated_profiles cte
                    , all_joined_profile_records AS (
                        SELECT t.*
                        FROM all_membership_sales_data_2015_left AS t
                            JOIN updated_profiles AS up USING (id_profiles)
                    )
                    SELECT * FROM all_joined_profile_records ORDER BY id_profiles, id_membership_periods_sa
                    -- SELECT
                    --   (SELECT FORMAT(COUNT(*), 0) FROM updated_profiles)                   		AS total_updated_profiles,
                    --   (SELECT FORMAT(COUNT(*), 0) FROM all_joined_profile_records)             	AS total_joined_rows,
                    --   (SELECT FORMAT(COUNT(*), 0) FROM all_membership_sales_data_2015_left) 	AS total_all_records                
            ;

            ALTER TABLE step_0a_created_updated_at_data ADD INDEX (id_profiles);     
        -- *********************************************
    `;
}

module.exports = {
    step_0a_created_updated_at_data,
}
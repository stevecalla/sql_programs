// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_0a_create_updated_at_data(FROM_STATEMENT, pool, update_mode, options) {
    
    let { TABLE_NAME, membership_period_ends, start_year_mtn, start_date_mtn, end_date_mtn, updated_at_date_mtn } = options;

    const WHERE_STATEMENT = 
        (update_mode === 'partial') ? `
                AND purchased_on_mp >= '${start_date_mtn}'
                AND purchased_on_mp <= '${end_date_mtn}'
        ` : `
                AND (
                    updated_at_mp           >= '${updated_at_date_mtn}'
                    OR updated_at_members   >= '${updated_at_date_mtn}'
                    OR updated_at_profiles  >= '${updated_at_date_mtn}'
                )
        `
    ;

    const DEST_TABLE_NAME = `step_0a_create_updated_at_data`;

    const query = `
        -- STEP #0a = CREATE UPDATED AT DATA TABLE
        DROP TABLE IF EXISTS ${DEST_TABLE_NAME};

        CREATE TABLE ${DEST_TABLE_NAME} AS
            WITH updated_profiles AS (

                -- FINDS THE SET OF PROFILE IDS BASED ON THE WHERE STATEMENT
                SELECT DISTINCT 
                    id_profiles
                FROM ${TABLE_NAME}
                WHERE 1 = 1
                    ${WHERE_STATEMENT}
                    -- AND (
                    --     updated_at_mp            >= CURDATE() - INTERVAL 1 DAY
                    --     OR updated_at_members    >= CURDATE() - INTERVAL 1 DAY
                    --     OR updated_at_profiles   >= CURDATE() - INTERVAL 1 DAY
                    -- )
            )

                -- FINDS ALL RECORDS WITH id_profiles FROM updated_profiles CTE
                , all_joined_profile_records AS (
                    SELECT 
                        t.*
                    FROM ${TABLE_NAME} AS t
                        JOIN updated_profiles AS up USING (id_profiles)
                )

                SELECT * FROM all_joined_profile_records ORDER BY id_profiles, id_membership_periods_sa

                -- SELECT
                --   (SELECT FORMAT(COUNT(*), 0) FROM updated_profiles)                   	AS total_updated_profiles,
                --   (SELECT FORMAT(COUNT(*), 0) FROM all_joined_profile_records)           AS total_joined_rows,
                --   (SELECT FORMAT(COUNT(*), 0) FROM all_membership_sales_data_2015_left) 	AS total_all_records                
        ;

        ALTER TABLE ${DEST_TABLE_NAME} ADD INDEX (id_profiles);     
        -- *********************************************
    `;

    return query;
}

module.exports = {
    step_0a_create_updated_at_data,
}
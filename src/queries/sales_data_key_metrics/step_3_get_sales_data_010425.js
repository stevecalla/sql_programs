// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_3_member_total_life_time_purchases(FROM_STATEMENT) {
    return `
        -- STEP #3 = CREATE TOTAL LIFETIME PURCHASES TABLE
        DROP TABLE IF EXISTS step_3_member_total_life_time_purchases;

            CREATE TABLE step_3_member_total_life_time_purchases AS
                SELECT
                    id_profiles,
                    COUNT(*) AS member_lifetime_purchases -- total lifetime purchases due to group by

                -- FROM all_membership_sales_data_2015_left
                ${FROM_STATEMENT}
                GROUP BY id_profiles
            ;

        ALTER TABLE step_3_member_total_life_time_purchases     
            ADD INDEX (id_profiles);
        -- *********************************************
    `;
}

module.exports = {
    step_3_member_total_life_time_purchases,
}
// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_1_member_minimum_first_created_at_dates(FROM_STATEMENT) {
    return `
        -- STEP #1 = CREATE MINIMUM FIRST CREATED AT DATES TABLE
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

                -- FROM all_membership_sales_data_2015_left
                ${FROM_STATEMENT}
                GROUP BY id_profiles
            ;

            ALTER TABLE step_1_member_minimum_first_created_at_dates ADD INDEX (id_profiles);     
        -- *********************************************
    `;
}

function step_1_member_minimum_first_created_at_dates_query(FROM_STATEMENT, WHERE_STATEMENT = '', ORDER_BY_STATEMENT = '') {
    return `
        -- STEP #1 = CREATE MINIMUM FIRST CREATED AT DATES TABLE
        SELECT 
            am.id_profiles,

            MIN(am.created_at_members) AS first_created_at_members,
            MIN(am.created_at_mp) AS first_created_at_mp,
            MIN(am.created_at_profiles) AS first_created_at_profiles,
            MIN(am.created_at_users) AS first_created_at_users,
            MIN(am.purchased_on_adjusted_mp) AS first_purchased_on_adjusted_mp,
            MIN(am.starts_mp) AS first_starts_mp,

            YEAR(MIN(purchased_on_adjusted_mp)) AS first_purchased_on_year_adjusted_mp

        -- FROM all_membership_sales_data_2015_left
        ${FROM_STATEMENT} AS am
        ${WHERE_STATEMENT}
        GROUP BY id_profiles
        ${ORDER_BY_STATEMENT}
        ;   
    `;
}

module.exports = {
    step_1_member_minimum_first_created_at_dates,
    step_1_member_minimum_first_created_at_dates_query,
}
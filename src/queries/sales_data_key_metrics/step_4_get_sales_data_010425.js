// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_4_member_age_dimensions(FROM_STATEMENT) {
    return `
        -- STEP #4 = CREATE AGE NOW TABLE
        DROP TABLE IF EXISTS step_4_member_age_dimensions;

            CREATE TABLE step_4_member_age_dimensions AS
                SELECT
                    id_profiles,

                    (
                        YEAR(CURDATE()) 
                        - YEAR(MIN(date_of_birth_profiles))) 
                        - (DATE_FORMAT(CURDATE(), '%m%d') 
                        < DATE_FORMAT(MIN(date_of_birth_profiles), '%m%d')
                        
                    ) AS age_now, -- create age as of now,

                    MIN(date_of_birth_profiles) AS date_of_birth_profiles

                -- FROM all_membership_sales_data_2015_left
                ${FROM_STATEMENT}
                GROUP BY id_profiles
            ;

        ALTER TABLE step_4_member_age_dimensions                
            ADD INDEX (id_profiles);
        -- *********************************************
    `;
}

function step_4_member_age_dimensions_query(FROM_STATEMENT, WHERE_STATEMENT = '', ORDER_BY_STATEMENT = '') {
    return `
        -- STEP #4 = CREATE TABLE step_4_member_age_dimensions AS
        SELECT
            am.id_profiles,

            (
                YEAR(CURDATE()) 
                - YEAR(MIN(am.date_of_birth_profiles))) 
                - (DATE_FORMAT(CURDATE(), '%m%d') 
                < DATE_FORMAT(MIN(am.date_of_birth_profiles), '%m%d')
                
            ) AS age_now, -- create age as of now,

            MIN(am.date_of_birth_profiles) AS date_of_birth_profiles

        -- FROM all_membership_sales_data_2015_left
        ${FROM_STATEMENT} AS am
        ${WHERE_STATEMENT}
        GROUP BY am.id_profiles
        ${ORDER_BY_STATEMENT}
        ;
    `;
}

module.exports = {
    step_4_member_age_dimensions,
    step_4_member_age_dimensions_query,
}
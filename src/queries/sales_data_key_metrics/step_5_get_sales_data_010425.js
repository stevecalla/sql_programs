// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5_member_age_at_sale_date(FROM_STATEMENT) {
    return `
        -- STEP #5 = CREATE MEMBER AGE AT SALE DATE TABLE
        DROP TABLE IF EXISTS step_5_member_age_at_sale_date;

            CREATE TABLE step_5_member_age_at_sale_date AS
                WITH min_dates AS (
                    SELECT
                        am.id_membership_periods_sa,

                        MIN(am.purchased_on_adjusted_mp) AS sale_date,

                        -- DOB should be constant per member; MIN/MAX equivalent if duplicates exist
                        MIN(am.date_of_birth_profiles)    AS dob

                    ${FROM_STATEMENT} AS am

                    -- WHERE 1 = 1 
                        -- AND am.id_membership_periods_sa     IS NOT NULL
                        -- AND am.purchased_on_adjusted_mp     IS NOT NULL
                        -- AND am.date_of_birth_profiles       IS NOT NULL

                    GROUP BY am.id_membership_periods_sa
                    
                    )
                    
                    SELECT
                        id_membership_periods_sa,
                        TIMESTAMPDIFF(YEAR, dob, sale_date) AS age_as_of_sale_date
                    FROM min_dates
            ;

        ALTER TABLE step_5_member_age_at_sale_date              
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

module.exports = {
    step_5_member_age_at_sale_date,
}
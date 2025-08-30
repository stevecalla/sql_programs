// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_5a_member_age_at_end_of_year_of_sale(FROM_STATEMENT) {
    return `
        -- STEP #5a = CREATE AGE AT THE END OF EACH YEAR OF THE DATE OF SALE
        DROP TABLE IF EXISTS step_5a_member_age_at_end_of_year_of_sale;

            CREATE TABLE step_5a_member_age_at_end_of_year_of_sale AS
                WITH sale_years AS (
                    SELECT
                        am.id_membership_periods_sa,

                        /* id_profiles should be constant per period; use MIN/MAX to satisfy ONLY_FULL_GROUP_BY */
                        MIN(am.id_profiles) AS id_profiles,

                        YEAR(MAX(am.purchased_on_adjusted_mp)) AS sale_year,

                        /* DOB should be constant per member; MIN/MAX equivalent */
                        MIN(am.date_of_birth_profiles) AS dob

                    ${FROM_STATEMENT} AS am

                    -- WHERE 1 = 1 
                        -- AND am.id_membership_periods_sa     IS NOT NULL
                        -- AND am.purchased_on_adjusted_mp     IS NOT NULL
                        -- AND am.date_of_birth_profiles       IS NOT NULL

                    GROUP BY am.id_membership_periods_sa
                    )

                    SELECT
                        id_profiles,
                        id_membership_periods_sa,

                        /* Age as of Dec 31 of the sale year */
                        TIMESTAMPDIFF(
                            YEAR,
                            dob,
                            STR_TO_DATE(CONCAT(sale_year, '-12-31'), '%Y-%m-%d')
                        ) AS age_at_end_of_year
                         
                    FROM sale_years
            ;


        ALTER TABLE step_5a_member_age_at_end_of_year_of_sale   
            ADD INDEX (id_membership_periods_sa);
        -- *********************************************
    `;
}

module.exports = {
    step_5a_member_age_at_end_of_year_of_sale,
}

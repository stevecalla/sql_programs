// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

function step_7_prior_purchase() {
    return `
        -- STEP #7 = MOST RECENT PRIOR PURCHASE TO DETERMINE NEW, LAPSED, RENEW -- TODO: done 10 min
        DROP TABLE IF EXISTS step_7_prior_purchase;

        CREATE TABLE step_7_prior_purchase AS
        WITH ordered AS (
            SELECT
                -- am.member_number_members_sa,
                am.id_profiles,
                am.id_membership_periods_sa,
                am.new_member_category_6_sa,
                am.purchased_on_adjusted_mp,
                am.ends_mp,
                am.real_membership_types_sa,

                -- Prior by purchase date (matches your MAX(... WHERE purchased_on < current) intent)
                LAG(am.purchased_on_adjusted_mp)
                OVER (PARTITION BY am.id_profiles
                        ORDER BY am.purchased_on_adjusted_mp) AS most_recent_prior_purchase_date,

                LAG(am.real_membership_types_sa)
                OVER (PARTITION BY am.id_profiles
                        ORDER BY am.purchased_on_adjusted_mp) AS most_recent_prior_purchase_membership_type,

                LAG(am.new_member_category_6_sa)
                OVER (PARTITION BY am.id_profiles
                        ORDER BY am.purchased_on_adjusted_mp) AS most_recent_prior_purchase_membership_category,

                -- Prior by ends date (matches your MAX(... WHERE ends_mp < current) intent)
                LAG(am.ends_mp)
                OVER (PARTITION BY am.id_profiles
                        ORDER BY am.ends_mp) AS most_recent_prior_mp_ends_date
                FROM all_membership_sales_data_2015_left am
            -- 	WHERE member_number_members_sa IN ('1001416', '100181772', '100142051', '100853852') 
            -- 	LIMIT 100
        )
            SELECT
                id_profiles,
                id_membership_periods_sa,
                new_member_category_6_sa,
                purchased_on_adjusted_mp   AS most_recent_purchase_date,
                ends_mp                    AS most_recent_mp_ends_date,
                most_recent_prior_purchase_date,
                most_recent_prior_mp_ends_date,
                most_recent_prior_purchase_membership_type,
                most_recent_prior_purchase_membership_category
            FROM ordered
        ;
    `;
}

module.exports = {
    step_7_prior_purchase,
}
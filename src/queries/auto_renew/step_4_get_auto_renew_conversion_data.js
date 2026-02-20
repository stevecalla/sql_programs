// C:\Users\calla\development\usat\sql_code\7_auto_renew\step_11a_auto_renew_conversion_join_to_sales_summary_table_021826.sql

function main(is_test, created_at_dates) {
    const limit_where_statement = is_test ? "LIMIT 100" : "";
    const { created_at_mtn, created_at_utc } = created_at_dates;
    const day_window = 7;

    return `
        -- SET @day_window = 7;
        
        WITH
        sales_purchasers_by_day AS (
        SELECT
            DATE(s.purchased_on_date_adjusted_mp) AS purchased_on_date_adjusted_mp,
            s.id_profiles,
            real_membership_types_sa,
            new_member_category_6_sa,
            sales_units,
            sales_revenue
        FROM usat_sales_db.sales_key_stats_2015 s
        WHERE 1 = 1
            AND s.origin_flag_category LIKE '%source_usat_direct%'
            AND s.new_member_category_6_sa IN ('Silver','Gold','3-Year','One-Day - $15')
        ORDER BY DATE(s.purchased_on_date_adjusted_mp) DESC, s.id_profiles
        ${limit_where_statement}
        )
        -- SELECT * FROM sales_purchasers_by_day LIMIT 100;
        -- SELECT purchased_on_date_adjusted_mp, COUNT(*) FROM sales_purchasers_by_day GROUP BY 1;

        , auto_renew_signups_by_day AS (
        SELECT
            DATE(ar.created_at_date_braintree_subscriptions) AS created_at_date_braintree_subscriptions,
            ar.customer_id_braintree_subscriptions,
            ar.id_profiles,
            ar.product_id_braintree_plans,
            ar.plan_id_braintree_plans,
            ar.status_braintree_subscriptions,
            ar.is_active_auto_renew_flag,
            ar.price_braintree_subscriptions,
            ar.next_billing_date_braintree_subscriptions,
            ar.created_at_braintree_subscriptions,
            ar.updated_at_braintree_subscriptions
        FROM usat_sales_db.all_auto_renew_data_raw AS ar
        WHERE 1 = 1
        ORDER BY ar.created_at_date_braintree_subscriptions DESC, ar.id_profiles
        ${limit_where_statement}
        )
        -- SELECT * FROM auto_renew_signups_by_day LIMIT 100;
        -- SELECT created_at_date_braintree_subscriptions, COUNT(*) FROM auto_renew_signups_by_day GROUP BY 1 ORDER BY 1 DESC;

        -- SELECT 
        -- 	sp.purchased_on_date_adjusted_mp, 
        --     
        --     COUNT(sp.id_profiles), 
        --     COUNT(ar.customer_id_braintree_subscriptions),
        --     
        --     COUNT(DISTINCT sp.id_profiles), 
        --     COUNT(DISTINCT ar.customer_id_braintree_subscriptions)
        --     
        -- FROM sales_purchasers_by_day AS sp
        -- 	LEFT JOIN auto_renew_signups_by_day AS ar ON ar.id_profiles = sp.id_profiles
        -- 		-- AND ar.created_at_date_braintree_subscriptions = sp.purchased_on_date_adjusted_mp
        -- 		AND ar.created_at_date_braintree_subscriptions BETWEEN sp.purchased_on_date_adjusted_mp AND DATE_ADD(sp.purchased_on_date_adjusted_mp, INTERVAL ${day_window}} DAY)
        -- WHERE 1 = 1
        -- 	AND purchased_on_date_adjusted_mp = '2026-01-01'
        -- GROUP BY 1
        -- ORDER BY 1 DESC
        -- LIMIT 1000
        -- ;

        SELECT 
            sp.purchased_on_date_adjusted_mp,
            sp.id_profiles,
            sp.real_membership_types_sa,
            sp.new_member_category_6_sa,
            sp.sales_units,
            sp.sales_revenue,

            ar.created_at_date_braintree_subscriptions,
            ar.customer_id_braintree_subscriptions,
            ar.id_profiles AS id_profiles_auto_renew,
            ar.product_id_braintree_plans,
            ar.plan_id_braintree_plans,
            ar.status_braintree_subscriptions,
            ar.is_active_auto_renew_flag,
            ar.price_braintree_subscriptions,
            ar.next_billing_date_braintree_subscriptions,
            ar.created_at_braintree_subscriptions,
            ar.updated_at_braintree_subscriptions,
            
            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM sales_purchasers_by_day AS sp
            LEFT JOIN auto_renew_signups_by_day AS ar ON ar.id_profiles = sp.id_profiles
                AND ar.created_at_date_braintree_subscriptions BETWEEN sp.purchased_on_date_adjusted_mp AND DATE_ADD(sp.purchased_on_date_adjusted_mp, INTERVAL ${day_window} DAY)
        WHERE 1 = 1
            -- AND purchased_on_date_adjusted_mp = '2026-01-01'
        ORDER BY sp.purchased_on_date_adjusted_mp DESC
        -- LIMIT 1000
        ;
    `;
}

module.exports = {
    step_4_query_auto_renew_conversion_data: main,
}
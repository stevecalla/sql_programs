async function main(batch_size = 10, offset = 0) {
    return `   
        -- QUERY TO EXTRACT AUTO RENEW DATA (batched)
        SELECT DISTINCT
        -- IDS / KEYS
        customer_id_braintree_subscriptions,
        id_profiles,

        -- PLAN INFO
        product_id_braintree_plans,
        plan_id_braintree_plans,

        -- SUBSCRIPTION INFO
        status_braintree_subscriptions,

        -- ACTIVE FLAG
        is_active_auto_renew_flag,

        price_braintree_subscriptions,

        -- BRAINTREE DATES
        DATE_FORMAT(next_billing_date_braintree_subscriptions, '%Y-%m-%d') AS next_billing_date_braintree_subscriptions,
        next_billing_year_braintree_subscriptions,
        next_billing_month_braintree_subscriptions,

        DATE_FORMAT(created_at_braintree_subscriptions, '%Y-%m-%d %H:%i:%s') AS created_at_braintree_subscriptions,
        DATE_FORMAT(created_at_date_braintree_subscriptions, '%Y-%m-%d') AS created_at_date_braintree_subscriptions,
        created_at_year_braintree_subscriptions,
        created_at_month_braintree_subscriptions,

        DATE_FORMAT(updated_at_braintree_subscriptions, '%Y-%m-%d %H:%i:%s') AS updated_at_braintree_subscriptions,
        DATE_FORMAT(updated_at_date_braintree_subscriptions, '%Y-%m-%d') AS updated_at_date_braintree_subscriptions,
        updated_at_year_braintree_subscriptions,
        updated_at_month_braintree_subscriptions,

        -- CREATED AT DATES
        DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
        DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM all_auto_renew_data_raw
        WHERE 1 = 1
        ORDER BY customer_id_braintree_subscriptions ASC
        LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
    query_auto_renew_data: main
}
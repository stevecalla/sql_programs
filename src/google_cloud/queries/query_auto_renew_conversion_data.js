async function main(batch_size = 10, offset = 0) {
  return `
    SELECT

      DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp,
      id_profiles,
      real_membership_types_sa,
      new_member_category_6_sa,
      sales_units,
      sales_revenue,

      DATE_FORMAT(created_at_date_braintree_subscriptions, '%Y-%m-%d') AS created_at_date_braintree_subscriptions,

      customer_id_braintree_subscriptions,
      id_profiles AS id_profiles_auto_renew,
      product_id_braintree_plans,
      plan_id_braintree_plans,
      status_braintree_subscriptions,
      is_active_auto_renew_flag,
      price_braintree_subscriptions,

      DATE_FORMAT(next_billing_date_braintree_subscriptions, '%Y-%m-%d') AS next_billing_date_braintree_subscriptions,

      DATE_FORMAT(created_at_braintree_subscriptions, '%Y-%m-%d %H:%i:%s') AS created_at_braintree_subscriptions,
      
      DATE_FORMAT(updated_at_braintree_subscriptions, '%Y-%m-%d %H:%i:%s') AS updated_at_braintree_subscriptions,

      -- BATCH TIMESTAMPS
      DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
      DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

    FROM usat_sales_db.auto_renew_conversion_data
    WHERE 1 = 1
    ORDER BY
      DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') DESC,
      real_membership_types_sa ASC,
      new_member_category_6_sa ASC
    LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
  query_auto_renew_conversion_data: main,
};

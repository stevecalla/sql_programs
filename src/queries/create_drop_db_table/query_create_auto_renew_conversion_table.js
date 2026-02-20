// Table to store output of step_11a:
// Intended final SELECT shape: sp.* + ar.* + created_at_mtn/utc
// NOTE: sp.* and ar.* both contain id_profiles, so we store ar.id_profiles as ar_id_profiles.

const sales_dims = `
  purchased_on_date_adjusted_mp DATE NOT NULL,
  id_profiles BIGINT NOT NULL,
  real_membership_types_sa VARCHAR(100) NOT NULL,
  new_member_category_6_sa VARCHAR(50) NOT NULL,
`;

const sales_metrics = `
  sales_units DECIMAL(18,4) NOT NULL,
  sales_revenue DECIMAL(18,2) NOT NULL,
`;

const auto_renew_fields = `
  created_at_date_braintree_subscriptions DATE NULL,

  customer_id_braintree_subscriptions VARCHAR(64) NULL,
  id_profiles_auto_renew BIGINT NULL,

  product_id_braintree_plans VARCHAR(64) NULL,
  plan_id_braintree_plans VARCHAR(64) NULL,

  status_braintree_subscriptions VARCHAR(50) NULL,
  is_active_auto_renew_flag TINYINT(1) NULL,

  price_braintree_subscriptions DECIMAL(18,2) NULL,
  next_billing_date_braintree_subscriptions DATE NULL,

  created_at_braintree_subscriptions DATETIME NULL,
  updated_at_braintree_subscriptions DATETIME NULL,
`;

const created_at_dates = `
  created_at_mtn DATETIME NULL,
  created_at_utc DATETIME NULL,
`;

const index_fields = `
  -- Common query patterns: by purchase day, profile, and AR created day
  INDEX idx_purchased_day (purchased_on_date_adjusted_mp),
  INDEX idx_id_profiles (id_profiles),
  INDEX idx_membership_type (real_membership_types_sa),
  INDEX idx_new_member_category (new_member_category_6_sa),

  INDEX idx_ar_created_day (created_at_date_braintree_subscriptions),
  INDEX idx_ar_customer_id (customer_id_braintree_subscriptions),

  -- Helpful for joining / filtering
  INDEX idx_day_profile (purchased_on_date_adjusted_mp, id_profiles),
  INDEX idx_ar_day_profile (created_at_date_braintree_subscriptions, id_profiles_auto_renew)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${sales_dims}
      ${sales_metrics}
      ${auto_renew_fields}
      ${created_at_dates}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_auto_renew_conversion_table: main,
};

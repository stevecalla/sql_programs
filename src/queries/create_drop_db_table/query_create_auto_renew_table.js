// query_create_auto_renew_extract_table.js

const id_fields = `
  -- IDS / KEYS
  customer_id_braintree_subscriptions BIGINT UNSIGNED,
  id_profiles BIGINT UNSIGNED,

  product_id_braintree_plans VARCHAR(255),
  plan_id_braintree_plans VARCHAR(255),
`;

const subscription_fields = `
  -- SUBSCRIPTION INFO
  status_braintree_subscriptions VARCHAR(50),
  -- ACTIVE FLAG (0/1 or error text)
  is_active_auto_renew_flag VARCHAR(50),

  price_braintree_subscriptions DECIMAL(10,2),
`;

const braintree_dates = `
  -- BRAINTREE DATES
  next_billing_date_braintree_subscriptions DATE,
  next_billing_year_braintree_subscriptions INT,
  next_billing_month_braintree_subscriptions INT,

  created_at_braintree_subscriptions DATETIME,
  created_at_date_braintree_subscriptions DATE,
  created_at_year_braintree_subscriptions INT,
  created_at_month_braintree_subscriptions INT,

  updated_at_braintree_subscriptions DATETIME,
  updated_at_date_braintree_subscriptions DATE,
  updated_at_year_braintree_subscriptions INT,
  updated_at_month_braintree_subscriptions INT,
`;

const created_at_dates = `
  -- CREATED AT DATES
  created_at_mtn DATETIME,
  created_at_utc DATETIME,
`;

const index_fields = `
  -- INDEXES
  INDEX idx_customer_id_braintree_subscriptions (customer_id_braintree_subscriptions),
  INDEX idx_id_profiles (id_profiles),

  INDEX idx_product_id_braintree_plans (product_id_braintree_plans),
  INDEX idx_plan_id_braintree_plans (plan_id_braintree_plans),

  INDEX idx_status_braintree_subscriptions (status_braintree_subscriptions),
  INDEX idx_is_active_auto_renew_flag (is_active_auto_renew_flag),

  INDEX idx_next_billing_date_braintree_subscriptions (next_billing_date_braintree_subscriptions),
  INDEX idx_created_at_braintree_subscriptions (created_at_braintree_subscriptions),
  INDEX idx_updated_at_braintree_subscriptions (updated_at_braintree_subscriptions)
`;

async function main(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${id_fields}
      ${subscription_fields}
      ${braintree_dates}
      ${created_at_dates}
      ${index_fields}
    );
  `;
  return query;
}

module.exports = {
  query_create_auto_renew_extract_table: main,
};

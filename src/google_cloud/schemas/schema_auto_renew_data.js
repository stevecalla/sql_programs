// all_auto_renew_data_schema.js

const main = [
  // IDS / KEYS
  {
    name: "customer_id_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER", // MySQL BIGINT -> BigQuery INTEGER (INT64)
    description: "Braintree subscription customer_id",
    fields: []
  },
  {
    name: "id_profiles",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "profiles.id (USAT profile id)",
    fields: []
  },

  // PLAN INFO
  {
    name: "product_id_braintree_plans",
    mode: "NULLABLE",
    type: "STRING",
    description: "braintree_plans.product_id (purchasable product identifier)",
    fields: []
  },
  {
    name: "plan_id_braintree_plans",
    mode: "NULLABLE",
    type: "STRING",
    description: "braintree_plans.plan_id",
    fields: []
  },

  // SUBSCRIPTION INFO
  {
    name: "status_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: "Subscription status (e.g., active, pending, success, canceled)",
    fields: []
  },
  {
    name: "is_active_auto_renew_flag",
    mode: "NULLABLE",
    type: "STRING",
    description: "Active flag derived from status; returns 1/0 or 'error_active_flag'",
    fields: []
  },
  {
    name: "price_braintree_subscriptions",
    mode: "NULLABLE",
    type: "NUMERIC",
    description: "Subscription price (decimal)",
    fields: []
  },

  // BRAINTREE DATES
  {
    name: "next_billing_date_braintree_subscriptions",
    mode: "NULLABLE",
    type: "DATE",
    description: "Next billing date (YYYY-MM-DD)",
    fields: []
  },
  {
    name: "next_billing_year_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from next billing date",
    fields: []
  },
  {
    name: "next_billing_month_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from next billing date",
    fields: []
  },

  {
    name: "created_at_braintree_subscriptions",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Subscription created timestamp",
    fields: []
  },
  {
    name: "created_at_date_braintree_subscriptions",
    mode: "NULLABLE",
    type: "DATE",
    description: "Date extracted from created_at",
    fields: []
  },
  {
    name: "created_at_year_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from created_at",
    fields: []
  },
  {
    name: "created_at_month_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from created_at",
    fields: []
  },

  {
    name: "updated_at_braintree_subscriptions",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Subscription updated timestamp",
    fields: []
  },
  {
    name: "updated_at_date_braintree_subscriptions",
    mode: "NULLABLE",
    type: "DATE",
    description: "Date extracted from updated_at",
    fields: []
  },
  {
    name: "updated_at_year_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from updated_at",
    fields: []
  },
  {
    name: "updated_at_month_braintree_subscriptions",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from updated_at",
    fields: []
  },

  // CREATED AT (PIPELINE TIMESTAMPS)
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row extraction timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row extraction timestamp in UTC",
    fields: []
  }
];

module.exports = { all_auto_renew_data_schema: main };


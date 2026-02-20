// BigQuery schema for query_auto_renew_conversion_data (auto_renew_conversion_data export)
//
// NOTE: Your SELECT is already formatting dates/timestamps as STRINGS via DATE_FORMAT(),
// so the safest matching BQ types are STRING for those fields.
// If you want true DATE/TIMESTAMP types in BQ, change the SELECT to output real DATE/TIMESTAMP
// (don’t DATE_FORMAT), then update types below.

const auto_renew_conversion_schema = [
  {
    name: "purchased_on_date_adjusted_mp",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },
  {
    name: "id_profiles",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },
  {
    name: "real_membership_types_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "new_member_category_6_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "sales_units",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },
  {
    name: "sales_revenue",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "created_at_date_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },
  {
    name: "customer_id_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "id_profiles_auto_renew",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Same as id_profiles from source row; aliased in SELECT",
    fields: []
  },
  {
    name: "product_id_braintree_plans",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "plan_id_braintree_plans",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "status_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },
  {
    name: "is_active_auto_renew_flag",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "0/1 flag",
    fields: []
  },
  {
    name: "price_braintree_subscriptions",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "next_billing_date_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },
  {
    name: "created_at_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  },
  {
    name: "updated_at_braintree_subscriptions",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "STRING",
    description: "Batch timestamp YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "STRING",
    description: "Batch timestamp YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  }
];

module.exports = {
  auto_renew_conversion_schema,
};

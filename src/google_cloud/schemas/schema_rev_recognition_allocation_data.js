const rev_recognition_allocation_allocation_schema = [
  // ID Fields
  {
    name: "id_profiles",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Profile identifier",
    fields: []
  },
  {
    name: "id_membership_periods_sa",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership period identifier",
    fields: []
  },

  // Membership & Flags
  {
    name: "real_membership_types_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "Actual membership type",
    fields: []
  },
  {
    name: "new_member_category_6_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "New member category (6 types)",
    fields: []
  },
  {
    name: "origin_flag_ma",
    mode: "NULLABLE",
    type: "STRING",
    description: "Origin flag from MA system",
    fields: []
  },

  // Created & Purchase Dates
  {
    name: "created_at_mp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Membership period created at timestamp",
    fields: []
  },
  {
    name: "created_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month portion (YYYY-MM) of created_at_mp",
    fields: []
  },
  {
    name: "purchased_on_date_adjusted_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Adjusted purchase date of membership",
    fields: []
  },
  {
    name: "purchased_on_adjusted_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month portion (YYYY-MM) of adjusted purchase date",
    fields: []
  },

  // Membership Dates
  {
    name: "starts_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership start date",
    fields: []
  },
  {
    name: "ends_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership end date",
    fields: []
  },

  // Revenue Recognition Month
  {
    name: "revenue_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month revenue is recognized (YYYY-MM)",
    fields: []
  },

  // Recursion & Duration
  {
    name: "recursion_month_index",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Index of the month in recursive allocation (0-based)",
    fields: []
  },
  {
    name: "total_months",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total months by standard logic",
    fields: []
  },
  {
    name: "total_months_recursive",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total months by recursive logic (target_months)",
    fields: []
  },

  // Financials
  {
    name: "sales_units",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total sales units for membership",
    fields: []
  },
  {
    name: "monthly_sales_units",
    mode: "NULLABLE",
    type: "DECIMAL",
    description: "Sales units recognized for this month",
    fields: []
  },
  {
    name: "sales_revenue",
    mode: "NULLABLE",
    type: "DECIMAL",
    description: "Total sales revenue for membership",
    fields: []
  },
  {
    name: "monthly_revenue",
    mode: "NULLABLE",
    type: "DECIMAL",
    description: "Sales revenue recognized for this month",
    fields: []
  },

  // Metadata
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Created at timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Created at timestamp in UTC",
    fields: []
  }
];

module.exports = {
  rev_recognition_allocation_allocation_schema
};

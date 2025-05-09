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

  // Created At
  {
    name: "created_at_mp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Membership period created at timestamp",
    fields: []
  },
  {
    name: "created_at_date_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership period created at date",
    fields: []
  },
  {
    name: "created_at_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month of created_at_mp",
    fields: []
  },
  {
    name: "created_at_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter of created_at_mp",
    fields: []
  },
  {
    name: "created_at_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year of created_at_mp",
    fields: []
  },

  {
    name: "created_year_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month portion (YYYY-MM) of created_at_mp",
    fields: []
  },

  // Purchase Dates
  {
    name: "purchased_on_date_adjusted_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Adjusted purchase date",
    fields: []
  },
  {
    name: "purchased_on_date_adjusted_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month of adjusted purchase date",
    fields: []
  },
  {
    name: "purchased_on_date_adjusted_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter of adjusted purchase date",
    fields: []
  },
  {
    name: "purchased_on_date_adjusted_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year of adjusted purchase date",
    fields: []
  },
  {
    name: "purchased_on_adjusted_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month portion (YYYY-MM) of adjusted purchase date",
    fields: []
  },
  

  // Membership Start & End
  {
    name: "starts_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership period start date",
    fields: []
  },
  {
    name: "starts_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start month of membership period",
    fields: []
  },
  {
    name: "starts_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start quarter of membership period",
    fields: []
  },
  {
    name: "starts_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start year of membership period",
    fields: []
  },
  {
    name: "ends_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership period end date",
    fields: []
  },
  {
    name: "ends_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End month of membership period",
    fields: []
  },
  {
    name: "ends_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End quarter of membership period",
    fields: []
  },
  {
    name: "ends_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End year of membership period",
    fields: []
  },

  // revenue month
  ,
  {
    name: "revenue_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership period revenue month",
    fields: []
  },
  {
    name: "revenue_month_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month of revenue month",
    fields: []
  },
  {
    name: "revenue_quarte_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter of revenue month",
    fields: []
  },
  {
    name: "revenue_year_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year of revenue month",
    fields: []
  },

  {
    name: "revenue_year_month",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month portion (YYYY-MM) of revenue month",
    fields: []
  },

  // Is current month
  {
    name: "is_current_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Is current month boolean",
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
    name: "months_mp_allocation_recursive",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total months basedon recursive",
    fields: []
  },
  {
    name: "months_mp_allocated_custom",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total months based on custom rules",
    fields: []
  },
  
  // NOTE: Removed b/c produces too much data
  // Flags
  // {
  //   name: "is_duplicate_previous_period",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if current period equals previous period",
  //   fields: []
  // },
  // {
  //   name: "is_overlaps_previous_mp",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if current period overlaps with previous",
  //   fields: []
  // },
  // {
  //   name: "is_stacked_previous_mp",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "Start date of the current membership is within 30 days before or after the end date of the previous membership",
  //   fields: []
  // },
  // {
  //   name: "days_between_previous_end_and_start",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "Days between previous period end and current start",
  //   fields: []
  // },
  // {
  //   name: "is_sales_revenue_zero",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if sales revenue is zero",
  //   fields: []
  // },
  // {
  //   name: "is_bulk",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if membership is part of bulk purchase",
  //   fields: []
  // },
  // {
  //   name: "is_youth_premier",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if youth premier membership",
  //   fields: []
  // },
  // {
  //   name: "is_lifetime",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if lifetime membership",
  //   fields: []
  // },
  // {
  //   name: "has_created_at_gt_purchased_on",
  //   mode: "NULLABLE",
  //   type: "INTEGER",
  //   description: "1 if created_at date is after purchase date",
  //   fields: []
  // },

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

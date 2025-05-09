const rev_recognition_base_data_schema = [
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

  // Updated At
  {
    name: "updated_at_mp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Last update timestamp of membership period",
    fields: []
  },
  {
    name: "updated_at_date_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership period created at date",
    fields: []
  },
  {
    name: "updated_at_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month of updated_at_mp",
    fields: []
  },
  {
    name: "updated_at_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter of updated_at_mp",
    fields: []
  },
  {
    name: "updated_at_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year of updated_at_mp",
    fields: []
  },

  // Purchase Dates
  {
    name: "purchased_on_date_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Purchase date of membership",
    fields: []
  },
  {
    name: "purchased_on_date_mp_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month of purchase date",
    fields: []
  },
  {
    name: "purchased_on_date_mp_quarter",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter of purchase date",
    fields: []
  },
  {
    name: "purchased_on_date_mp_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year of purchase date",
    fields: []
  },
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

  // Duration & Flags
  {
    name: "months_mp_difference",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total membership months (standard method)",
    fields: []
  },
  {
    name: "months_mp_allocated_custom",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total membership months using custom logic",
    fields: []
  },
  {
    name: "is_duplicate_previous_period",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if current period equals previous period",
    fields: []
  },
  {
    name: "is_overlaps_previous_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if current period overlaps with previous",
    fields: []
  },
  {
    name: "is_stacked_previous_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start date of the current membership is within 30 days before or after the end date of the previous membership",
    fields: []
  },
  {
    name: "days_between_previous_end_and_start",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Days between previous period end and current start",
    fields: []
  },
  {
    name: "is_sales_revenue_zero",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if sales revenue is zero",
    fields: []
  },
  {
    name: "is_bulk",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if membership is part of bulk purchase",
    fields: []
  },
  {
    name: "is_youth_premier",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if youth premier membership",
    fields: []
  },
  {
    name: "is_lifetime",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if lifetime membership",
    fields: []
  },
  {
    name: "has_created_at_gt_purchased_on",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "1 if created_at date is after purchase date",
    fields: []
  },

  // Financials
  {
    name: "actual_membership_fee_6_rule_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "Membership fee calculated using 6-rule logic",
    fields: []
  },
  {
    name: "sales_revenue",
    mode: "NULLABLE",
    type: "FLOAT",
    description: "Revenue recognized from the sale",
    fields: []
  },
  {
    name: "sales_units",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Units sold",
    fields: []
  },

  // Created At (Timezone Variants)
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
  rev_recognition_base_data_schema 
};

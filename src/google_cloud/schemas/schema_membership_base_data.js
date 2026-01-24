const main = [
  // Grain
  {
    name: "year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Membership year for aggregation",
    fields: []
  },

  // Dimensions
  {
    name: "membership_type",
    mode: "REQUIRED",
    type: "STRING",
    description: "Resolved membership type for the year",
    fields: []
  },
  {
    name: "new_member_category",
    mode: "REQUIRED",
    type: "STRING",
    description: "New vs returning member classification",
    fields: []
  },

  // Counts
  {
    name: "unique_profiles",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Distinct member profiles mapped to this bucket",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_that_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships held by all profiles in the given year",
    fields: []
  },
  {
    name: "unique_profiles_sales_ytd",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Distinct profiles with sales in YTD window",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_sales_ytd",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships sold within YTD window",
    fields: []
  },

  // YTD Metadata
  {
    name: "ytd_as_of_run_date",
    mode: "REQUIRED",
    type: "DATE",
    description: "Date through which YTD logic is evaluated",
    fields: []
  },
  {
    name: "ytd_as_of_day_of_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Day-of-year cutoff used for YTD comparison",
    fields: []
  },

  // Batch Timestamps
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Batch creation timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Batch creation timestamp in UTC",
    fields: []
  }
];

module.exports = { 
  membership_base_data_schema: main 
};

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
  // Counts
  {
    name: "unique_profiles",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Distinct member profiles mapped to this membership bucket for the given year, after best-membership selection logic",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_that_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total number of memberships held by all profiles in this bucket during the given year (includes multiple memberships per profile)",
    fields: []
  },
  {
    name: "unique_profiles_sales_through_day_of_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Distinct member profiles with at least one membership purchase on or before the same day-of-year cutoff for the given year",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_sales_through_day_of_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships purchased on or before the same day-of-year cutoff for the given year",
    fields: []
  },
  {
    name: "unique_profiles_sales_ytd",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Distinct member profiles with at least one membership purchase within the year-to-date window, using the same day-of-year cutoff as the run date",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_sales_ytd",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships purchased within the year-to-date window, using the same day-of-year cutoff as the run date",
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

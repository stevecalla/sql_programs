const main = [
  // Grain
  {
    name: "year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Membership year for the record",
    fields: []
  },
  {
    name: "id_profiles",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Unique profile identifier",
    fields: []
  },

  // Member Identifiers
  {
    name: "member_number_members_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "Member number associated with the profile",
    fields: []
  },

  // Purchase (Adjusted)
  {
    name: "purchased_on_adjusted_mp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Adjusted purchase timestamp in Mountain Time",
    fields: []
  },
  {
    name: "purchased_on_year_adjusted_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Adjusted purchase year",
    fields: []
  },
  {
    name: "purchased_on_quarter_adjusted_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Adjusted purchase quarter",
    fields: []
  },
  {
    name: "purchased_on_month_adjusted_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Adjusted purchase month",
    fields: []
  },

  // Membership Period
  {
    name: "starts_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership start date",
    fields: []
  },
  {
    name: "starts_year_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership start year",
    fields: []
  },
  {
    name: "starts_quarter_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership start quarter",
    fields: []
  },
  {
    name: "starts_month_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership start month",
    fields: []
  },
  {
    name: "ends_mp",
    mode: "NULLABLE",
    type: "DATE",
    description: "Membership end date",
    fields: []
  },
  {
    name: "ends_year_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership end year",
    fields: []
  },
  {
    name: "ends_quarter_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership end quarter",
    fields: []
  },
  {
    name: "ends_month_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Membership end month",
    fields: []
  },

  // Membership Dimensions
  {
    name: "real_membership_types_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "Resolved membership type for analytics",
    fields: []
  },
  {
    name: "new_member_category_6_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: "Six-category new/returning member classification",
    fields: []
  },

  // Lifecycle
  {
    name: "member_min_created_at_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Earliest known year the member profile was created",
    fields: []
  },
  {
    name: "member_lapsed_renew_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "Lapsed vs renewed classification",
    fields: []
  },
  {
    name: "member_created_at_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "Member creation cohort category",
    fields: []
  },
  {
    name: "most_recent_prior_purchase_membership_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Membership type of the most recent prior purchase",
    fields: []
  },
  {
    name: "most_recent_prior_purchase_membership_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "Category of the most recent prior purchase",
    fields: []
  },
  {
    name: "member_first_purchase_year_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "First purchase year bucket",
    fields: []
  },
  {
    name: "member_first_purchase_years_out",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Years since first purchase",
    fields: []
  },
  {
    name: "member_first_purchase_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Calendar year of first membership purchase",
    fields: []
  },
  {
    name: "member_lifetime_frequency",
    mode: "NULLABLE",
    type: "STRING",
    description: "Frequency classification for lifetime purchases",
    fields: []
  },
  {
    name: "member_lifetime_purchases",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total lifetime membership purchases",
    fields: []
  },
  {
    name: "member_upgrade_downgrade_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "Upgrade or downgrade classification",
    fields: []
  },
  {
    name: "member_upgrade_downgrade_major",
    mode: "NULLABLE",
    type: "STRING",
    description: "Major upgrade/downgrade flag",
    fields: []
  },

  // Demographics & Geo
  {
    name: "age_at_end_of_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Age at the end of the membership year",
    fields: []
  },
  {
    name: "age_as_year_end_bin",
    mode: "NULLABLE",
    type: "STRING",
    description: "Age bin at year end",
    fields: []
  },
  {
    name: "date_of_birth_year_mp",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Birth year derived in Mountain Time",
    fields: []
  },
  {
    name: "member_state_code_addresses",
    mode: "NULLABLE",
    type: "STRING",
    description: "State code of the member address",
    fields: []
  },
  {
    name: "region_name_member",
    mode: "NULLABLE",
    type: "STRING",
    description: "Region name associated with the member",
    fields: []
  },
  {
    name: "gender_id_profiles",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Gender identifier",
    fields: []
  },
  {
    name: "gender_profiles",
    mode: "NULLABLE",
    type: "STRING",
    description: "Gender label",
    fields: []
  },

  // Metrics & Flags
  {
    name: "total_memberships_for_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships held by this profile in the year",
    fields: []
  },
  {
    name: "membership_type_priority",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Priority used to select the best membership per year",
    fields: []
  },
  {
    name: "is_sales_through_day_of_year",
    mode: "REQUIRED",
    type: "BOOLEAN",
    description: "Indicates whether this membership purchase occurred on or before the same day-of-year cutoff for the given year",
    fields: []
  },
  {
    name: "is_sales_ytd",
    mode: "REQUIRED",
    type: "BOOLEAN",
    description: "Indicates whether this membership purchase falls within the year-to-date window, using the same day-of-year cutoff as the run date",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_that_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total number of memberships held across all profiles in the given year (includes multiple memberships per profile)",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_sales_through_day_of_year",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships purchased across all profiles on or before the same day-of-year cutoff for the given year",
    fields: []
  },
  {
    name: "total_memberships_all_profiles_sales_ytd",
    mode: "REQUIRED",
    type: "INTEGER",
    description: "Total memberships purchased across all profiles within the year-to-date window, using the same day-of-year cutoff as the run date",
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
  membership_detail_data_schema: main
};

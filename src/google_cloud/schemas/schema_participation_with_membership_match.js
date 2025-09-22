const participation_with_membership_sales_match_schema = [
  // *********************
  // PARTICIPATION DATA
  // *********************
  {
    "name": "id_rr",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Race result record ID",
    "fields": []
  },
  {
    "name": "id_race_rr",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Race ID from race results",
    "fields": []
  },
  {
    "name": "id_events_rr",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Event ID from race results",
    "fields": []
  },
  {
    "name": "id_sanctioning_events",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Sanctioning event ID",
    "fields": []
  },
  {
    "name": "name_event_type",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Event type name",
    "fields": []
  },
  {
    "name": "name_events_rr",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Event name from race results",
    "fields": []
  },
  {
    "name": "city_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "City of the event (race)",
    "fields": []
  },
  {
    "name": "state_code_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "State/region code of the event (race)",
    "fields": []
  },
  {
    "name": "zip_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Postal/ZIP code of the event (race)",
    "fields": []
  },
  {
    "name": "start_date_races",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Race start date (YYYY-MM-DD)",
    "fields": []
  },
  {
    "name": "start_date_year_races",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Race start year",
    "fields": []
  },
  {
    "name": "start_date_month_races",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Race start month",
    "fields": []
  },
  {
    "name": "start_date_quarter_races",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Race start quarter",
    "fields": []
  },
  {
    "name": "is_ironman",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Is the race an Ironman-branded event (Y/N/other)",
    "fields": []
  },
  {
    "name": "id_profile_rr",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Profile ID from race results",
    "fields": []
  },
  {
    "name": "gender_code",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Gender code from race results",
    "fields": []
  },
  {
    "name": "age",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Age at time of race (if provided)",
    "fields": []
  },
  {
    "name": "age_as_race_results_bin",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Binned age category derived from race results",
    "fields": []
  },
  {
    "name": "name_distance_types",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Distance type name",
    "fields": []
  },
  {
    "name": "name_race_type",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Race type name",
    "fields": []
  },
  {
    "name": "category",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Race category",
    "fields": []
  },

  // *********************
  // REGION DATA
  // *********************
  {
    "name": "state_id",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Internal state ID",
    "fields": []
  },
  {
    "name": "region_code",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region code",
    "fields": []
  },
  {
    "name": "state_name",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "State name",
    "fields": []
  },
  {
    "name": "state_code",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "State/region code",
    "fields": []
  },
  {
    "name": "region_name",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region name",
    "fields": []
  },
  {
    "name": "region_abbr",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region abbreviation",
    "fields": []
  },

  // *********************
  // MEMBERSHIP DATA
  // *********************
  {
    "name": "id_profiles",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Membership/profile ID",
    "fields": []
  },
  {
    "name": "member_min_created_at_year",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Earliest membership created_at year",
    "fields": []
  },
  {
    "name": "region_name_member",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region name for member address",
    "fields": []
  },
  {
    "name": "region_abbr_member",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region abbreviation for member address",
    "fields": []
  },
  {
    "name": "member_city_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member city (cleaned)",
    "fields": []
  },
  {
    "name": "member_postal_code_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member postal code",
    "fields": []
  },
  {
    "name": "member_lng_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member longitude (as string)",
    "fields": []
  },
  {
    "name": "member_lat_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member latitude (as string)",
    "fields": []
  },
  {
    "name": "member_state_code_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member state code",
    "fields": []
  },
  {
    "name": "member_country_code_addresses",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Member country code",
    "fields": []
  },
  {
    "name": "purchased_on_date_adjusted_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Membership purchase date (YYYY-MM-DD, adjusted)",
    "fields": []
  },
  {
    "name": "purchased_on_month_adjusted_mp",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Membership purchase month (adjusted)",
    "fields": []
  },
  {
    "name": "purchased_on_year_adjusted_mp",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Membership purchase year (adjusted)",
    "fields": []
  },
  {
    "name": "name_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Membership-linked event name (cleaned)",
    "fields": []
  },
  {
    "name": "id_events",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Membership-linked event ID",
    "fields": []
  },
  {
    "name": "region_name_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region name for membership-linked event",
    "fields": []
  },
  {
    "name": "region_abbr_events",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Region abbreviation for membership-linked event",
    "fields": []
  },
  {
    "name": "id_membership_periods_sa",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Membership period ID (sales app)",
    "fields": []
  },
  {
    "name": "starts_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Membership period start date (YYYY-MM-DD)",
    "fields": []
  },
  {
    "name": "ends_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Membership period end date (YYYY-MM-DD)",
    "fields": []
  },
  {
    "name": "real_membership_types_sa",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Resolved membership type",
    "fields": []
  },
  {
    "name": "new_member_category_6_sa",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "6-bucket new member category",
    "fields": []
  },
  {
    "name": "first_starts_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "First starts mp date",
    "fields": []
  },
  {
    "name": "member_created_at_category_purchased_on",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Created_at cohort/category for member for purchased on date",
    "fields": []
  },
  {
    "name": "member_lapsed_renew_category_purchased_on",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Lapsed/renewal category for purchased on date",
    "fields": []
  },
  {
    "name": "min_start_date_year_races",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "First race start date by id profile",
    "fields": []
  },
  {
    "name": "member_created_at_category_starts_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Created_at cohort/category for member for starts mp date",
    "fields": []
  },
  {
    "name": "member_lapsed_renew_category_starts_mp",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Lapsed/renewal category for starsts date",
    "fields": []
  },
  {
    "name": "member_lifetime_purchases",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Lifetime number of membership purchases",
    "fields": []
  },
  {
    "name": "member_lifetime_frequency",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Lifetime purchase frequency",
    "fields": []
  },
  {
    "name": "member_upgrade_downgrade_category",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Upgrade/downgrade category",
    "fields": []
  },
  {
    "name": "most_recent_prior_purchase_membership_type",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Most recent prior membership type",
    "fields": []
  },
  {
    "name": "origin_flag_category",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Origin category derived from join",
    "fields": []
  },
  {
    "name": "origin_flag_ma",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Origin flag (membership application)",
    "fields": []
  },
  {
    "name": "sales_revenue",
    "mode": "NULLABLE",
    "type": "FLOAT",
    "description": "Sales revenue for matched membership",
    "fields": []
  },
  {
    "name": "sales_units",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Sales units for matched membership",
    "fields": []
  },
  {
    "name": "rn",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Rank of membership match by proximity to race start date",
    "fields": []
  },
  {
    "name": "is_active_membership",
    "mode": "NULLABLE",
    "type": "INTEGER",
    "description": "Active membership at race date flag (1 active / 0 not active)",
    "fields": []
  },

  // ******************
  // CREATED AT DATES
  // ******************
  {
    "name": "created_at_mtn",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Creation timestamp in Mountain Time (YYYY-MM-DD HH:MM:SS)",
    "fields": []
  },
  {
    "name": "created_at_utc",
    "mode": "NULLABLE",
    "type": "STRING",
    "description": "Creation timestamp in UTC (YYYY-MM-DD HH:MM:SS)",
    "fields": []
  }
];

module.exports = {
  participation_with_membership_sales_match_schema,
};
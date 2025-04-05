const participation_profile_schema = [
    {
      "name": "profile_id",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": null,
      "fields": []
    },
    // LEAST RECENT MEMBERSHIP FIELDS
    {
      "name": "member_min_created_at_year",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Minimum created at year for membership",
      "fields": []
    },
    {
      "name": "least_recent_membership_type",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Type of the least recent membership",
      "fields": []
    },
    {
      "name": "least_recent_member_created_at_category",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Created at category for least recent membership",
      "fields": []
    },
    {
      "name": "least_recent_starts_mp",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Start date for least recent membership period",
      "fields": []
    },
    {
      "name": "least_recent_ends_mp",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "End date for least recent membership period",
      "fields": []
    },
    // MOST RECENT MEMBERSHIP FIELDS
    {
      "name": "most_recent_id_membership_period_sa",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "ID of most recent membership period",
      "fields": []
    },
    {
      "name": "most_recent_membership_type",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Type of most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_new_member_category_6_sa",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "New member category for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_member_created_at_category",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Created at category for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_starts_mp",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Start date for most recent membership period",
      "fields": []
    },
    {
      "name": "most_recent_ends_mp",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "End date for most recent membership period",
      "fields": []
    },
    {
      "name": "most_recent_region_name_member",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Region name for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_member_city_addresses",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "City addresses for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_member_state_code_addresses",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "State code addresses for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_member_postal_code_addresses",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Postal code addresses for most recent membership",
      "fields": []
    },
    {
      "name": "most_recent_member_lat_addresses",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Latitude for most recent membership address",
      "fields": []
    },
    {
      "name": "most_recent_member_lng_addresses",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Longitude for most recent membership address",
      "fields": []
    },
    // MOST RECENT RACE FIELDS
    {
      "name": "most_recent_id_rr",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "ID of most recent race record",
      "fields": []
    },
    {
      "name": "most_recent_id_race",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "ID of most recent race",
      "fields": []
    },
    {
      "name": "most_recent_id_sanctioning_events",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "ID of most recent sanctioning event",
      "fields": []
    },
    {
      "name": "most_recent_starts_date_races",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Start date for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_start_date_month_races",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Start month for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_start_date_year_races",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Start year for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_region_name",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Region name for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_zip_events",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Zip code for most recent race events",
      "fields": []
    },
    {
      "name": "most_recent_city_events",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "City for most recent race events",
      "fields": []
    },
    {
      "name": "most_recent_state_code_events",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "State code for most recent race events",
      "fields": []
    },
    {
      "name": "most_recent_name_race_type",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Race type name for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_name_distance_types",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distance types name for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_name_event_type",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Event type name for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_name_events",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Events name for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_is_ironman",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Indicator if most recent race is an Ironman event",
      "fields": []
    },
    {
      "name": "most_recent_gender_code",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Gender code for most recent race",
      "fields": []
    },
    {
      "name": "most_recent_race_age",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Race age for most recent race",
      "fields": []
    },
    // METRICS
    {
      "name": "start_years_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct start years",
      "fields": []
    },
    {
      "name": "name_events_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct events names",
      "fields": []
    },
    {
      "name": "id_sanctioning_events_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct sanctioning events IDs",
      "fields": []
    },
    {
      "name": "id_membership_period_sa_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct membership period IDs",
      "fields": []
    },
    {
      "name": "starts_mp_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct start dates for membership periods",
      "fields": []
    },
    {
      "name": "ends_mp_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct end dates for membership periods",
      "fields": []
    },
    {
      "name": "is_ironman_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct ironman indicator",
      "fields": []
    },
    {
      "name": "is_ironman_flag",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Ironman flag indicator",
      "fields": []
    },
    {
      "name": "is_active_membership_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct active membership indicator",
      "fields": []
    },
    {
      "name": "count_is_membership_match",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Count of matching memberships",
      "fields": []
    },
    {
      "name": "count_is_not_membership_match",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Count of non-matching memberships",
      "fields": []
    },
    {
      "name": "count_races_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct count of races",
      "fields": []
    },
    {
      "name": "count_current_year_races",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Count of races in current year",
      "fields": []
    },
    {
      "name": "count_prior_year_races",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Count of races in prior year",
      "fields": []
    },
    {
      "name": "count_of_start_years_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct count of start years",
      "fields": []
    },
    {
      "name": "count_of_race_regions_distinct",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Distinct count of race regions",
      "fields": []
    },
    {
      "name": "count_of_purchased_years_all",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Count of all purchased years",
      "fields": []
    },
    {
      "name": "avg_races_per_year",
      "mode": "NULLABLE",
      "type": "FLOAT",
      "description": "Average races per year",
      "fields": []
    },
    {
      "name": "is_repeat_racer",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Flag indicating if a racer is a repeat racer (1) or not (0)",
      "fields": []
    },
    {
      "name": "had_race_membership_match",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Flag indicating if there was a race membership match (1) or not (0)",
      "fields": []
    },
    {
      "name": "sales_units_total",
      "mode": "NULLABLE",
      "type": "INTEGER",
      "description": "Total sales units",
      "fields": []
    },
    {
      "name": "sales_revenue_total",
      "mode": "NULLABLE",
      "type": "FLOAT",
      "description": "Total sales revenue",
      "fields": []
    },
    {
      "name": "created_at_mtn",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Creation timestamp in mountain time",
      "fields": []
    },
    {
      "name": "created_at_utc",
      "mode": "NULLABLE",
      "type": "STRING",
      "description": "Creation timestamp in UTC",
      "fields": []
    }
  ];
  
  module.exports = {
      participation_profile_schema,
  };
  
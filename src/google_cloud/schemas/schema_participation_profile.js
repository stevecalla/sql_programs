const participation_profile_schema = [
    {
        "name": "profile_id",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "count_of_race_regions_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "race_regions_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_region_name",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_city_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_city_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_state_code_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_state_code_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_race_type_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_name_race_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_distance_types_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_name_distance_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_event_type_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_name_event_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_events_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_name_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "zip_events_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_zip_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "is_ironman_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_is_ironman",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "is_ironman_flag",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "gender_code_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_gender_code",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "age_distinct",
        "mode": "NULLABLE",
        "type": "STRING",  // adjust to STRING if this field holds aggregated values
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_age",
        "mode": "NULLABLE",
        "type": "INTEGER",  // adjust to STRING if needed
        "description": null,
        "fields": []
    },
    {
        "name": "member_min_created_at_year_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_region_name_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_region_name_member",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_member_city_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_city_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_member_state_code_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_state_code_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_member_postal_code_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_postal_code_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_member_lat_addresses",
        "mode": "NULLABLE",
        "type": "STRING", 
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_lat_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "aggregated_member_lng_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_lng_addresses",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "id_membership_period_sa_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_id_membership_period_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "memberships_type_purchased_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "least_recent_membership_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_membership_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "memberships_category_purchased_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "memberships_category_purchased_all",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_new_member_category_6_sa",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "member_created_at_category_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "least_recent_member_created_at_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_member_created_at_category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "starts_mp_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "most_recent_starts_mp",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "start_years_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "start_year_least_recent",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "start_year_most_recent",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "is_repeat_racer",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Flag indicating repeat racer (1) or not (0)",
        "fields": []
    },
    {
        "name": "count_is_membership_match",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_not_membership_match",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "count_races_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "count_of_start_years_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
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
        "name": "is_active_membership_distinct",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
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
        "name": "count_of_purchased_years_all",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "sales_units_total",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": null,
        "fields": []
    },
    {
        "name": "sales_revenue_total",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": null,
        "fields": []
    },
    {
        "name": "created_at_mtn",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "date '2024-02-12 00:00:00'",
        "fields": []
    },
    {
        "name": "created_at_utc",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "date '2024-02-12 00:00:00'",
        "fields": []
    }
]

// console.log(members_schema.length);

module.exports = {
    participation_profile_schema,
}
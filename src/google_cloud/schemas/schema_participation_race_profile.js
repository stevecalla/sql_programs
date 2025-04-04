const participation_race_schema = [
    {
        "name": "year",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "month",
        "mode": "NULLABLE",
        "type": "STRING",  
        "description": null,
        "fields": []
    },
    {
        "name": "id_sanctioning_events",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "id_events_rr",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "id_race_rr",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "name_events_rr",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_race_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_distance_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "name_event_type",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": null,
        "fields": []
    },
    {
        "name": "category",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "is_ironman",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "gender_code",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "region_name",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "zip_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "city_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "state_code_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "2025-01-24 15:00:39",
        "fields": []
    },
    {
        "name": "start_date_races",
        "mode": "NULLABLE",
        "type": "DATE",
        "description": "date '2024-02-12'",
        "fields": []
    },
    {
        "name": "start_date_month_races",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "start_date_quarter_races",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "start_date_year_races",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "weighted_distinct_profiles",
        "mode": "NULLABLE",
        "type": "FLOAT",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_id_profile_distinct",
        "mode": "NULLABLE",
        "type": "FLOAT",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_total_profiles",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_all_participants",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "is_active_membership",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
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
        "name": "count_is_repeat",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_new",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_adult_annual",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_one_day",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_elite",
        "mode": "NULLABLE",
        "type": "INTEGER",  
        "description": null,
        "fields": []
    },
    {
        "name": "count_is_youth_annual",
        "mode": "NULLABLE",
        "type": "INTEGER",  
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
    participation_race_schema,
}

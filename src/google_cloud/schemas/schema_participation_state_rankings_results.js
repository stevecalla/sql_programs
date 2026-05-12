const main = [
    // ***********************************
    // PROFILE
    // ***********************************
    {
        "name": "id_profiles",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Profile ID",
        "fields": []
    },
    {
        "name": "full_name_profiles",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Full profile name",
        "fields": []
    },
    {
        "name": "last_name_profiles",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Last name",
        "fields": []
    },
    {
        "name": "first_name_profiles",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "First name",
        "fields": []
    },
    {
        "name": "date_of_birth_profiles",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Date of birth",
        "fields": []
    },
    {
        "name": "email_users",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "User email",
        "fields": []
    },
    {
        "name": "gender_code_race_results",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race gender",
        "fields": []
    },

    // ***********************************
    // MEMBERSHIP PERIODS
    // ***********************************
    {
        "name": "ids_membership_periods",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership period IDs",
        "fields": []
    },
    {
        "name": "ids_membership_type_membership_periods",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership type IDs",
        "fields": []
    },
    {
        "name": "names_membership_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership type names",
        "fields": []
    },
    {
        "name": "starts_membership_periods",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership start dates",
        "fields": []
    },
    {
        "name": "ends_membership_periods",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership end dates",
        "fields": []
    },
    {
        "name": "groups_membership_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Membership type groups",
        "fields": []
    },
    {
        "name": "count_membership_periods",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Count of membership periods",
        "fields": []
    },

    // ***********************************
    // EVENTS
    // ***********************************
    {
        "name": "ids_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Event IDs",
        "fields": []
    },
    {
        "name": "starts_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Event start dates",
        "fields": []
    },
    {
        "name": "names_events",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Event names",
        "fields": []
    },

    // ***********************************
    // RACE RESULTS
    // ***********************************
    {
        "name": "age_race_results",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race ages",
        "fields": []
    },
    {
        "name": "designations_races",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race designations",
        "fields": []
    },
    {
        "name": "names_distance_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Distance type names",
        "fields": []
    },
    {
        "name": "names_race_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race type names",
        "fields": []
    },
    {
        "name": "ids_race_results",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race result IDs",
        "fields": []
    },
    {
        "name": "milliseconds_race_results",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race results milliseconds",
        "fields": []
    },
    {
        "name": "formatted_time_race_results",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Race results formatted hh:mm:ss",
        "fields": []
    },
    {
        "name": "count_distinct_profiles",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Distinct profile count",
        "fields": []
    },
    {
        "name": "count_total_race_results",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Total race result count",
        "fields": []
    },

    // ***********************************
    // RANKING PERIOD / LIST
    // ***********************************
    {
        "name": "ranked_at_ranking_list_periods",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranking period date",
        "fields": []
    },
    {
        "name": "id_ranking_lists",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Ranking list ID",
        "fields": []
    },

    // ***********************************
    // RANKING CONFIG
    // ***********************************
    {
        "name": "min_age_groups",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Minimum age group",
        "fields": []
    },
    {
        "name": "max_age_groups",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Maximum age group",
        "fields": []
    },
    {
        "name": "ranked_age_bin",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranked age bin",
        "fields": []
    },
    {
        "name": "ranked_name_race_types",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranked race type",
        "fields": []
    },
    {
        "name": "name_ranking_series",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranking series name",
        "fields": []
    },

    // ***********************************
    // RANKING ENTRY
    // ***********************************
    {
        "name": "id_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Ranking entry ID",
        "fields": []
    },
    {
        "name": "member_number_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Member number",
        "fields": []
    },
    {
        "name": "first_name_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranking first name",
        "fields": []
    },
    {
        "name": "last_name_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Ranking last name",
        "fields": []
    },
    {
        "name": "rank_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "Ranking position",
        "fields": []
    },
    {
        "name": "score_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Ranking score",
        "fields": []
    },
    {
        "name": "multiplier_score_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "FLOAT",
        "description": "Multiplier score",
        "fields": []
    },
    {
        "name": "all_american_ranking_list_period_entries",
        "mode": "NULLABLE",
        "type": "INTEGER",
        "description": "All American flag",
        "fields": []
    },

    // ***********************************
    // CREATED AT DATES
    // ***********************************
    {
        "name": "created_at_mtn",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Created at mountain time",
        "fields": []
    },
    {
        "name": "created_at_utc",
        "mode": "NULLABLE",
        "type": "STRING",
        "description": "Created at UTC",
        "fields": []
    }
];

module.exports = {
    participation_state_rankings_schema: main,
};
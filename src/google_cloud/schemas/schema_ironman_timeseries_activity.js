// BigQuery schema for ironman_timeseries_activity_data.
// Order MUST match query_ironman_timeseries_activity.js.
const ironman_timeseries_activity_schema = [
    { name: "year", mode: "NULLABLE", type: "INTEGER", description: "Race calendar year", fields: [] },
    { name: "is_ironman_event", mode: "NULLABLE", type: "INTEGER", description: "1 = Ironman event, 0 = non-Ironman", fields: [] },
    { name: "im_distance_bucket", mode: "NULLABLE", type: "STRING", description: "ironman_70_3 / ironman_140_6 / non_ironman", fields: [] },
    { name: "name_distance_types", mode: "NULLABLE", type: "STRING", description: "Distance type name", fields: [] },
    { name: "name_race_type", mode: "NULLABLE", type: "STRING", description: "Race type name", fields: [] },
    { name: "category", mode: "NULLABLE", type: "STRING", description: "Race category", fields: [] },
    { name: "gender_code", mode: "NULLABLE", type: "STRING", description: "Gender code", fields: [] },
    { name: "age_as_race_results_bin", mode: "NULLABLE", type: "STRING", description: "Age bucket", fields: [] },

    { name: "count_distinct_profiles", mode: "NULLABLE", type: "INTEGER", description: "Distinct Ironman-participant profiles active in cell", fields: [] },
    { name: "count_distinct_races", mode: "NULLABLE", type: "INTEGER", description: "Distinct races in cell", fields: [] },
    { name: "count_rows", mode: "NULLABLE", type: "INTEGER", description: "Raw race-result rows in cell", fields: [] },

    { name: "created_at_mtn", mode: "NULLABLE", type: "STRING", description: "Created at (Mountain)", fields: [] },
    { name: "created_at_utc", mode: "NULLABLE", type: "STRING", description: "Created at (UTC)", fields: [] },
];

module.exports = {
    ironman_timeseries_activity_schema,
};

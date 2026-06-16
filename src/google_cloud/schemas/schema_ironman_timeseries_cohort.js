// BigQuery schema for ironman_timeseries_cohort_data.
// Order MUST match query_ironman_timeseries_cohort.js.
const ironman_timeseries_cohort_schema = [
    { name: "first_im_year", mode: "NULLABLE", type: "INTEGER", description: "First-Ironman cohort year", fields: [] },
    { name: "first_im_distance_bucket", mode: "NULLABLE", type: "STRING", description: "First-Ironman distance bucket", fields: [] },
    { name: "first_im_age_bucket", mode: "NULLABLE", type: "STRING", description: "Age bucket at first Ironman", fields: [] },
    { name: "first_im_gender", mode: "NULLABLE", type: "STRING", description: "Gender at first Ironman", fields: [] },
    { name: "first_im_category", mode: "NULLABLE", type: "STRING", description: "Category at first Ironman", fields: [] },
    { name: "first_im_race_type", mode: "NULLABLE", type: "STRING", description: "Race type at first Ironman", fields: [] },

    { name: "count_participants", mode: "NULLABLE", type: "INTEGER", description: "Participants in cohort cell", fields: [] },
    { name: "count_continued_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Participants who raced after last Ironman", fields: [] },
    { name: "retention_rate", mode: "NULLABLE", type: "FLOAT", description: "Share who continued after last Ironman", fields: [] },
    { name: "avg_races_after_last_im", mode: "NULLABLE", type: "FLOAT", description: "Avg races after last Ironman", fields: [] },
    { name: "avg_years_after_last_im", mode: "NULLABLE", type: "FLOAT", description: "Avg active years after last Ironman", fields: [] },
    { name: "pct_repeat_ironman", mode: "NULLABLE", type: "FLOAT", description: "Share who did another Ironman after their first", fields: [] },
    { name: "pct_one_and_done", mode: "NULLABLE", type: "FLOAT", description: "Share with exactly one Ironman and no races after", fields: [] },
    { name: "count_raced_within_12m", mode: "NULLABLE", type: "INTEGER", description: "Raced within 12 months after last Ironman", fields: [] },
    { name: "count_raced_within_24m", mode: "NULLABLE", type: "INTEGER", description: "Raced within 24 months after last Ironman", fields: [] },
    { name: "count_raced_within_36m", mode: "NULLABLE", type: "INTEGER", description: "Raced within 36 months after last Ironman", fields: [] },

    { name: "created_at_mtn", mode: "NULLABLE", type: "STRING", description: "Created at (Mountain)", fields: [] },
    { name: "created_at_utc", mode: "NULLABLE", type: "STRING", description: "Created at (UTC)", fields: [] },
];

module.exports = {
    ironman_timeseries_cohort_schema,
};

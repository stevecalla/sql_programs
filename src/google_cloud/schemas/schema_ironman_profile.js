// BigQuery schema for ironman_profile_data.
// Order MUST match query_ironman_profile.js (BigQuery loads CSV by column position).
const ironman_profile_schema = [
    { name: "id_profile_rr", mode: "NULLABLE", type: "INTEGER", description: "Race-results profile id", fields: [] },

    // FIRST IRONMAN
    { name: "first_im_date", mode: "NULLABLE", type: "STRING", description: "Date of first Ironman race", fields: [] },
    { name: "first_im_year", mode: "NULLABLE", type: "INTEGER", description: "Year of first Ironman", fields: [] },
    { name: "first_im_age", mode: "NULLABLE", type: "INTEGER", description: "Age at first Ironman", fields: [] },
    { name: "first_im_age_bucket", mode: "NULLABLE", type: "STRING", description: "Age bucket at first Ironman", fields: [] },
    { name: "first_im_gender", mode: "NULLABLE", type: "STRING", description: "Gender at first Ironman", fields: [] },
    { name: "first_im_distance_bucket", mode: "NULLABLE", type: "STRING", description: "ironman_70_3 / ironman_140_6", fields: [] },
    { name: "first_im_distance_type", mode: "NULLABLE", type: "STRING", description: "Distance type name at first Ironman", fields: [] },
    { name: "first_im_race_type", mode: "NULLABLE", type: "STRING", description: "Race type at first Ironman", fields: [] },
    { name: "first_im_category", mode: "NULLABLE", type: "STRING", description: "Category at first Ironman", fields: [] },
    { name: "first_im_region", mode: "NULLABLE", type: "STRING", description: "Region at first Ironman", fields: [] },

    // LAST IRONMAN
    { name: "last_im_date", mode: "NULLABLE", type: "STRING", description: "Date of last Ironman race", fields: [] },
    { name: "last_im_year", mode: "NULLABLE", type: "INTEGER", description: "Year of last Ironman", fields: [] },
    { name: "last_im_age", mode: "NULLABLE", type: "INTEGER", description: "Age at last Ironman", fields: [] },
    { name: "last_im_distance_bucket", mode: "NULLABLE", type: "STRING", description: "Distance bucket at last Ironman", fields: [] },

    // COUNTS
    { name: "count_races_total", mode: "NULLABLE", type: "INTEGER", description: "Total distinct races", fields: [] },
    { name: "count_ironman_races", mode: "NULLABLE", type: "INTEGER", description: "Distinct Ironman races", fields: [] },
    { name: "count_im_140_6", mode: "NULLABLE", type: "INTEGER", description: "Distinct 140.6 (full) Ironman races", fields: [] },
    { name: "count_im_70_3", mode: "NULLABLE", type: "INTEGER", description: "Distinct 70.3 Ironman races", fields: [] },
    { name: "count_non_ironman_races", mode: "NULLABLE", type: "INTEGER", description: "Distinct non-Ironman races", fields: [] },
    { name: "count_start_years", mode: "NULLABLE", type: "INTEGER", description: "Distinct start years", fields: [] },
    { name: "first_race_year", mode: "NULLABLE", type: "INTEGER", description: "First race year overall", fields: [] },
    { name: "last_race_year", mode: "NULLABLE", type: "INTEGER", description: "Last race year overall", fields: [] },

    // POST-IRONMAN BEHAVIOR
    { name: "races_after_first_im", mode: "NULLABLE", type: "INTEGER", description: "Distinct races after first Ironman", fields: [] },
    { name: "races_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Distinct races after last Ironman", fields: [] },
    { name: "non_im_races_after_first_im", mode: "NULLABLE", type: "INTEGER", description: "Non-Ironman races after first Ironman", fields: [] },
    { name: "im_races_after_first_im", mode: "NULLABLE", type: "INTEGER", description: "Ironman races after first Ironman", fields: [] },
    { name: "years_after_first_im", mode: "NULLABLE", type: "INTEGER", description: "Distinct active years after first Ironman", fields: [] },
    { name: "years_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Distinct active years after last Ironman", fields: [] },
    { name: "continued_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "1 if any race after last Ironman", fields: [] },
    { name: "continued_after_first_im", mode: "NULLABLE", type: "INTEGER", description: "1 if any race after first Ironman", fields: [] },
    { name: "raced_within_12m_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Raced within 12 months after last Ironman", fields: [] },
    { name: "raced_within_24m_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Raced within 24 months after last Ironman", fields: [] },
    { name: "raced_within_36m_after_last_im", mode: "NULLABLE", type: "INTEGER", description: "Raced within 36 months after last Ironman", fields: [] },

    { name: "behavior_segment", mode: "NULLABLE", type: "STRING", description: "one_and_done / repeat_ironman / continued_non_ironman / lapsed_after_ironman", fields: [] },

    // CHRONOLOGICAL EVENT HISTORIES
    { name: "event_timeline", mode: "NULLABLE", type: "STRING", description: "Start-date-ordered tagged event history (all events)", fields: [] },
    { name: "ironman_event_timeline", mode: "NULLABLE", type: "STRING", description: "Start-date-ordered Ironman events", fields: [] },
    { name: "non_ironman_event_timeline", mode: "NULLABLE", type: "STRING", description: "Start-date-ordered non-Ironman events", fields: [] },

    // CREATED AT DATES
    { name: "created_at_mtn", mode: "NULLABLE", type: "STRING", description: "Created at (Mountain)", fields: [] },
    { name: "created_at_utc", mode: "NULLABLE", type: "STRING", description: "Created at (UTC)", fields: [] },
];

module.exports = {
    ironman_profile_schema,
};

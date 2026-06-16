// Paginated extract of im_participation_5_timeseries_activity for BigQuery.
// Column order MUST match schema_ironman_timeseries_activity.js.
async function query_ironman_timeseries_activity(batch_size = 10, offset = 0) {
    return `
        SELECT
            IFNULL(year, '') AS year,
            IFNULL(is_ironman_event, '') AS is_ironman_event,
            im_distance_bucket,
            name_distance_types,
            name_race_type,
            category,
            gender_code,
            age_as_race_results_bin,

            IFNULL(count_distinct_profiles, '') AS count_distinct_profiles,
            IFNULL(count_distinct_races, '') AS count_distinct_races,
            IFNULL(count_rows, '') AS count_rows,

            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM im_participation_5_timeseries_activity
        ORDER BY year, is_ironman_event, im_distance_bucket
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_ironman_timeseries_activity,
};

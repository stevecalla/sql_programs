// Paginated extract of im_participation_4_timeseries_cohort for BigQuery.
// Column order MUST match schema_ironman_timeseries_cohort.js.
async function query_ironman_timeseries_cohort(batch_size = 10, offset = 0) {
    return `
        SELECT
            IFNULL(first_im_year, '') AS first_im_year,
            first_im_distance_bucket,
            first_im_age_bucket,
            first_im_gender,
            first_im_category,
            first_im_race_type,

            IFNULL(count_participants, '') AS count_participants,
            IFNULL(count_continued_after_last_im, '') AS count_continued_after_last_im,
            IFNULL(retention_rate, '') AS retention_rate,
            IFNULL(avg_races_after_last_im, '') AS avg_races_after_last_im,
            IFNULL(avg_years_after_last_im, '') AS avg_years_after_last_im,
            IFNULL(pct_repeat_ironman, '') AS pct_repeat_ironman,
            IFNULL(pct_one_and_done, '') AS pct_one_and_done,
            IFNULL(count_raced_within_12m, '') AS count_raced_within_12m,
            IFNULL(count_raced_within_24m, '') AS count_raced_within_24m,
            IFNULL(count_raced_within_36m, '') AS count_raced_within_36m,

            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM im_participation_4_timeseries_cohort
        ORDER BY first_im_year, first_im_distance_bucket, first_im_age_bucket, first_im_gender
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_ironman_timeseries_cohort,
};

// Paginated extract of im_participation_3_profile for BigQuery load + CSV export.
// Column order MUST match schema_ironman_profile.js (BigQuery loads by position).
async function query_ironman_profile(batch_size = 10, offset = 0) {
    return `
        SELECT
            id_profile_rr,

            -- ******************
            -- FIRST IRONMAN
            -- ******************
            DATE_FORMAT(first_im_date, '%Y-%m-%d') AS first_im_date,
            IFNULL(first_im_year, '') AS first_im_year,
            IFNULL(first_im_age, '') AS first_im_age,
            first_im_age_bucket,
            first_im_gender,
            first_im_distance_bucket,
            first_im_distance_type,
            first_im_race_type,
            first_im_category,
            first_im_region,

            -- ******************
            -- LAST IRONMAN
            -- ******************
            DATE_FORMAT(last_im_date, '%Y-%m-%d') AS last_im_date,
            IFNULL(last_im_year, '') AS last_im_year,
            IFNULL(last_im_age, '') AS last_im_age,
            last_im_distance_bucket,

            -- ******************
            -- COUNTS
            -- ******************
            IFNULL(count_races_total, '') AS count_races_total,
            IFNULL(count_ironman_races, '') AS count_ironman_races,
            IFNULL(count_im_140_6, '') AS count_im_140_6,
            IFNULL(count_im_70_3, '') AS count_im_70_3,
            IFNULL(count_non_ironman_races, '') AS count_non_ironman_races,
            IFNULL(count_start_years, '') AS count_start_years,
            IFNULL(first_race_year, '') AS first_race_year,
            IFNULL(last_race_year, '') AS last_race_year,

            -- ******************
            -- POST-IRONMAN BEHAVIOR
            -- ******************
            IFNULL(races_after_first_im, '') AS races_after_first_im,
            IFNULL(races_after_last_im, '') AS races_after_last_im,
            IFNULL(non_im_races_after_first_im, '') AS non_im_races_after_first_im,
            IFNULL(im_races_after_first_im, '') AS im_races_after_first_im,
            IFNULL(years_after_first_im, '') AS years_after_first_im,
            IFNULL(years_after_last_im, '') AS years_after_last_im,
            IFNULL(continued_after_last_im, '') AS continued_after_last_im,
            IFNULL(continued_after_first_im, '') AS continued_after_first_im,
            IFNULL(raced_within_12m_after_last_im, '') AS raced_within_12m_after_last_im,
            IFNULL(raced_within_24m_after_last_im, '') AS raced_within_24m_after_last_im,
            IFNULL(raced_within_36m_after_last_im, '') AS raced_within_36m_after_last_im,

            behavior_segment,

            -- ******************
            -- CHRONOLOGICAL EVENT HISTORIES
            -- ******************
            REPLACE(REPLACE(REPLACE(event_timeline, '\r', ''), '\n', ' '), '"', '') AS event_timeline,
            REPLACE(REPLACE(REPLACE(ironman_event_timeline, '\r', ''), '\n', ' '), '"', '') AS ironman_event_timeline,
            REPLACE(REPLACE(REPLACE(non_ironman_event_timeline, '\r', ''), '\n', ' '), '"', '') AS non_ironman_event_timeline,

            -- ******************
            -- CREATED AT DATES
            -- ******************
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM im_participation_3_profile
        WHERE id_profile_rr IS NOT NULL
        ORDER BY id_profile_rr
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_ironman_profile,
};

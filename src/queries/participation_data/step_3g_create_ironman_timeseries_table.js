// IRONMAN TIME-SERIES ROLLUPS
//   #4 im_participation_4_timeseries_cohort   — cohort retention by first-Ironman year x dims (from #3)
//   #5 im_participation_5_timeseries_activity — activity by calendar year x dims (from #2)

async function created_at_mtn() {
    return `
        SET @created_at_mtn = (
            SELECT CASE
                WHEN UTC_TIMESTAMP() >= DATE_ADD(
                        DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01'),
                            INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01')) + 1) % 7 + 7) DAY),
                        INTERVAL 2 HOUR)
                AND UTC_TIMESTAMP() < DATE_ADD(
                        DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01'),
                            INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01')) + 1) % 7) DAY),
                        INTERVAL 2 HOUR)
                THEN DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -6 HOUR), '%Y-%m-%d %H:%i:%s')
                ELSE DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -7 HOUR), '%Y-%m-%d %H:%i:%s')
                END
        );
    `;
}

async function created_at_utc() {
    return `
        SET @created_at_utc = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s');
    `;
}

// #4 COHORT RETENTION ROLLUP (from #3 profile table)
async function query_create_cohort_table(table_name, profile_table = 'im_participation_3_profile') {
    return `
        ${await created_at_mtn()}
        ${await created_at_utc()}

        CREATE TABLE ${table_name} AS
            SELECT
                first_im_year,
                first_im_distance_bucket,
                first_im_age_bucket,
                first_im_gender,
                first_im_category,
                first_im_race_type,

                COUNT(*)                                                                AS count_participants,
                SUM(continued_after_last_im)                                            AS count_continued_after_last_im,
                AVG(continued_after_last_im)                                            AS retention_rate,
                AVG(races_after_last_im)                                                AS avg_races_after_last_im,
                AVG(years_after_last_im)                                                AS avg_years_after_last_im,
                AVG(CASE WHEN im_races_after_first_im > 0 THEN 1 ELSE 0 END)            AS pct_repeat_ironman,
                AVG(CASE WHEN behavior_segment = 'one_and_done' THEN 1 ELSE 0 END)      AS pct_one_and_done,
                SUM(raced_within_12m_after_last_im)                                     AS count_raced_within_12m,
                SUM(raced_within_24m_after_last_im)                                     AS count_raced_within_24m,
                SUM(raced_within_36m_after_last_im)                                     AS count_raced_within_36m,

                @created_at_mtn AS created_at_mtn,
                @created_at_utc AS created_at_utc

            FROM ${profile_table}
            GROUP BY
                first_im_year, first_im_distance_bucket, first_im_age_bucket,
                first_im_gender, first_im_category, first_im_race_type
        ;
    `;
}

// #5 ACTIVITY-BY-CALENDAR-YEAR ROLLUP (from #2 history)
async function query_create_activity_table(table_name, history_table = 'im_participation_2_history') {
    return `
        ${await created_at_mtn()}
        ${await created_at_utc()}

        CREATE TABLE ${table_name} AS
            SELECT
                start_date_year_races AS year,
                is_ironman_event,
                im_distance_bucket,
                name_distance_types,
                name_race_type,
                category,
                gender_code,
                age_as_race_results_bin,

                COUNT(DISTINCT id_profile_rr) AS count_distinct_profiles,
                COUNT(DISTINCT id_race_rr)    AS count_distinct_races,
                COUNT(*)                      AS count_rows,

                @created_at_mtn AS created_at_mtn,
                @created_at_utc AS created_at_utc

            FROM ${history_table}
            GROUP BY
                start_date_year_races, is_ironman_event, im_distance_bucket,
                name_distance_types, name_race_type, category, gender_code, age_as_race_results_bin
        ;
    `;
}

async function query_append_cohort_indexes(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_first_im_year (first_im_year),
            ADD INDEX idx_first_im_distance_bucket (first_im_distance_bucket),
            ADD INDEX idx_first_im_age_bucket (first_im_age_bucket),
            ADD INDEX idx_first_im_gender (first_im_gender);
    `;
}

async function query_append_activity_indexes(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_year (year),
            ADD INDEX idx_is_ironman_event (is_ironman_event),
            ADD INDEX idx_im_distance_bucket (im_distance_bucket),
            ADD INDEX idx_name_distance_types (name_distance_types),
            ADD INDEX idx_name_race_type (name_race_type),
            ADD INDEX idx_gender_code (gender_code);
    `;
}

module.exports = {
    query_create_cohort_table,
    query_create_activity_table,
    query_append_cohort_indexes,
    query_append_activity_indexes,
};

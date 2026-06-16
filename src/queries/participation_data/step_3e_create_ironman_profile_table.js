// IRONMAN PARTICIPANT BEHAVIOR — PROFILE TABLE QUERIES
// Source: all_participation_data_with_membership_match (race-result grain)
// Produces (only 3 persisted tables):
//   #1 im_participation_1_profile_ids  — distinct Ironman participants
//   #2 im_participation_2_history      — full race history of those profiles + derived flags
//   #3 im_participation_3_profile      — one row per profile (FINAL)
// The per-batch insert (step_c) runs the full behavior query against a 50k-profile slice of #2.

// Single source of truth for the IRONMAN classification rule (see ../ironman_rule.js).
const { ironman_event_predicate } = require('../ironman_rule');

// GET CURRENT DATE IN MTN (MST OR MDT)
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

// STEP A: CREATE FINAL PROFILE TABLE (one row per id_profile_rr)
async function step_a_create_ironman_profile_table(table_name) {
    return `
        CREATE TABLE IF NOT EXISTS ${table_name} (
            id_profile_rr VARCHAR(255),

            CONSTRAINT idx_profile_id UNIQUE (id_profile_rr),

            -- ******************
            -- FIRST IRONMAN
            -- ******************
            first_im_date DATE,
            first_im_year INT,
            first_im_age INT,
            first_im_age_bucket VARCHAR(15),
            first_im_gender VARCHAR(50),
            first_im_distance_bucket VARCHAR(20),
            first_im_distance_type VARCHAR(255),
            first_im_race_type VARCHAR(255),
            first_im_category VARCHAR(50),
            first_im_region VARCHAR(100),

            -- ******************
            -- LAST IRONMAN
            -- ******************
            last_im_date DATE,
            last_im_year INT,
            last_im_age INT,
            last_im_distance_bucket VARCHAR(20),

            -- ******************
            -- COUNTS
            -- ******************
            count_races_total INT,
            count_ironman_races INT,
            count_im_140_6 INT,
            count_im_70_3 INT,
            count_non_ironman_races INT,
            count_start_years INT,
            first_race_year INT,
            last_race_year INT,

            -- ******************
            -- POST-IRONMAN BEHAVIOR
            -- ******************
            races_after_first_im INT,
            races_after_last_im INT,
            non_im_races_after_first_im INT,
            im_races_after_first_im INT,
            years_after_first_im INT,
            years_after_last_im INT,
            continued_after_last_im INT,
            continued_after_first_im INT,
            raced_within_12m_after_last_im INT,
            raced_within_24m_after_last_im INT,
            raced_within_36m_after_last_im INT,

            behavior_segment VARCHAR(30),

            -- Position of each Ironman within ALL of the profile's races (date order),
            -- e.g. "2 | 4 | 7" = their 2nd, 4th and 7th races were the Ironmans.
            ironman_race_positions TEXT,

            -- ******************
            -- CHRONOLOGICAL EVENT HISTORIES (start-date ordered)
            -- ******************
            event_timeline MEDIUMTEXT,
            ironman_event_timeline MEDIUMTEXT,
            non_ironman_event_timeline MEDIUMTEXT,

            -- CREATED AT DATES
            created_at_mtn DATETIME,
            created_at_utc DATETIME
        );
    `;
}

// STEP B: CREATE #1 DISTINCT IRONMAN PARTICIPANT IDS
async function step_b_create_distinct_profile_id_table(table_name) {
    return `
        CREATE TABLE ${table_name} (
            id_profile_rr VARCHAR(255) NOT NULL,
            PRIMARY KEY (id_profile_rr)
        ) AS
        SELECT DISTINCT id_profile_rr AS id_profile_rr
        FROM all_participation_data_with_membership_match
        WHERE id_profile_rr IS NOT NULL AND id_profile_rr <> ''
          -- OLD RULE (name must contain "ironman"):
          --   AND LOWER(name_events_rr) LIKE '%ironman%'
          -- NEW RULE: shared curated predicate (see ../ironman_rule.js).
          AND ${ironman_event_predicate('name_events_rr')};

        ALTER TABLE ${table_name}
            ADD INDEX idx_profile_id (id_profile_rr);
    `;
}

// STEP D: CREATE #2 FULL HISTORY OF IRONMAN PARTICIPANTS + DERIVED FLAGS
async function step_d_create_history_table(table_name, profile_id_table = 'im_participation_1_profile_ids') {
    return `
        CREATE TABLE ${table_name} AS
        SELECT
            m.id_profile_rr AS id_profile_rr,
            m.id_rr, m.id_race_rr,
            m.name_events_rr, m.name_distance_types, m.name_race_type, m.category,
            m.age, m.age_as_race_results_bin, m.gender_code, m.region_name,
            m.start_date_races, m.start_date_year_races,
            -- OLD is_ironman_event (name must contain "ironman"):
            --   CASE WHEN LOWER(m.name_events_rr) LIKE '%ironman%' THEN 1 ELSE 0 END AS is_ironman_event,
            -- NEW: shared curated predicate (see ../ironman_rule.js).
            CASE WHEN ${ironman_event_predicate('m.name_events_rr')} THEN 1 ELSE 0 END AS is_ironman_event,
            -- im_distance_bucket — leading "is Ironman?" test uses the SAME shared predicate as is_ironman_event.
            CASE
                WHEN ${ironman_event_predicate('m.name_events_rr')}
                     AND (m.name_events_rr LIKE '%70.3%'  OR LOWER(m.name_distance_types) LIKE '%70.3%'
                          OR LOWER(m.name_distance_types) LIKE '%half%'
                          OR LOWER(m.name_distance_types) = 'long')   THEN 'ironman_70_3'
                WHEN ${ironman_event_predicate('m.name_events_rr')}
                     AND (m.name_events_rr LIKE '%140.6%' OR LOWER(m.name_distance_types) LIKE '%140.6%'
                          OR LOWER(m.name_distance_types) LIKE '%full%'
                          OR LOWER(m.name_distance_types) = 'ultra')  THEN 'ironman_140_6'
                WHEN ${ironman_event_predicate('m.name_events_rr')}    THEN 'ironman_140_6'
                ELSE 'non_ironman'
            END AS im_distance_bucket
        FROM all_participation_data_with_membership_match m
            JOIN ${profile_id_table} p ON m.id_profile_rr = p.id_profile_rr;
    `;
}

// STEP D (part 2): INDEX #2 HISTORY (run + timed separately to diagnose the build).
async function query_append_history_indexes(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_profile_date (id_profile_rr, start_date_races),
            ADD INDEX idx_profile_im   (id_profile_rr, is_ironman_event);
    `;
}

// STEP C-PREP: MATERIALIZE A SMALL, INDEXED PER-BATCH SLICE OF #2 HISTORY.
// Uses a keyset RANGE on id_profile_rr (index-friendly) instead of a 50k-value IN() list.
// `where_range` is injected as: AND id_profile_rr > '<prev>' AND id_profile_rr <= '<cur>'
// The resulting small table is scanned by the step_c CTEs (cheap even if re-evaluated).
async function step_d_create_history_batch_table(batch_table, history_table, where_range = '') {
    return `
        CREATE TABLE ${batch_table} AS
            SELECT *
            FROM ${history_table}
            WHERE 1 = 1
                ${where_range}
        ;

        ALTER TABLE ${batch_table}
            ADD INDEX idx_profile_date (id_profile_rr, start_date_races),
            ADD INDEX idx_profile_im   (id_profile_rr, is_ironman_event);
    `;
}

// STEP C: PER-BATCH INSERT INTO FINAL PROFILE TABLE
// Reads FROM the already-filtered batch slice table, so `where` is normally '' (no IN-list).
async function step_c_insert_ironman_profiles(final_table, history_table, where = '', limit = '') {
    return `
        SET SESSION group_concat_max_len = 1000000;

        ${await created_at_mtn()}
        ${await created_at_utc()}

        INSERT IGNORE INTO ${final_table}
        WITH base AS (
            SELECT
                id_profile_rr,
                id_rr, id_race_rr,
                name_events_rr, name_distance_types, name_race_type, category,
                age, age_as_race_results_bin, gender_code, region_name,
                start_date_races, start_date_year_races,
                is_ironman_event, im_distance_bucket,
                -- Overall race position within the profile's whole racing cycle (date order).
                ROW_NUMBER() OVER (PARTITION BY id_profile_rr ORDER BY start_date_races ASC, id_rr ASC) AS race_seq
            FROM ${history_table}
            WHERE id_profile_rr IS NOT NULL AND id_profile_rr <> ''
                ${where}
        ),
        first_im AS (
            SELECT * FROM (
                SELECT id_profile_rr,
                    start_date_races AS first_im_date, start_date_year_races AS first_im_year,
                    age AS first_im_age, age_as_race_results_bin AS first_im_age_bucket,
                    gender_code AS first_im_gender, im_distance_bucket AS first_im_distance_bucket,
                    name_distance_types AS first_im_distance_type, name_race_type AS first_im_race_type,
                    category AS first_im_category, region_name AS first_im_region,
                    ROW_NUMBER() OVER (PARTITION BY id_profile_rr ORDER BY start_date_races ASC, id_rr ASC) AS rn
                FROM base WHERE is_ironman_event = 1
            ) t WHERE rn = 1
        ),
        last_im AS (
            SELECT * FROM (
                SELECT id_profile_rr,
                    start_date_races AS last_im_date, start_date_year_races AS last_im_year,
                    age AS last_im_age, im_distance_bucket AS last_im_distance_bucket,
                    ROW_NUMBER() OVER (PARTITION BY id_profile_rr ORDER BY start_date_races DESC, id_rr DESC) AS rn
                FROM base WHERE is_ironman_event = 1
            ) t WHERE rn = 1
        ),
        agg AS (
            SELECT id_profile_rr,
                COUNT(DISTINCT id_race_rr)                                              AS count_races_total,
                COUNT(DISTINCT CASE WHEN is_ironman_event = 1      THEN id_race_rr END) AS count_ironman_races,
                COUNT(DISTINCT CASE WHEN im_distance_bucket='ironman_140_6' THEN id_race_rr END) AS count_im_140_6,
                COUNT(DISTINCT CASE WHEN im_distance_bucket='ironman_70_3'  THEN id_race_rr END) AS count_im_70_3,
                COUNT(DISTINCT CASE WHEN is_ironman_event = 0      THEN id_race_rr END) AS count_non_ironman_races,
                COUNT(DISTINCT start_date_year_races)                                   AS count_start_years,
                MIN(start_date_year_races) AS first_race_year,
                MAX(start_date_year_races) AS last_race_year
            FROM base GROUP BY id_profile_rr
        ),
        timeline AS (
            SELECT id_profile_rr,
                GROUP_CONCAT(
                    CONCAT(
                        DATE_FORMAT(start_date_races, '%Y-%m-%d'), ' ',
                        CASE WHEN is_ironman_event = 1 THEN CONCAT('[', im_distance_bucket, ']') ELSE '[non-IM]' END,
                        ' ', name_distance_types, ' | ', name_events_rr
                    )
                    ORDER BY start_date_races ASC, id_rr ASC
                    SEPARATOR '  >>  '
                ) AS event_timeline,
                GROUP_CONCAT(
                    CASE WHEN is_ironman_event = 1 THEN
                        CONCAT(DATE_FORMAT(start_date_races, '%Y-%m-%d'), ' [', im_distance_bucket, '] ', name_events_rr)
                    END
                    ORDER BY start_date_races ASC, id_rr ASC
                    SEPARATOR '  >>  '
                ) AS ironman_event_timeline,
                GROUP_CONCAT(
                    CASE WHEN is_ironman_event = 0 THEN
                        CONCAT(DATE_FORMAT(start_date_races, '%Y-%m-%d'), ' ', name_distance_types, ' | ', name_events_rr)
                    END
                    ORDER BY start_date_races ASC, id_rr ASC
                    SEPARATOR '  >>  '
                ) AS non_ironman_event_timeline,
                -- Position of each Ironman within ALL races (date order), e.g. "2 | 4 | 7".
                GROUP_CONCAT(
                    CASE WHEN is_ironman_event = 1 THEN race_seq END
                    ORDER BY start_date_races ASC, id_rr ASC
                    SEPARATOR ' | '
                ) AS ironman_race_positions
            FROM base GROUP BY id_profile_rr
        ),
        post AS (
            SELECT bi.id_profile_rr,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > f.first_im_date THEN bi.id_race_rr END)                           AS races_after_first_im,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > l.last_im_date  THEN bi.id_race_rr END)                           AS races_after_last_im,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > f.first_im_date AND bi.is_ironman_event=0 THEN bi.id_race_rr END) AS non_im_races_after_first_im,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > f.first_im_date AND bi.is_ironman_event=1 THEN bi.id_race_rr END) AS im_races_after_first_im,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > f.first_im_date THEN bi.start_date_year_races END)                AS years_after_first_im,
                COUNT(DISTINCT CASE WHEN bi.start_date_races > l.last_im_date  THEN bi.start_date_year_races END)                AS years_after_last_im,
                MAX(CASE WHEN bi.start_date_races > l.last_im_date AND bi.start_date_races <= l.last_im_date + INTERVAL 12 MONTH THEN 1 ELSE 0 END) AS raced_within_12m_after_last_im,
                MAX(CASE WHEN bi.start_date_races > l.last_im_date AND bi.start_date_races <= l.last_im_date + INTERVAL 24 MONTH THEN 1 ELSE 0 END) AS raced_within_24m_after_last_im,
                MAX(CASE WHEN bi.start_date_races > l.last_im_date AND bi.start_date_races <= l.last_im_date + INTERVAL 36 MONTH THEN 1 ELSE 0 END) AS raced_within_36m_after_last_im
            FROM base bi
                JOIN first_im f ON bi.id_profile_rr = f.id_profile_rr
                JOIN last_im  l ON bi.id_profile_rr = l.id_profile_rr
            GROUP BY bi.id_profile_rr
        )
        SELECT
            f.id_profile_rr,

            f.first_im_date, f.first_im_year, f.first_im_age, f.first_im_age_bucket, f.first_im_gender,
            f.first_im_distance_bucket, f.first_im_distance_type, f.first_im_race_type,
            f.first_im_category, f.first_im_region,

            l.last_im_date, l.last_im_year, l.last_im_age, l.last_im_distance_bucket,

            a.count_races_total, a.count_ironman_races, a.count_im_140_6, a.count_im_70_3,
            a.count_non_ironman_races, a.count_start_years, a.first_race_year, a.last_race_year,

            p.races_after_first_im, p.races_after_last_im, p.non_im_races_after_first_im,
            p.im_races_after_first_im, p.years_after_first_im, p.years_after_last_im,
            CASE WHEN p.races_after_last_im  > 0 THEN 1 ELSE 0 END AS continued_after_last_im,
            CASE WHEN p.races_after_first_im > 0 THEN 1 ELSE 0 END AS continued_after_first_im,
            p.raced_within_12m_after_last_im, p.raced_within_24m_after_last_im, p.raced_within_36m_after_last_im,

            CASE
                WHEN p.races_after_last_im = 0 AND a.count_ironman_races = 1 THEN 'one_and_done'
                WHEN p.im_races_after_first_im > 0                          THEN 'repeat_ironman'
                WHEN p.races_after_last_im  > 0                             THEN 'continued_non_ironman'
                ELSE 'lapsed_after_ironman'
            END AS behavior_segment,

            t.ironman_race_positions,

            t.event_timeline,
            t.ironman_event_timeline,
            t.non_ironman_event_timeline,

            @created_at_mtn AS created_at_mtn,
            @created_at_utc AS created_at_utc

        FROM first_im f
            JOIN last_im  l ON f.id_profile_rr = l.id_profile_rr
            JOIN agg      a ON f.id_profile_rr = a.id_profile_rr
            JOIN post     p ON f.id_profile_rr = p.id_profile_rr
            JOIN timeline t ON f.id_profile_rr = t.id_profile_rr
        ${limit};
    `;
}

// STEP III: APPEND INDEXES TO FINAL TABLE (slicing dimensions)
async function query_append_index_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_first_im_year (first_im_year),
            ADD INDEX idx_first_im_distance_bucket (first_im_distance_bucket),
            ADD INDEX idx_first_im_age_bucket (first_im_age_bucket),
            ADD INDEX idx_first_im_gender (first_im_gender),
            ADD INDEX idx_first_im_category (first_im_category),
            ADD INDEX idx_first_im_race_type (first_im_race_type),
            ADD INDEX idx_last_im_year (last_im_year),
            ADD INDEX idx_behavior_segment (behavior_segment);
    `;
}

module.exports = {
    step_a_create_ironman_profile_table,
    step_b_create_distinct_profile_id_table,
    step_d_create_history_table,
    query_append_history_indexes,
    step_d_create_history_batch_table,
    step_c_insert_ironman_profiles,
    query_append_index_fields,
};

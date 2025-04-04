// tbd C:\Users\calla\development\usat\sql_code\5_race_participation\final_3_1_local_paticiption_profiles_031825.sql

async function created_at_mtn() {
    return `
        -- GET CURRENT DATE IN MTN (MST OR MDT) & UTC
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

// CTE = raw_participation_data
async function raw_participation_data(table_name, where, limit) {
    return `
        CREATE TABLE ${table_name} AS
            WITH raw_participation_data AS (
                SELECT
                    id_profile_rr AS profile_id,
                    id_rr,
                    id_race_rr,
                    id_sanctioning_events,

                    start_date_races,
                    MONTH(start_date_races) AS start_date_month_races,
                    start_date_year_races,

                    region_name,
                    zip_events,
                    city_events,
                    state_code_events,

                    name_race_type,
                    name_distance_types,
                    name_event_type,
                    name_events_rr,

                    is_ironman,

                    gender_code,
                    age,

                    region_name_member,
                    member_city_addresses,
                    member_state_code_addresses,
                    member_postal_code_addresses,
                    member_lat_addresses,
                    member_lng_addresses,

                    id_membership_periods_sa,
                    real_membership_types_sa,

                    member_min_created_at_year,
                    new_member_category_6_sa,
                    member_created_at_category,

                    starts_mp,
                    ends_mp,

                    is_active_membership,

                    purchased_on_date_adjusted_mp,
                    sales_units,
                    sales_revenue,
                    purchased_on_year_adjusted_mp

                FROM all_participation_data_with_membership_match
                WHERE 1 = 1
                    ${where}
                ${limit}

                -- WHERE id_profile_rr = 489329 
                -- LIMIT 1000
            )
        `
    ;
}

async function least_recent_fields(table_name) {
    return `
        , least_recent_fields AS (
        SELECT 
            r.profile_id,
            r.real_membership_types_sa AS least_recent_membership_type,
            r.member_created_at_category AS least_recent_member_created_at_category,
            r.member_min_created_at_year
        FROM ${table_name} r
        INNER JOIN (
            SELECT profile_id, MIN(start_date_races) AS min_start_date
            FROM ${table_name}
            GROUP BY profile_id
        ) lr
            ON r.profile_id = lr.profile_id 
            AND r.start_date_races = lr.min_start_date
        )    
    `;
}

async function most_recent_fields(table_name) {
    return `
        -- ======================================================
        -- 3. Most Recent Fields
        -- ======================================================
        , most_recent_fields AS (
        SELECT 
            r.profile_id,
            r.region_name AS most_recent_region_name,
            r.city_events AS most_recent_city_events,
            r.state_code_events AS most_recent_state_code_events,
            r.name_race_type AS most_recent_name_race_type,
            r.name_distance_types AS most_recent_name_distance_types,
            r.name_event_type AS most_recent_name_event_type,
            r.name_events_rr AS most_recent_name_events,
            r.zip_events AS most_recent_zip_events,
            r.is_ironman AS most_recent_is_ironman,
            r.gender_code AS most_recent_gender_code,
            r.age AS most_recent_age,
            r.region_name_member AS most_recent_region_name_member,
            r.member_city_addresses AS most_recent_member_city_addresses,
            r.member_state_code_addresses AS most_recent_member_state_code_addresses,
            r.member_postal_code_addresses AS most_recent_member_postal_code_addresses,
            r.member_lat_addresses AS most_recent_member_lat_addresses,
            r.member_lng_addresses AS most_recent_member_lng_addresses,
            r.id_membership_periods_sa AS most_recent_id_membership_period_sa,
            r.real_membership_types_sa AS most_recent_membership_type,
            r.new_member_category_6_sa AS most_recent_new_member_category_6_sa,
            r.member_created_at_category AS most_recent_member_created_at_category,
            r.starts_mp AS most_recent_starts_mp,
            r.ends_mp AS most_recent_ends_mp

        FROM ${table_name} r
        INNER JOIN (
            SELECT profile_id, MAX(start_date_races) AS max_start_date
            FROM ${table_name}
            GROUP BY profile_id
        ) mr
            ON r.profile_id = mr.profile_id 
            AND r.start_date_races = mr.max_start_date
        )
    `;
}

// STEP #1b: CREATE PARTICIPATION PROFILE TABLE
async function query_create_participation_profiles(table_name) {
    return `
        -- SET sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''));
        SET SESSION group_concat_max_len = 1000000;
        ${await created_at_mtn()}
        ${await created_at_utc()}

        -- 'AND 1 = 1', 'LIMIT 1000'
        -- 'AND id_profile_rr = 489329', '-- LIMIT 1000'
        -- 'AND id_profile_rr = 489329', '-- LIMIT 1000'
        ${await raw_participation_data(table_name, '', 'LIMIT 1000')}

        ${await least_recent_fields('raw_participation_data')}
        ${await most_recent_fields('raw_participation_data')}

-- ======================================================
-- 2. Aggregated Participation Stats
--    Compute aggregates per profile, grouped into logical sections.
-- ======================================================
, aggregated_participation_stats AS (
    SELECT
        profile_id,
        
        GROUP_CONCAT(DISTINCT start_date_year_races ORDER BY start_date_races ASC) AS start_years_distinct,
        MIN(start_date_races) AS start_date_last_recent,
        MIN(start_date_month_races) AS start_month_least_recent,
        MIN(start_date_year_races) AS start_year_least_recent,

        MAX(start_date_races) AS start_date_most_recent,
        MAX(start_date_month_races) AS start_month_most_recent,
        MAX(start_date_year_races) AS start_year_most_recent,

        GROUP_CONCAT(DISTINCT name_events_rr ORDER BY start_date_races ASC) AS name_events_distinct,
        
        GROUP_CONCAT(DISTINCT id_membership_periods_sa ORDER BY start_date_races ASC) AS id_membership_period_sa_distinct,
        GROUP_CONCAT(DISTINCT starts_mp ORDER BY starts_mp ASC) AS starts_mp_distinct,
        GROUP_CONCAT(DISTINCT ends_mp ORDER BY ends_mp ASC) AS ends_mp_distinct,

        GROUP_CONCAT(DISTINCT is_active_membership ORDER BY start_date_races ASC) AS is_active_membership_distinct,
        SUM(CASE WHEN is_active_membership = 1 THEN 1 ELSE 0 END) AS count_is_membership_match,
        SUM(CASE WHEN is_active_membership = 0 THEN 1 ELSE 0 END) AS count_is_not_membership_match,

        -- [Sales and Purchase Metrics]
        COUNT(DISTINCT id_race_rr) AS count_races_distinct,

        SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) THEN 1 ELSE 0 END) AS count_current_year_races,
        SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) - 1 THEN 1 ELSE 0 END) AS count_prior_year_races,

        COUNT(DISTINCT start_date_year_races) AS count_of_start_years_distinct,
        COUNT(DISTINCT region_name) AS count_of_race_regions_distinct,
        COUNT(purchased_on_year_adjusted_mp) AS count_of_purchased_years_all,
        SUM(sales_units) AS sales_units_total,
        SUM(sales_revenue) AS sales_revenue_total

    FROM raw_participation_data
    GROUP BY profile_id
)

-- ======================================================
-- 3. Aggregate Participation Profile Stats
--    Combine aggregated stats with the latest membership status and apply final filters.
-- ======================================================
, aggregate_participation_profile_stats AS (
    SELECT
        -- [Profile & Race Metrics]
        ap.profile_id,

        -- ******************
        -- MOST RECENT FIELDS 
        -- ******************
        -- [REGION INFO]
        ANY_VALUE(m.most_recent_region_name) AS most_recent_region_name,
        ANY_VALUE(m.most_recent_city_events) AS most_recent_city_events,
        ANY_VALUE(m.most_recent_state_code_events) AS most_recent_state_code_events,

        -- [RACE INFO]
        ANY_VALUE(m.most_recent_name_race_type) AS most_recent_name_race_type,
        ANY_VALUE(m.most_recent_name_distance_types) AS most_recent_name_distance_types,

        -- [EVENT INFO]
        ANY_VALUE(m.most_recent_name_event_type) AS most_recent_name_event_type,
        ANY_VALUE(m.most_recent_name_events) AS most_recent_name_events,
        ANY_VALUE(m.most_recent_zip_events) AS most_recent_zip_events,

        ANY_VALUE(m.most_recent_is_ironman) AS most_recent_is_ironman,
        ANY_VALUE(CASE WHEN m.most_recent_is_ironman = 1 THEN 'yes' ELSE 'no' END) AS is_ironman_flag,

        ANY_VALUE(m.most_recent_gender_code) AS most_recent_gender_code,
        ANY_VALUE(m.most_recent_age) AS most_recent_age,

        -- [MEMBER GEO INFO]
        ANY_VALUE(m.most_recent_region_name_member) AS most_recent_region_name_member,
        ANY_VALUE(m.most_recent_member_city_addresses) AS most_recent_member_city_addresses,
        ANY_VALUE(m.most_recent_member_state_code_addresses) AS most_recent_member_state_code_addresses,
        ANY_VALUE(m.most_recent_member_postal_code_addresses) AS most_recent_member_postal_code_addresses,
        ANY_VALUE(m.most_recent_member_lat_addresses) AS most_recent_member_lat_addresses,
        ANY_VALUE(m.most_recent_member_lng_addresses) AS most_recent_member_lng_addresses,

        -- [MEMBER PERIOD INFO]
        ANY_VALUE(m.most_recent_id_membership_period_sa) AS most_recent_id_membership_period_sa,
        ANY_VALUE(m.most_recent_membership_type) AS most_recent_membership_type,
        ANY_VALUE(m.most_recent_new_member_category_6_sa) AS most_recent_new_member_category_6_sa,
        ANY_VALUE(m.most_recent_member_created_at_category) AS most_recent_member_created_at_category,

        -- [STARTS / ENDS]
        ANY_VALUE(m.most_recent_starts_mp) AS most_recent_starts_mp,
        ANY_VALUE(m.most_recent_ends_mp) AS most_recent_ends_mp,

        -- ******************
        -- LEAST RECENT FIELDS
        -- ******************
        ANY_VALUE(l.least_recent_membership_type) AS least_recent_membership_type,
        ANY_VALUE(l.least_recent_member_created_at_category) AS least_recent_member_created_at_category,
        ANY_VALUE(l.member_min_created_at_year) AS member_min_created_at_year,

        -- ******************
        -- AGGREGATE FIELDS
        -- ******************
        ap.start_years_distinct,
        ap.start_year_least_recent,
        ap.start_year_most_recent,

        ap.name_events_distinct,
        
        ap.id_membership_period_sa_distinct,
        ap.starts_mp_distinct,
        ap.ends_mp_distinct,

        ap.is_active_membership_distinct,
        ap.count_is_membership_match,
        ap.count_is_not_membership_match,

        -- ******************
        -- METRICS
        -- ******************
        ap.count_races_distinct,
        ap.count_of_start_years_distinct,
        ap.count_of_race_regions_distinct,

        ap.count_current_year_races,
        ap.count_prior_year_races,

        ap.count_of_purchased_years_all,
        ap.sales_units_total
        -- ap.sales_revenue_total
        
    FROM aggregated_participation_stats ap
        LEFT JOIN most_recent_fields m ON ap.profile_id = m.profile_id
        LEFT JOIN least_recent_fields l ON ap.profile_id = l.profile_id
    WHERE 1 = 1
        -- AND ap.most_recent_member_created_at_category  = 'created_year'
        -- AND ap.start_year_least_recent > 2022
    GROUP BY ap.profile_id
)

    -- ======================================================
    -- 4. Final Output
    -- ======================================================
    SELECT * FROM aggregate_participation_profile_stats;


    `;
}

// STEP #1C: APPEND INDEXES
async function query_append_index_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_id_race_rr (id_race_rr),
            ADD INDEX idx_id_sanctioning_events (id_sanctioning_events),
            ADD INDEX idx_id_events_rr (id_events_rr),
            
            ADD INDEX idx_name_race_type (name_race_type),
            ADD INDEX idx_name_distance_types (name_distance_types),
            ADD INDEX idx_name_event_type (name_event_type),
            ADD INDEX idx_name_events_rr (name_events_rr),
            
            ADD INDEX idx_gender_code (gender_code),
            ADD INDEX idx_category (category),
            
            ADD INDEX idx_region_name (region_name),
            ADD INDEX idx_city_events (city_events),
            ADD INDEX idx_state_code_events (state_code_events),
            ADD INDEX idx_zip_events (zip_events),
            
            ADD INDEX idx_start_date_races (start_date_races),
            ADD INDEX idx_start_date_year_races (start_date_year_races);
    `;
}

module.exports = {
    query_create_participation_profiles,
    query_append_index_fields
}

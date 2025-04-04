// tbd C:\Users\calla\development\usat\sql_code\5_race_participation\final_3_1_local_paticiption_profiles_031825.sql

// STEP #1b: CREATE PARTICIPATION PROFILE TABLE
async function query_create_participation_profiles(table_name, profile_ids) {
    return `
            -- ======================================================
            -- 0. Set Session Variables & Dates
            -- ======================================================

            SET SESSION group_concat_max_len = 1000000;

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
            SET @created_at_utc = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s');

            -- ======================================================
            -- 1. Raw Participation Data
            -- ======================================================

            DROP TABLE tmp_raw_participation_data; -- todo:

            CREATE TABLE tmp_raw_participation_data AS
                SELECT
                    id_profile_rr AS profile_id,
                    id_rr,
                    id_race_rr,
                    id_sanctioning_events,

                    start_date_races,
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

                -- WHERE id_profile_rr = 489329 -- test
                WHERE id_profile_rr IN (${profile_ids})

                ORDER BY id_profile_rr
                -- LIMIT 1000
                ;

            -- ======================================================
            -- 2. Aggregated Participation Stats
            --    (Fields that don’t depend on recency)
            -- ======================================================
            
            INSERT IGNORE INTO ${table_name}
                WITH aggregated_stats AS (
                    SELECT
                        profile_id,
                        COUNT(DISTINCT id_race_rr) AS count_races_distinct,
                        COUNT(DISTINCT start_date_year_races) AS count_of_start_years_distinct,

                        GROUP_CONCAT(DISTINCT start_date_year_races ORDER BY start_date_races ASC) AS start_years_distinct,
                        MIN(start_date_year_races) AS start_year_least_recent,
                        MAX(start_date_year_races) AS start_year_most_recent,
                        COUNT(DISTINCT region_name) AS count_of_race_regions_distinct,

                        -- GROUP_CONCAT(DISTINCT region_name ORDER BY start_date_races ASC) AS race_regions_distinct,
                        -- GROUP_CONCAT(DISTINCT city_events ORDER BY start_date_races ASC) AS aggregated_city_events,
                        -- GROUP_CONCAT(DISTINCT state_code_events ORDER BY start_date_races ASC) AS aggregated_state_code_events,

                        -- GROUP_CONCAT(DISTINCT name_race_type ORDER BY start_date_races ASC) AS name_race_type_distinct,
                        -- GROUP_CONCAT(DISTINCT name_distance_types ORDER BY start_date_races ASC) AS name_distance_types_distinct,
                        -- GROUP_CONCAT(DISTINCT name_event_type ORDER BY start_date_races ASC) AS name_event_type_distinct,

                        GROUP_CONCAT(DISTINCT name_events_rr ORDER BY start_date_races ASC) AS name_events_distinct,

                        -- GROUP_CONCAT(DISTINCT zip_events ORDER BY start_date_races ASC) AS zip_events_distinct,
                        -- GROUP_CONCAT(DISTINCT is_ironman ORDER BY start_date_races ASC) AS is_ironman_distinct,
                        -- GROUP_CONCAT(DISTINCT gender_code ORDER BY start_date_races ASC) AS gender_code_distinct,
                        -- GROUP_CONCAT(DISTINCT age ORDER BY start_date_races ASC) AS age_distinct,

                        -- GROUP_CONCAT(DISTINCT member_min_created_at_year ORDER BY start_date_races ASC) AS member_min_created_at_year_distinct,

                        -- GROUP_CONCAT(DISTINCT region_name_member ORDER BY start_date_races ASC) AS aggregated_region_name_member,
                        -- GROUP_CONCAT(DISTINCT member_city_addresses ORDER BY start_date_races ASC) AS aggregated_member_city_addresses,
                        -- GROUP_CONCAT(DISTINCT member_state_code_addresses ORDER BY start_date_races ASC) AS aggregated_member_state_code_addresses,
                        -- GROUP_CONCAT(DISTINCT member_postal_code_addresses ORDER BY start_date_races ASC) AS aggregated_member_postal_code_addresses,

                        -- GROUP_CONCAT(DISTINCT member_lat_addresses ORDER BY start_date_races ASC) AS aggregated_member_lat_addresses,
                        -- GROUP_CONCAT(DISTINCT member_lng_addresses ORDER BY start_date_races ASC) AS aggregated_member_lng_addresses,

                        GROUP_CONCAT(DISTINCT id_membership_periods_sa ORDER BY start_date_races ASC) AS id_membership_period_sa_distinct,

                        -- GROUP_CONCAT(DISTINCT real_membership_types_sa ORDER BY starts_mp ASC) AS memberships_type_purchased_distinct,
                        -- GROUP_CONCAT(DISTINCT new_member_category_6_sa ORDER BY starts_mp ASC) AS memberships_category_purchased_distinct,
                        -- GROUP_CONCAT(new_member_category_6_sa ORDER BY starts_mp ASC) AS memberships_category_purchased_all,
                        -- GROUP_CONCAT(member_created_at_category ORDER BY member_min_created_at_year ASC) AS member_created_at_category_distinct,

                        GROUP_CONCAT(DISTINCT starts_mp ORDER BY starts_mp ASC) AS starts_mp_distinct,
                        GROUP_CONCAT(DISTINCT ends_mp ORDER BY ends_mp ASC) AS ends_mp_distinct,

                        GROUP_CONCAT(DISTINCT is_active_membership ORDER BY start_date_races ASC) AS is_active_membership_distinct,

                        SUM(CASE WHEN is_active_membership = 1 THEN 1 ELSE 0 END) AS count_is_membership_match,
                        SUM(CASE WHEN is_active_membership = 0 THEN 1 ELSE 0 END) AS count_is_not_membership_match,
                        
                        COUNT(purchased_on_year_adjusted_mp) AS count_of_purchased_years_all,
                        SUM(sales_units) AS sales_units_total,
                        SUM(sales_revenue) AS sales_revenue_total
                    FROM tmp_raw_participation_data
                    GROUP BY profile_id
                    )
            
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

                    FROM tmp_raw_participation_data r
                    INNER JOIN (
                        SELECT profile_id, MAX(start_date_races) AS max_start_date
                        FROM tmp_raw_participation_data
                        GROUP BY profile_id
                    ) mr
                        ON r.profile_id = mr.profile_id 
                        AND r.start_date_races = mr.max_start_date
                    )
            
                    -- ======================================================
                    -- 4. Least Recent Fields
                    -- ======================================================
                    , least_recent_fields AS (
                    SELECT 
                        r.profile_id,
                        r.real_membership_types_sa AS least_recent_membership_type,
                        r.member_created_at_category AS least_recent_member_created_at_category,
                        r.member_min_created_at_year
                    FROM tmp_raw_participation_data r
                    INNER JOIN (
                        SELECT profile_id, MIN(start_date_races) AS min_start_date
                        FROM tmp_raw_participation_data
                        GROUP BY profile_id
                    ) lr
                        ON r.profile_id = lr.profile_id 
                        AND r.start_date_races = lr.min_start_date
                    )
            
                    -- ======================================================
                    -- 5. Final Aggregation: Join Aggregated, Most Recent, and Least Recent Fields
                    -- ======================================================
                    , final_profile AS (
                    SELECT
                        -- [Profile]
                        a.profile_id,
                            
                        -- [Region Metrics]
                        -- a.count_of_race_regions_distinct,
                        -- a.race_regions_distinct,
                        m.most_recent_region_name,
            
                        -- City & State events with any needed cleaning functions:
                        -- REPLACE(a.aggregated_city_events, '"', '') AS aggregated_city_events,
                        TRIM(BOTH '"' FROM m.most_recent_city_events) AS most_recent_city_events,
            
                        -- REPLACE(a.aggregated_state_code_events, '"', '') AS aggregated_state_code_events,
                        TRIM(BOTH '"' FROM m.most_recent_state_code_events) AS most_recent_state_code_events,
            
                        -- a.name_race_type_distinct,
                        m.most_recent_name_race_type,
            
                        -- a.name_distance_types_distinct,
                        m.most_recent_name_distance_types,
            
                        -- a.name_event_type_distinct,
                        m.most_recent_name_event_type,
            
                        REPLACE(a.name_events_distinct, '"', '') AS name_events_distinct,
                        TRIM(BOTH '"' FROM m.most_recent_name_events) AS most_recent_name_events,
            
                        -- a.zip_events_distinct,
                        m.most_recent_zip_events,
            
                        -- a.is_ironman_distinct,
                        m.most_recent_is_ironman,
                        CASE WHEN m.most_recent_is_ironman = 1 THEN 'yes' ELSE 'no' END AS is_ironman_flag,
            
                        -- a.gender_code_distinct,
                        m.most_recent_gender_code,
            
                        -- a.age_distinct,
                        m.most_recent_age,
            
                        l.member_min_created_at_year,

                        -- a.aggregated_region_name_member,
                        m.most_recent_region_name_member,
            
                        -- REPLACE(a.aggregated_member_city_addresses, '"', '') AS aggregated_member_city_addresses,
                        TRIM(BOTH '"' FROM m.most_recent_member_city_addresses) AS most_recent_member_city_addresses,
            
                        -- a.aggregated_member_state_code_addresses,
                        m.most_recent_member_state_code_addresses,
            
                        -- a.aggregated_member_postal_code_addresses,
                        m.most_recent_member_postal_code_addresses,
            
                        -- a.aggregated_member_lat_addresses,
                        m.most_recent_member_lat_addresses,
            
                        -- a.aggregated_member_lng_addresses,
                        m.most_recent_member_lng_addresses,
            
                        a.id_membership_period_sa_distinct,
                        m.most_recent_id_membership_period_sa,
            
                        -- a.memberships_type_purchased_distinct,
                        l.least_recent_membership_type,
                        m.most_recent_membership_type,
            
                        -- a.memberships_category_purchased_distinct,
                        -- a.memberships_category_purchased_all,
                        m.most_recent_new_member_category_6_sa,
            
                        -- a.member_created_at_category_distinct,
                        l.least_recent_member_created_at_category,
                        m.most_recent_member_created_at_category,
            
                        a.starts_mp_distinct,
                        m.most_recent_starts_mp,
            
                        a.ends_mp_distinct, -- todo:
                        m.most_recent_ends_mp, -- todo:
            
                        a.start_years_distinct,
                        a.start_year_least_recent,
                        a.start_year_most_recent,
                        CASE WHEN a.count_races_distinct > 1 THEN 1 ELSE 0 END AS is_repeat_racer,
            
                        a.count_is_membership_match,
                        a.count_is_not_membership_match,
            
                        a.count_races_distinct,
                        a.count_of_start_years_distinct,
                        CASE 
                        WHEN a.count_of_start_years_distinct > 0 
                        THEN a.count_races_distinct / a.count_of_start_years_distinct
                        ELSE 0 
                        END AS avg_races_per_year,
            
                        -- a.is_active_membership_distinct,
                        CASE WHEN FIND_IN_SET('1', a.is_active_membership_distinct) > 0 THEN 1 ELSE 0 END AS had_race_membership_match,
            
                        a.count_of_purchased_years_all,
                        a.sales_units_total,
                        a.sales_revenue_total,
            
                        DATE_FORMAT(@created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
                        DATE_FORMAT(@created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
            
                    FROM aggregated_stats a
                    LEFT JOIN most_recent_fields m ON a.profile_id = m.profile_id
                    LEFT JOIN least_recent_fields l ON a.profile_id = l.profile_id
                )
            
                SELECT * FROM final_profile;
            
        -- DROP TABLE tmp_distinct_participant_profile_ids; -- todo:
        -- DROP TABLE tmp_raw_participation_data; -- todo:

    `;
}

// STEP #1: CREATE TABLE
async function query_create_table(table_name) {
    return `
        CREATE TABLE IF NOT EXISTS ${table_name} (
            -- [Profile]
            profile_id VARCHAR(255) UNIQUE,
                
            -- [Region Metrics]
            -- count_of_race_regions_distinct INT,
            -- race_regions_distinct TEXT,
            most_recent_region_name VARCHAR(255),

            -- City & State events with any needed cleaning functions:
            -- aggregated_city_events VARCHAR(255),
            most_recent_city_events VARCHAR(255),
            
            -- aggregated_state_code_events VARCHAR(255),
            most_recent_state_code_events VARCHAR(255),

            -- name_race_type_distinct TEXT,
            most_recent_name_race_type VARCHAR(255),

            -- name_distance_types_distinct TEXT,
            most_recent_name_distance_types VARCHAR(255),

            -- name_event_type_distinct TEXT,
            most_recent_name_event_type VARCHAR(255),
            
            name_events_distinct TEXT,
            most_recent_name_events VARCHAR(255),

            -- zip_events_distinct TEXT,
            most_recent_zip_events INT,

            -- is_ironman_distinct TEXT,
            most_recent_is_ironman INT,
            is_ironman_flag VARCHAR(255),

            -- gender_code_distinct TEXT,
            most_recent_gender_code VARCHAR(255),

            -- age_distinct TEXT,
            most_recent_age INT,

            member_min_created_at_year TEXT,

            -- aggregated_region_name_member VARCHAR(255),
            most_recent_region_name_member VARCHAR(255),

            -- aggregated_member_city_addresses VARCHAR(255),
            most_recent_member_city_addresses VARCHAR(255),

            -- aggregated_member_state_code_addresses VARCHAR(255),
            most_recent_member_state_code_addresses VARCHAR(255),

            -- aggregated_member_postal_code_addresses VARCHAR(255),
            most_recent_member_postal_code_addresses VARCHAR(255),

            -- aggregated_member_lat_addresses FLOAT,
            most_recent_member_lat_addresses FLOAT,

            -- aggregated_member_lng_addresses FLOAT,
            most_recent_member_lng_addresses FLOAT,

            id_membership_period_sa_distinct TEXT,
            most_recent_id_membership_period_sa INT,

            -- memberships_type_purchased_distinct TEXT,
            least_recent_membership_type VARCHAR(255),
            most_recent_membership_type VARCHAR(255),

            -- memberships_category_purchased_distinct TEXT,
            -- memberships_category_purchased_all TEXT,
            most_recent_new_member_category_6_sa VARCHAR(255),

            -- member_created_at_category_distinct TEXT,
            least_recent_member_created_at_category VARCHAR(255),
            most_recent_member_created_at_category VARCHAR(255),

            starts_mp_distinct TEXT,
            most_recent_starts_mp DATE,

            ends_mp_distinct TEXT, -- todo:
            most_recent_ends_mp DATE, -- todo:

            start_years_distinct TEXT,
            start_year_least_recent INT,
            start_year_most_recent INT,
            is_repeat_racer INT,

            count_is_membership_match INT,
            count_is_not_membership_match INT,

            count_races_distinct TEXT,
            count_of_start_years_distinct TEXT,
            avg_races_per_year FLOAT,

            -- is_active_membership_distinct TEXT,
            had_race_membership_match BOOLEAN,

            count_of_purchased_years_all VARCHAR(255),
            sales_units_total INT,
            sales_revenue_total FLOAT,

            -- CREATED AT DATES
            created_at_mtn DATETIME,
            created_at_utc DATETIME
        );
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
    query_create_table,
    query_append_index_fields
}

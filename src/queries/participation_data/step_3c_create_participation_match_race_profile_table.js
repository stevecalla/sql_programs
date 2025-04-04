// tbd C:\Users\calla\development\usat\sql_code\5_race_participation\final_3_1_local_paticiption_races_031825.sql

// STEP #1b: CREATE PARTICIPATION RACE PROFILE TABLE
async function query_insert_participation_race_profiles(table_name, start_date_time, end_date_time) {
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
        SET @created_at_utc = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s');

        SET @year = YEAR('${start_date_time}');

        INSERT INTO ${table_name}
            WITH participation_by_year AS (
                SELECT 
                    *
                FROM all_participation_data_with_membership_match
                WHERE start_date_races BETWEEN '${start_date_time}' AND '${end_date_time}'

                -- WHERE start_date_races BETWEEN '2010-01-01 00:00:00' AND CONCAT(YEAR(CURDATE()), '-12-31 23:59:59')
                -- WHERE start_date_races BETWEEN '2010-01-01 00:00:00' AND '2020-12-31 23:59:59'
                -- WHERE start_date_races BETWEEN '2020-01-01 00:00:00' AND '2020-12-31 23:59:59'
                ),

                profile_event_counts AS (
                    SELECT 
                        id_profile_rr, 
                        start_date_year_races, 
                        COUNT(DISTINCT id_race_rr) AS event_count
                    FROM participation_by_year
                    GROUP BY id_profile_rr, start_date_year_races
                ),

                participation_fractions AS (
                    SELECT
                        pby.*,
                        pec.event_count,
                        1.0 / pec.event_count AS fraction
                    FROM participation_by_year AS pby
                    LEFT JOIN profile_event_counts AS pec 
                        ON (pby.id_profile_rr <=> pec.id_profile_rr)
                        AND pby.start_date_year_races = @year

                        -- AND pby.start_date_year_races = pec.start_date_year_races
                        -- AND pby.start_date_year_races = 2020

                ),

                race_profiles AS (
                    SELECT 
                        IFNULL(DATE_FORMAT(pby.start_date_races, '%Y'), 'TOTAL') AS year,
                        IFNULL(DATE_FORMAT(pby.start_date_races, '%Y-%m'), 'TOTAL') AS month,
                        
                        -- If you need event-level details in the rollup, include them.
                        pby.id_sanctioning_events,
                        pby.id_events_rr,
                        pby.id_race_rr,

                        -- pby.name_events_rr,
                        TRIM(BOTH '"' FROM pby.name_events_rr) AS name_events_rr,
                        pby.name_race_type,
                        pby.name_distance_types,
                        pby.name_event_type,
                        pby.category,
                        pby.is_ironman,
                        pby.gender_code,

                        pby.region_name,
                        pby.zip_events,
                        pby.city_events,
                        pby.state_code_events,

                        pby.start_date_races,
                        MONTH(pby.start_date_races) AS start_date_month_races,
                        QUARTER(pby.start_date_races) AS start_date_quarter_races,
                        pby.start_date_year_races,
                    
                        -- Fractional aggregation: each profile contributes 1/event_count to its events.
                        SUM(fraction) AS weighted_distinct_profiles,
                        COUNT(DISTINCT pby.id_profile_rr) AS distinct_profiles,  
                        
                        COUNT(pby.id_profile_rr) AS total_profiles,
                        COUNT(*) AS total_records,

                        pby.is_active_membership,
                        SUM(CASE WHEN pby.is_active_membership = 1 THEN 1 ELSE 0 END) AS count_is_membership_match,
                        SUM(CASE WHEN pby.is_active_membership = 0 THEN 1 ELSE 0 END) AS count_is_not_membership_match,

                        SUM(CASE WHEN pby.member_created_at_category IN ('after_created_year') THEN 1 ELSE 0 END) AS count_is_repeat,
                        SUM(CASE WHEN pby.member_created_at_category IN ('created_year') THEN 1 ELSE 0 END) AS count_is_new,
                        
                        SUM(CASE WHEN pby.real_membership_types_sa IN ('adult_annual') THEN 1 ELSE 0 END) AS count_is_adult_annual,
                        SUM(CASE WHEN pby.real_membership_types_sa IN ('one_day') THEN 1 ELSE 0 END) AS count_is_one_day,
                        SUM(CASE WHEN pby.real_membership_types_sa IN ('elite') THEN 1 ELSE 0 END) AS count_is_elite,
                        SUM(CASE WHEN pby.real_membership_types_sa IN ('youth_annual') THEN 1 ELSE 0 END) AS count_is_youth_annual,
                        
                        -- Created at timestamps:
                        @created_at_mtn AS created_at_mtn,
                        @created_at_utc AS created_at_utc
                
                    FROM participation_fractions pby
                    GROUP BY year, month, 
                        pby.id_sanctioning_events,
                        pby.id_events_rr,
                        pby.id_race_rr,
                        pby.name_race_type,
                        pby.name_distance_types,
                        pby.name_event_type,
                        pby.name_events_rr,
                        pby.is_ironman,
                        pby.gender_code,
                        pby.category,
                        pby.region_name,
                        pby.zip_events,
                        pby.city_events,
                        pby.state_code_events,
                        pby.start_date_races,
                        pby.start_date_year_races,
                        pby.is_active_membership
                        
                        -- WITH ROLLUP
                    ORDER BY year ASC, month ASC
                )
                SELECT * FROM race_profiles

                -- SELECT
                    -- 	year,
                    -- 	SUM(weighted_distinct_profiles),
                    --  SUM(total_profiles),
                    --  SUM(total_records)
                -- FROM race_profiles
                -- GROUP BY year 
                -- ORDER BY year ASC
        ;
    `;
}

// STEP #1: CREATE TABLE
async function query_create_table(table_name) {
    return `
        CREATE TABLE IF NOT EXISTS ${table_name} (
            year INT,
            month VARCHAR(20),

            id_sanctioning_events INT,
            id_events_rr INT,
            id_race_rr INT,

            name_events_rr VARCHAR(255),
            name_race_type VARCHAR(255),
            name_distance_types VARCHAR(255),
            name_event_type VARCHAR(255),
            category VARCHAR(255),
            is_ironman BOOLEAN,
            gender_code VARCHAR(10),

            region_name VARCHAR(255),
            zip_events VARCHAR(255),
            city_events VARCHAR(255),
            state_code_events VARCHAR(255),

            start_date_races DATE,
            start_date_month_races INT,
            start_date_quarter_races INT,
            start_date_year_races INT,
                        
            -- Fractional aggregation: each profile contributes 1/event_count to its events.
            weighted_distinct_profiles FLOAT,
            count_id_profile_distinct INT, 

            count_total_profiles INT,
            count_all_participants INT,

            -- count of active memberships / membership matches 
            is_active_membership INT,
            count_is_membership_match INT,
            count_is_not_membership_match INT,

            -- count of new / repeat
            count_is_repeat INT,
            count_is_new INT,

            -- count for membership type = adult annual, one day, elite, youth
            count_is_adult_annual INT,
            count_is_one_day INT,
            count_is_elite INT,
            count_is_youth_annual INT,

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
    query_create_table,
    query_insert_participation_race_profiles,
    query_append_index_fields
}
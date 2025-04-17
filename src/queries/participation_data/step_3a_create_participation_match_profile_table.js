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

async function step_a_create_participation_profiles_table(table_name) {
    return `
        CREATE TABLE IF NOT EXISTS ${table_name} (
            profile_id VARCHAR(255),
            
            CONSTRAINT idx_profile_id UNIQUE (profile_id),

            -- ******************
            -- LEAST RECENT MEMBERSHIP FIELDS
            -- ******************
            member_min_created_at_year INT,
            
            least_recent_membership_type VARCHAR(255),
            least_recent_member_created_at_category VARCHAR(255),

            least_recent_starts_mp DATE,
            least_recent_ends_mp DATE,

            -- ******************
            -- MOST RECENT MEMBERSHIP FIELDS
            -- ******************
            most_recent_id_membership_period_sa INT,
            
            most_recent_membership_type VARCHAR(255),
            most_recent_new_member_category_6_sa VARCHAR(255),
            most_recent_member_created_at_category VARCHAR(255),

            most_recent_starts_mp DATE,
            most_recent_ends_mp DATE,
            
            most_recent_region_name_member VARCHAR(255),
            most_recent_member_city_addresses VARCHAR(255),
            most_recent_member_state_code_addresses VARCHAR(255),
            most_recent_member_postal_code_addresses VARCHAR(255),
            
            most_recent_member_lat_addresses FLOAT,
            most_recent_member_lng_addresses FLOAT,

            -- ******************
            -- MOST RECENT RACE FIELDS
            -- ******************
            most_recent_id_rr INT,
            most_recent_id_race INT, -- total races
            most_recent_id_sanctioning_events INT,
            
            most_recent_starts_date_races DATE,
            most_recent_start_date_month_races INT,
            most_recent_start_date_year_races INT,
            
            most_recent_region_name VARCHAR(255),
            most_recent_zip_events VARCHAR(255),
            most_recent_city_events VARCHAR(255),
            most_recent_state_code_events VARCHAR(255),
            
            most_recent_name_race_type VARCHAR(255),
            most_recent_name_distance_types VARCHAR(255),
            most_recent_name_event_type VARCHAR(255),
            most_recent_name_events VARCHAR(255),
            
            most_recent_is_ironman INT,
            
            most_recent_gender_code VARCHAR(255),
            most_recent_race_age INT,

            -- ******************
            -- MOST RECENT START YEAR METRICS
            -- ******************
            most_recent_start_year_before_2020 INT,
            most_recent_start_year_before_2023 INT,
            most_recent_start_year_2023 INT,
            most_recent_start_year_2024 INT,
            most_recent_start_year_2025_plus INT,

            -- ******************
            -- NUMBER OF START YEARS
            -- ******************
            start_year_count_one INT,
            start_year_count_two INT,
            start_year_count_three INT,
            start_year_count_four INT,
            start_year_count_five INT,
            start_year_count_six_plus INT,

            -- ******************
            -- METRICS
            -- ******************
            start_years_distinct TEXT,

            name_events_distinct TEXT,
            id_sanctioning_events_distinct TEXT,

            id_membership_period_sa_distinct TEXT,
            starts_mp_distinct TEXT,
            ends_mp_distinct TEXT,
            
            is_ironman_distinct TEXT,
            is_ironman_flag INT,
            
            is_active_membership_distinct TEXT,

            count_is_membership_match INT,
            count_is_not_membership_match INT,
            count_races_distinct INT,
            
            count_current_year_races INT,
            count_prior_year_races INT,
            
            count_of_start_years_distinct INT,

            count_of_race_regions_distinct INT,
            count_of_purchased_years_all INT,

            avg_races_per_year FLOAT,
            is_repeat_racer INT,
            had_race_membership_match INT,
            
            sales_units_total INT,
            sales_revenue_total INT,

            -- CREATED AT DATES
            created_at_mtn DATETIME,
            created_at_utc DATETIME
        );
    `;
}

async function step_b_create_distinct_profile_id_table(table_name) {
    return `
        CREATE TABLE ${table_name} AS
            SELECT 
                DISTINCT id_profile_rr AS profile_id
            FROM all_participation_data_with_membership_match
            WHERE 1 = 1
                AND id_profile_rr IS NOT NULL
                AND id_profile_rr <> ''
            ORDER BY id_profile_rr
        ;

        ALTER TABLE ${table_name}
            ADD INDEX idx_profile_id (profile_id)
        ;
    `;
}

// CTE = raw_participation_data
async function step_d_participation_base_data(table_name, where, limit) {
    return `
        CREATE TABLE ${table_name} AS
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
                -- AND id_profile_rr IS NOT NULL
                -- AND id_profile_rr <> ''
                ${where}
            ORDER BY id_profile_rr, start_date_races
            ${limit}
        ;
    `
}

async function step_e_participation_least_recent_member_data(table_name, where, limit, base_table) {
    console.log('query: ' + base_table)

    // LEAST RECENT MEMBERSHIP THAT MATCHES A RACE RECORD
    // EXCLUDES RECORDS WITHOUT A MATCH WHICH IS FINE AS THE LAST QUERY IN THE SEQUENCE WILL GET ALL PROFILE RECORDS
    // A PROFILE CAN HAVE AN EARLIER RACE THAT DOESN'T MATCH A RECORD
    return `
        CREATE TABLE ${table_name} AS
            WITH least_recent_membership_data AS (
                SELECT 
                    profile_id,

                    member_min_created_at_year,

                    real_membership_types_sa AS least_recent_membership_type,
                    member_created_at_category AS least_recent_member_created_at_category,

                    starts_mp AS least_recent_starts_mp,
                    ends_mp AS least_recent_ends_mp,

                    ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY starts_mp ASC) AS rn

                FROM ${base_table}
                WHERE starts_mp IS NOT NULL
            )
                SELECT 
                    profile_id,

                    member_min_created_at_year,
                    
                    least_recent_membership_type,
                    least_recent_member_created_at_category,

                    least_recent_starts_mp,
                    least_recent_ends_mp

                FROM least_recent_membership_data
                WHERE rn = 1;  
    `;
}

async function step_f_participation_most_recent_member_data(table_name, where, limit, base_table) {
    return `
        CREATE TABLE ${table_name} AS
            WITH least_recent_membership_data AS (
                SELECT 
                    profile_id,

                    id_membership_periods_sa AS most_recent_id_membership_period_sa,

                    real_membership_types_sa AS most_recent_membership_type,
                    new_member_category_6_sa AS most_recent_new_member_category_6_sa,
                    member_created_at_category AS most_recent_member_created_at_category,

                    starts_mp AS most_recent_starts_mp,
                    ends_mp AS most_recent_ends_mp,

                    region_name_member AS most_recent_region_name_member,
                    member_city_addresses AS most_recent_member_city_addresses,
                    member_state_code_addresses AS most_recent_member_state_code_addresses,
                    member_postal_code_addresses AS most_recent_member_postal_code_addresses,

                    member_lat_addresses AS most_recent_member_lat_addresses,
                    member_lng_addresses AS most_recent_member_lng_addresses,

                    ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY starts_mp DESC) AS rn

                FROM ${base_table}
                WHERE starts_mp IS NOT NULL
            )
            SELECT 
                profile_id,
                
                most_recent_id_membership_period_sa,
                
                most_recent_membership_type,
                most_recent_new_member_category_6_sa,
                most_recent_member_created_at_category,

                most_recent_starts_mp,
                most_recent_ends_mp,
                
                most_recent_region_name_member,
                most_recent_member_city_addresses,
                most_recent_member_state_code_addresses,
                most_recent_member_postal_code_addresses,

                most_recent_member_lat_addresses,
                most_recent_member_lng_addresses

            FROM least_recent_membership_data
            WHERE rn = 1;  
    `;
}

async function step_g_participation_most_recent_race_data(table_name, where, limit, base_table) {
    return `
        CREATE TABLE ${table_name} AS
            WITH most_recent_race_data AS (
                SELECT 
                    profile_id,

                    id_rr AS most_recent_id_rr,
                    id_race_rr AS most_recent_id_race,
                    id_sanctioning_events AS most_recent_id_sanctioning_events,

                    start_date_races AS most_recent_starts_date_races,
                    MONTH(start_date_races) AS most_recent_start_date_month_races,
                    start_date_year_races AS most_recent_start_date_year_races,

                    region_name AS most_recent_region_name,
                    zip_events AS most_recent_zip_events,
                    city_events AS most_recent_city_events,
                    state_code_events AS most_recent_state_code_events,

                    name_race_type AS most_recent_name_race_type,
                    name_distance_types AS most_recent_name_distance_types,
                    name_event_type AS most_recent_name_event_type,
                    name_events_rr AS most_recent_name_events,
 
                    is_ironman AS most_recent_is_ironman,

                    gender_code AS most_recent_gender_code,
                    age AS most_recent_race_age,

                    ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY start_date_races DESC) AS rn

                FROM ${base_table}
                WHERE start_date_races IS NOT NULL
            )
            SELECT 
                *
            FROM most_recent_race_data
            WHERE rn = 1;  
    `;
}

async function step_g_1_participation_most_recent_start_year_data(table_name, where, limit, base_table) {
    // step_g_1_participation_most_recent_start_year_data
    return `
    CREATE TABLE ${table_name} AS
        WITH most_recent_start_year_data AS (
            SELECT 
                profile_id,
                
                -- MOST RECENT START YEAR       
                CASE WHEN most_recent_start_date_year_races < 2020 THEN 1 ELSE 0 END AS most_recent_start_year_before_2020,
                CASE WHEN most_recent_start_date_year_races < 2023 THEN 1 ELSE 0 END AS most_recent_start_year_before_2023,
                CASE WHEN most_recent_start_date_year_races IN (2023) THEN 1 ELSE 0 END AS most_recent_start_year_2023,
                CASE WHEN most_recent_start_date_year_races IN (2024) THEN 1 ELSE 0 END AS most_recent_start_year_2024,
                CASE WHEN most_recent_start_date_year_races >= 2025 THEN 1 ELSE 0 END AS most_recent_start_year_2025_plus

            FROM ${base_table}
            WHERE most_recent_starts_date_races IS NOT NULL
        )
        SELECT 
            *
        FROM most_recent_start_year_data
    ;  
`;
}

async function step_h_participation_aggregated_metrics(table_name, where, limit, base_table) {
    return `
        SET SESSION group_concat_max_len = 1000000;

        CREATE TABLE ${table_name} AS
            SELECT
                profile_id,
                
                GROUP_CONCAT(DISTINCT start_date_year_races ORDER BY start_date_races ASC) AS start_years_distinct,

                GROUP_CONCAT(DISTINCT name_events_rr ORDER BY start_date_races ASC) AS name_events_distinct,
                GROUP_CONCAT(DISTINCT id_sanctioning_events ORDER BY start_date_races ASC) AS id_sanctioning_events_distinct,
                
                GROUP_CONCAT(DISTINCT id_membership_periods_sa ORDER BY start_date_races ASC) AS id_membership_period_sa_distinct,
                GROUP_CONCAT(DISTINCT starts_mp ORDER BY starts_mp ASC) AS starts_mp_distinct,
                GROUP_CONCAT(DISTINCT ends_mp ORDER BY ends_mp ASC) AS ends_mp_distinct,
                
                GROUP_CONCAT(DISTINCT is_ironman ORDER BY start_date_races ASC) AS is_ironman_distinct,
                CASE WHEN MAX(is_ironman) = 1 THEN 1 ELSE 0 END AS is_ironman_flag,

                GROUP_CONCAT(DISTINCT is_active_membership ORDER BY start_date_races ASC) AS is_active_membership_distinct,
                SUM(CASE WHEN is_active_membership = 1 THEN 1 ELSE 0 END) AS count_is_membership_match,
                SUM(CASE WHEN is_active_membership = 0 THEN 1 ELSE 0 END) AS count_is_not_membership_match,

                -- [Sales and Purchase Metrics]
                COUNT(DISTINCT id_race_rr) AS count_races_distinct,

                SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) THEN 1 ELSE 0 END) AS count_current_year_races,
                SUM(CASE WHEN start_date_year_races = YEAR(CURDATE()) - 1 THEN 1 ELSE 0 END) AS count_prior_year_races,

                -- NUMBER OF START YEARS
                COUNT(DISTINCT start_date_year_races) AS count_of_start_years_distinct,
                COUNT(DISTINCT region_name) AS count_of_race_regions_distinct,
                COUNT(purchased_on_year_adjusted_mp) AS count_of_purchased_years_all,
                SUM(sales_units) AS sales_units_total,
                SUM(sales_revenue) AS sales_revenue_total

            FROM ${base_table}
            GROUP BY profile_id
        ;
    `;
}

async function step_h_1_participation_number_of_start_years_data(table_name, where, limit, base_table) {
    // step_h_1_participation_number_of_start_years_data
    return `
    CREATE TABLE ${table_name} AS
        WITH number_of_start_years AS (
            SELECT 
                profile_id,
        
                -- NUMBER OF START YEARS
                CASE WHEN count_of_start_years_distinct IN (1) THEN 1 ELSE 0 END AS start_year_count_one,
                CASE WHEN count_of_start_years_distinct IN (2) THEN 1 ELSE 0 END AS start_year_count_two,
                CASE WHEN count_of_start_years_distinct IN (3) THEN 1 ELSE 0 END AS start_year_count_three,
                CASE WHEN count_of_start_years_distinct IN (4) THEN 1 ELSE 0 END AS start_year_count_four,
                CASE WHEN count_of_start_years_distinct IN (5) THEN 1 ELSE 0 END AS start_year_count_five,
                CASE WHEN count_of_start_years_distinct >= (6) THEN 1 ELSE 0 END AS start_year_count_six_plus

            FROM ${base_table}
        )
        SELECT 
            *
        FROM number_of_start_years
    ;  
`;
}

// STEP #1b: CREATE PARTICIPATION PROFILE TABLE
async function step_i_insert_participation_profiles(table_name) {
    return `
        -- SET sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''));
        SET SESSION group_concat_max_len = 1000000;

        ${await created_at_mtn()}
        ${await created_at_utc()}

        INSERT IGNORE INTO ${table_name}
            SELECT
                p.profile_id,

                -- ******************
                -- LEAST RECENT MEMBERSHIP FIELDS
                -- ******************
                lr.member_min_created_at_year,
                
                lr.least_recent_membership_type,
                lr.least_recent_member_created_at_category,

                lr.least_recent_starts_mp,
                lr.least_recent_ends_mp,

                -- ******************
                -- MOST RECENT MEMBERSHIP FIELDS
                -- ******************
                mr.most_recent_id_membership_period_sa,
                
                mr.most_recent_membership_type,
                mr.most_recent_new_member_category_6_sa,
                mr.most_recent_member_created_at_category,

                mr.most_recent_starts_mp,
                mr.most_recent_ends_mp,
                
                mr.most_recent_region_name_member,
                TRIM(BOTH '"' FROM mr.most_recent_member_city_addresses) AS most_recent_member_city_addresses,
                mr.most_recent_member_state_code_addresses,
                mr.most_recent_member_postal_code_addresses,
                
                mr.most_recent_member_lat_addresses,
                mr.most_recent_member_lng_addresses,

                -- ******************
                -- MOST RECENT RACE FIELDS
                -- ******************
                rr.most_recent_id_rr,
                rr.most_recent_id_race,
                rr.most_recent_id_sanctioning_events,
                
                rr.most_recent_starts_date_races,
                rr.most_recent_start_date_month_races,
                rr.most_recent_start_date_year_races,
                
                rr.most_recent_region_name,
                rr.most_recent_zip_events,
                TRIM(BOTH '"' FROM rr.most_recent_city_events) AS most_recent_city_events,
                rr.most_recent_state_code_events,
                
                rr.most_recent_name_race_type,
                rr.most_recent_name_distance_types,
                rr.most_recent_name_event_type,
                TRIM(BOTH '"' FROM rr.most_recent_name_events) AS most_recent_name_events,
                
                rr.most_recent_is_ironman,
                
                rr.most_recent_gender_code,
                rr.most_recent_race_age,

                -- ******************
                -- MOST RECENT START YEAR METRICS
                -- ******************
                ys.most_recent_start_year_before_2020,
                ys.most_recent_start_year_before_2023,
                ys.most_recent_start_year_2023,
                ys.most_recent_start_year_2024,
                ys.most_recent_start_year_2025_plus,

                -- ******************
                -- NUMBER OF START YEARS
                -- ******************
                yc.start_year_count_one,
                yc.start_year_count_two,
                yc.start_year_count_three,
                yc.start_year_count_four,
                yc.start_year_count_five,
                yc.start_year_count_six_plus,

                -- ******************
                -- METRICS
                -- ******************
                m.start_years_distinct,

                REPLACE(m.name_events_distinct, '"', '') AS name_events_distinct,
                m.id_sanctioning_events_distinct,

                m.id_membership_period_sa_distinct,
                m.starts_mp_distinct,
                m.ends_mp_distinct,
                
                is_ironman_distinct,
                is_ironman_flag,
                
                m.is_active_membership_distinct,

                m.count_is_membership_match,
                m.count_is_not_membership_match,
                m.count_races_distinct,
                
                m.count_current_year_races,
                m.count_prior_year_races,
                
                m.count_of_start_years_distinct,

                m.count_of_race_regions_distinct,
                m.count_of_purchased_years_all,

                CASE 
                    WHEN m.count_of_start_years_distinct > 0 THEN m.count_races_distinct / m.count_of_start_years_distinct
                    ELSE 0 
                END AS avg_races_per_year,
                CASE WHEN m.count_races_distinct > 1 THEN 1 ELSE 0 END AS is_repeat_racer,
                CASE WHEN FIND_IN_SET('1', m.is_active_membership_distinct) > 0 THEN 1 ELSE 0 END AS had_race_membership_match,
                
                m.sales_units_total,
                m.sales_revenue_total,

                @created_at_mtn AS created_at_mtn,
                @created_at_utc AS created_at_utc
    
            FROM step_d_participation_base_data AS p
                LEFT JOIN step_e_participation_least_recent_member_data AS lr ON p.profile_id = lr.profile_id
                LEFT JOIN step_f_participation_most_recent_member_data AS mr ON p.profile_id = mr.profile_id
                LEFT JOIN step_g_participation_most_recent_race_data AS rr ON p.profile_id = rr.profile_id
                LEFT JOIN step_g_1_participation_most_recent_start_year_data AS ys ON p.profile_id = ys.profile_id
                LEFT JOIN step_h_participation_aggregated_metrics AS m ON p.profile_id = m.profile_id
                LEFT JOIN step_h_1_participation_number_of_start_years_data AS yc ON p.profile_id = yc.profile_id
        ;
    `;
}

// STEP #1C: APPEND INDEXES
async function query_append_index_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            -- ADD INDEX idx_profile_id (profile_id), -- created via UNIQUE when table created

            -- Race-related indexes
            ADD INDEX idx_most_recent_id_rr (most_recent_id_rr),
            ADD INDEX idx_most_recent_id_race (most_recent_id_race),
            ADD INDEX idx_most_recent_id_sanctioning_events (most_recent_id_sanctioning_events),
            
            ADD INDEX idx_most_recent_name_race_type (most_recent_name_race_type),
            ADD INDEX idx_most_recent_name_distance_types (most_recent_name_distance_types),
            ADD INDEX idx_most_recent_name_event_type (most_recent_name_event_type),
            ADD INDEX idx_most_recent_name_events (most_recent_name_events),
            
            ADD INDEX idx_most_recent_gender_code (most_recent_gender_code),
            
            ADD INDEX idx_most_recent_region_name (most_recent_region_name),
            ADD INDEX idx_most_recent_city_events (most_recent_city_events),
            ADD INDEX idx_most_recent_state_code_events (most_recent_state_code_events),
            ADD INDEX idx_most_recent_zip_events (most_recent_zip_events),
            
            ADD INDEX idx_most_recent_starts_date_races (most_recent_starts_date_races),
            ADD INDEX idx_most_recent_start_date_year_races (most_recent_start_date_year_races),
            
            -- Membership-related index (if filtering by membership category is common)
            ADD INDEX idx_most_recent_member_created_at_category (most_recent_member_created_at_category)
        ;
    `;
}

module.exports = {
    step_a_create_participation_profiles_table,
    step_b_create_distinct_profile_id_table,
    step_d_participation_base_data,
    step_e_participation_least_recent_member_data,
    step_f_participation_most_recent_member_data,
    step_g_participation_most_recent_race_data,
    step_g_1_participation_most_recent_start_year_data,
    step_h_participation_aggregated_metrics,
    step_h_1_participation_number_of_start_years_data,
    step_i_insert_participation_profiles,
    query_append_index_fields
}

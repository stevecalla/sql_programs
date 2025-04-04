// SOURCE 
// working query: C:\Users\calla\development\usat\sql_code\5_race_participation\final_0_local_paticiption_working_query_031825.sql
// discovery: C:\Users\calla\development\usat\sql_code\5_race_participation\local_participation_raw_merge_region_and_sales.sql

// STEP #2: GET MIN & MAX MEMBERSHIP PERIOD END DATES; USED TO LIMIT THE QUERY OF PARTICIPANT RAW DATA
async function query_get_min_and_max_races_dates(start_date_time, end_date_time) {
    return `
        SELECT 
            CONCAT(DATE(MIN(start_date_races)), ' 00:00:00') AS min_date,
            CONCAT(DATE(MAX(start_date_races)), ' 23:59:59') AS max_date
        FROM all_participation_data_raw
        WHERE start_date_races BETWEEN '${start_date_time}' AND '${end_date_time}';
    `;
}

// STEP #2a: INSERT DATA INTO TABLE
async function step_4_create_participation_with_membership_match(table_name, start_date_time, end_date_time, min_start_date, max_end_date) {
    return `
        SET @start_date = '2025-01-01';
        SET @end_date = '2025-03-16';

        INSERT INTO ${table_name}
            WITH participation AS (
                SELECT 
                    *
                FROM all_participation_data_raw

                WHERE 1 = 1 
                    -- AND start_date_year_races = 2025
                    -- AND start_date_races >= @start_date
                    -- AND start_date_races <= @end_date

                    AND start_date_races >= '${start_date_time}'
                    AND start_date_races <= '${end_date_time}'

                -- Uncomment and modify the following lines if you need additional filters:
                -- AND id_profile_rr = 42 
                -- AND id_rr = 4527556 -- this member is missing memberships to match race history; total number of races = 6; total memberships = 4 with missing for 2014, 2017, 2021 races; id_profile_rr = 42
                -- AND id_profile_rr = 999977 
                -- AND id_rr = 1197359 -- this member has multiple memberships for the same race (a one day & an annual)
            )

            , filtered_sales_key_stats_2015 AS (
                SELECT
                    *
                FROM sales_key_stats_2015 AS s
                WHERE 1 = 1
                    AND s.starts_mp <= '${max_end_date}'
                    AND s.ends_mp >= '${min_start_date}'
            )

            , merge_participation_with_active_membership AS (
                SELECT 
                    -- PARTICIPATION DATA
                    p.id_rr,
                    p.id_race_rr,
                    p.id_events AS id_events_rr,
                    p.id_sanctioning_events,

                    p.name_event_type,
                    p.name_events AS name_events_rr,
            
                    p.city_events,
                    p.state_code_events,
                    p.zip_events,

                    p.start_date_races,
                    p.start_date_year_races,
                    
                    is_ironman,
            
                    p.id_profile_rr,
                    p.gender_code,

                    p.age,
                    CASE 
                        WHEN p.age < 4 THEN 'bad_age'
                        WHEN p.age >= 4 AND p.age < 10 THEN '4-9'
                        WHEN p.age < 20 THEN '10-19'
                        WHEN p.age < 30 THEN '20-29'
                        WHEN p.age < 40 THEN '30-39'
                        WHEN p.age < 50 THEN '40-49'
                        WHEN p.age < 60 THEN '50-59'
                        WHEN p.age < 70 THEN '60-69'
                        WHEN p.age < 80 THEN '70-79'
                        WHEN p.age < 90 THEN '80-89'
                        WHEN p.age < 100 THEN '90-99'
                        WHEN p.age >= 100 THEN 'bad_age'
                        ELSE 'bad_age'
                    END AS age_as_race_results_bin, -- create bin for age based on race results record

                    p.name_distance_types,
                    p.name_race_type,
                    p.category,

                    -- REGION DATA
                    r.state_id,
                    r.region_code,
                    r.state_name,
                    r.state_code,
                    r.region_name,
                    r.region_abbr,

                    -- MEMBERSHIP DATA
                    s.id_profiles,
                    s.member_min_created_at_year,

                    s.region_name_member,
                    s.region_abbr_member,

                    s.member_city_addresses,
                    s.member_postal_code_addresses,
                    s.member_lng_addresses,
                    s.member_lat_addresses,
                    s.member_state_code_addresses,
                    s.member_country_code_addresses,

                    s.purchased_on_date_adjusted_mp,
                    s.purchased_on_month_adjusted_mp,
                    s.purchased_on_year_adjusted_mp,
                    
                    s.name_events,
                    s.id_events,
                    s.region_name_events,
                    s.region_abbr_events,

                    s.id_membership_periods_sa,
                    s.starts_mp,
                    s.ends_mp,

                    s.real_membership_types_sa,
                    s.new_member_category_6_sa,

                    s.member_created_at_category,

                    s.member_lapsed_renew_category,
                    s.member_lifetime_purchases,
                    s.member_lifetime_frequency,
                    s.member_upgrade_downgrade_category,
                    s.most_recent_prior_purchase_membership_type,

                    s.origin_flag_category,
                    s.origin_flag_ma,
                    
                    s.sales_revenue,
                    s.sales_units,

                    -- IDENTIFY DUPLICATES = when race result id is applied to more than 1 membership
                    ROW_NUMBER() OVER (
                        PARTITION BY p.id_rr -- p.id_rr should never be null in the race results / participation table
                        ORDER BY ABS(TIMESTAMPDIFF(SECOND, p.start_date_races, s.purchased_on_date_adjusted_mp)) ASC
                    ) AS rn, -- Ranks duplicates based on the nearest MP purchase date to the race start date,

                    -- IDENTIFY ACTIVE MEMBERSHIP DATES OVERLAP WITH RACE DATES
                    CASE WHEN s.starts_mp IS NOT NULL THEN 1 ELSE 0 END AS is_active_membership

                FROM participation p
                    LEFT JOIN filtered_sales_key_stats_2015 s ON s.id_profiles = p.id_profile_rr
                        AND s.starts_mp <= p.start_date_races
                        AND s.ends_mp >= p.start_date_races
                    LEFT JOIN region_data AS r ON p.state_code_events = r.state_code
            )
            SELECT 
                *
            FROM merge_participation_with_active_membership
            WHERE 1 = 1
                AND rn = 1;

    `;
}

// STEP #1: CREATE TABLE
async function query_create_table(table_name) {
    return `
        CREATE TABLE IF NOT EXISTS ${table_name} (
            id_rr INT,
            id_race_rr INT,
            id_events_rr INT,
            id_sanctioning_events INT,

            name_event_type VARCHAR(255),
            name_events_rr VARCHAR(255),

            city_events VARCHAR(191),
            state_code_events VARCHAR(10),
            zip_events VARCHAR(50),

            start_date_races DATE,
            start_date_year_races INT,

            is_ironman BOOLEAN,

            id_profile_rr VARCHAR(255),
            gender_code VARCHAR(50),

            age INT,
            age_as_race_results_bin VARCHAR(15),

            name_distance_types VARCHAR(255),
            name_race_type VARCHAR(255),
            category VARCHAR(50)
        );
    `;
}

// STEP #1A: APPEND REGION FIELDS AFTER TABLE IS CREATED
async function query_append_region_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD COLUMN state_id INT,
            ADD COLUMN region_code INT,
            ADD COLUMN state_name VARCHAR(100),
            ADD COLUMN state_code VARCHAR(10),
            ADD COLUMN region_name VARCHAR(100),
            ADD COLUMN region_abbr VARCHAR(10);
    `;
}

// STEP #1B: APPEND MEMBERSHIP PERIOD FIELDS AFTER TABLE IS CREATED
async function query_append_membership_period_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD COLUMN id_profiles VARCHAR(255),
            ADD COLUMN member_min_created_at_year INT,

            ADD COLUMN region_name_member VARCHAR(100),
            ADD COLUMN region_abbr_member VARCHAR(10),

            ADD COLUMN member_city_addresses VARCHAR(255),
            ADD COLUMN member_postal_code_addresses VARCHAR(255),
            ADD COLUMN member_lng_addresses FLOAT,
            ADD COLUMN member_lat_addresses FLOAT,
            ADD COLUMN member_state_code_addresses VARCHAR(255),
            ADD COLUMN member_country_code_addresses VARCHAR(255),

            ADD COLUMN purchased_on_date_adjusted_mp DATE,
            ADD COLUMN purchased_on_month_adjusted_mp INT,
            ADD COLUMN purchased_on_year_adjusted_mp INT,
                    
            ADD COLUMN name_events VARCHAR(255),
            ADD COLUMN id_events INT,
            ADD COLUMN region_name_events VARCHAR(100),
            ADD COLUMN region_abbr_events VARCHAR(10),

            ADD COLUMN id_membership_periods_sa INT,
            ADD COLUMN starts_mp DATE,
            ADD COLUMN ends_mp DATE,

            ADD COLUMN real_membership_types_sa VARCHAR(255),
            ADD COLUMN new_member_category_6_sa VARCHAR(255),

            ADD COLUMN member_created_at_category VARCHAR(255),

            ADD COLUMN member_lapsed_renew_category VARCHAR(255),
            ADD COLUMN member_lifetime_purchases INT,
            ADD COLUMN member_lifetime_frequency VARCHAR(100),
            ADD COLUMN member_upgrade_downgrade_category VARCHAR(255),
            ADD COLUMN most_recent_prior_purchase_membership_type VARCHAR(255),

            ADD COLUMN origin_flag_category VARCHAR(100),
            ADD COLUMN origin_flag_ma TEXT,

            ADD COLUMN sales_revenue BIGINT,
            ADD COLUMN sales_units DECIMAL,

            ADD COLUMN rn INT,

            ADD COLUMN is_active_membership INT;
    `;
}

// STEP #1C: APPEND INDEXES
async function query_append_index_fields(table_name) {
    return `
        ALTER TABLE ${table_name}
            ADD INDEX idx_id_race_rr (id_race_rr),
            ADD INDEX idx_id_sanctioning_events (id_sanctioning_events),
            
            ADD INDEX idx_name_event_type (name_event_type),
            ADD INDEX idx_name_events (name_events),

            ADD INDEX idx_city_events (city_events),
            ADD INDEX idx_state_code_events (state_code_events),
            ADD INDEX idx_zip_events (zip_events),
            
            ADD INDEX idx_start_date_races (start_date_races),
            ADD INDEX idx_start_date_year_races (start_date_year_races),
            
            ADD INDEX idx_gender_code_rr (gender_code),
            -- ADD INDEX idx_id_profile_rr (id_profile_rr),

            ADD INDEX idx_name_distance_types (name_distance_types),
            ADD INDEX idx_name_race_type (name_race_type),

            ADD INDEX idx_region_code (region_code),
            ADD INDEX idx_state_name (state_name),
            ADD INDEX idx_state_code (state_code),
            ADD INDEX idx_region_name (region_name),
            ADD INDEX idx_region_abbr (region_abbr),

            ADD INDEX idx_purchased_on_date_adjusted_mp (purchased_on_date_adjusted_mp),
            ADD INDEX idx_purchased_on_month_adjusted_mp (purchased_on_month_adjusted_mp),
            ADD INDEX idx_purchased_on_year_adjusted_mp (purchased_on_year_adjusted_mp),

            ADD INDEX idx_id_membership_periods_sa (id_membership_periods_sa),

            ADD INDEX idx_starts_mp (starts_mp),
            ADD INDEX idx_ends_mp (ends_mp),

            ADD INDEX idx_real_membership_types_sa (real_membership_types_sa),
            ADD INDEX idx_new_member_category_6_sa (new_member_category_6_sa);
    `;
}

module.exports = {
    query_create_table,
    query_append_region_fields,
    query_append_membership_period_fields,
    query_append_index_fields,
    query_get_min_and_max_races_dates,
    step_4_create_participation_with_membership_match,
}

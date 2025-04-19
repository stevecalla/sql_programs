async function query_participation_profile(batch_size = 10, offset = 0) {
    return `
        SELECT
            profile_id,        
            
            -- ******************
            -- LEAST RECENT MEMBERSHIP FIELDS
            -- ******************
            IFNULL(member_min_created_at_year, '') AS member_min_created_at_year,
            
            least_recent_membership_type,
            least_recent_member_created_at_category,

            DATE_FORMAT(least_recent_starts_mp, '%Y-%m-%d') AS least_recent_starts_mp,
            DATE_FORMAT(least_recent_ends_mp, '%Y-%m-%d') AS least_recent_ends_mp,
            
            -- ******************
            -- MOST RECENT MEMBERSHIP FIELDS
            -- ******************
            IFNULL(most_recent_id_membership_period_sa, '') AS most_recent_id_membership_period_sa,
            
            most_recent_membership_type,
            most_recent_new_member_category_6_sa,
            most_recent_member_created_at_category,

            DATE_FORMAT(most_recent_starts_mp, '%Y-%m-%d') AS most_recent_starts_mp,
            DATE_FORMAT(most_recent_ends_mp, '%Y-%m-%d') AS most_recent_ends_mp,
            
            most_recent_region_name_member,
            REPLACE(REPLACE(REPLACE(most_recent_member_city_addresses, '\r', ''), '\n', ''), '"', '') AS most_recent_member_city_addresses,
            most_recent_member_state_code_addresses,
            most_recent_member_postal_code_addresses,
            
            IFNULL(most_recent_member_lat_addresses, '') AS most_recent_member_lat_addresses,
            IFNULL(most_recent_member_lng_addresses, '') AS most_recent_member_lng_addresses,

            -- ******************
            -- MOST RECENT RACE FIELDS
            -- ******************
            IFNULL(most_recent_id_rr, '') AS most_recent_id_rr,
            IFNULL(most_recent_id_race, '') AS most_recent_id_race,
            IFNULL(most_recent_id_sanctioning_events, '') AS most_recent_id_sanctioning_events,
            
            DATE_FORMAT(most_recent_starts_date_races, '%Y-%m-%d') AS most_recent_starts_date_races,
            most_recent_start_date_month_races,
            most_recent_start_date_year_races,
            
            most_recent_region_name,
            most_recent_zip_events,
            TRIM(BOTH '"' FROM most_recent_city_events) AS most_recent_city_events,
            most_recent_state_code_events,
            
            most_recent_name_race_type,
            most_recent_name_distance_types,
            most_recent_name_event_type,
            TRIM(BOTH '"' FROM most_recent_name_events) AS most_recent_name_events,
            
            most_recent_is_ironman,
            
            most_recent_gender_code,
            IFNULL(most_recent_race_age, '') AS most_recent_race_age,

            -- ******************
            -- MOST RECENT START YEAR METRICS
            -- ******************
            most_recent_start_year_before_2020,
            most_recent_start_year_before_2023,
            most_recent_start_year_2023,
            most_recent_start_year_2024,
            most_recent_start_year_2025_plus,

            -- ******************
            -- NUMBER OF START YEARS
            -- ******************
            start_year_count_one,
            start_year_count_two,
            start_year_count_three,
            start_year_count_four,
            start_year_count_five,
            start_year_count_six_plus,

            -- ******************
            -- METRICS
            -- ******************
            start_years_distinct,

            REPLACE(name_events_distinct, '"', '') AS name_events_distinct,
            id_sanctioning_events_distinct,

            id_membership_period_sa_distinct,
            starts_mp_distinct,
            ends_mp_distinct,
            
            is_ironman_distinct,
            is_ironman_flag,
            
            is_active_membership_distinct,

            count_is_membership_match,
            count_is_not_membership_match,
            count_races_distinct,
            
            count_current_year_races,
            count_prior_year_races,
            
            count_of_start_years_distinct,
            count_of_race_regions_distinct,
            count_of_purchased_years_all,

            CASE 
                WHEN count_of_start_years_distinct > 0 THEN count_races_distinct / count_of_start_years_distinct
                ELSE 0 
            END AS avg_races_per_year,
            CASE WHEN count_races_distinct > 1 THEN 1 ELSE 0 END AS is_repeat_racer,
            CASE WHEN FIND_IN_SET('1', is_active_membership_distinct) > 0 THEN 1 ELSE 0 END AS had_race_membership_match,
            
            IFNULL(sales_units_total, '') AS sales_units_total,
            IFNULL(sales_revenue_total, '') AS sales_revenue_total,

            -- ******************
            -- CREATED AT DATES
            -- ******************
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
            
        FROM step_a_participation_profiles
        WHERE profile_id IS NOT NULL
        ORDER BY profile_id
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 500000
        ;
    `;
};

module.exports = {
    query_participation_profile
}
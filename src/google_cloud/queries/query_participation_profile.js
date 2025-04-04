const query_participation_profile = `
    SELECT
        -- [Profile & Race Metrics]
        profile_id,
              
        -- [Region Metrics]
        count_of_race_regions_distinct,
        race_regions_distinct,
        most_recent_region_name,

        -- city_events
        REPLACE(aggregated_city_events, '"', '') AS aggregated_city_events,
        TRIM(BOTH '"' FROM most_recent_city_events) AS most_recent_city_events,
        
        -- state_code_events
        REPLACE(aggregated_state_code_events, '"', '') AS aggregated_state_code_events,
        TRIM(BOTH '"' FROM most_recent_state_code_events) AS most_recent_state_code_events,

        -- [Race Types, Distances, and Event Metrics]
        name_race_type_distinct,
        most_recent_name_race_type,
        
        name_distance_types_distinct,
        most_recent_name_distance_types,
        
        name_event_type_distinct,
        most_recent_name_event_type,
        
        REPLACE(name_events_distinct, '"', '') AS name_events_distinct,
        TRIM(BOTH '"' FROM most_recent_name_events) AS most_recent_name_events,
        
        zip_events_distinct,
        most_recent_zip_events,
        
        -- [Ironman, Gender, and Age Metrics]
        is_ironman_distinct,
        most_recent_is_ironman,
        is_ironman_flag,
        
        gender_code_distinct,
        most_recent_gender_code,
        
        age_distinct,
        IFNULL(most_recent_age, '') AS most_recent_age,

        -- [MEMBER CREATED AT]
        member_min_created_at_year_distinct,

        -- region_name_member
        aggregated_region_name_member,
        most_recent_region_name_member,
        
        -- member_city_addresses
        REPLACE(REPLACE(REPLACE(aggregated_member_city_addresses, '\r', ''), '\n', ''), '"', '') AS aggregated_member_city_addresses,
        REPLACE(REPLACE(REPLACE(most_recent_member_city_addresses, '\r', ''), '\n', ''), '"', '') AS most_recent_member_city_addresses,
        
        -- member_state_code_addresses
        aggregated_member_state_code_addresses,
        most_recent_member_state_code_addresses,
        
        -- member_postal_code_addresses
        aggregated_member_postal_code_addresses,
        most_recent_member_postal_code_addresses,
        
        -- member_lat_addresses
        IFNULL(aggregated_member_lat_addresses, '') AS aggregated_member_lat_addresses,
        IFNULL(most_recent_member_lat_addresses, '') AS most_recent_member_lat_addresses,
        
        -- member_lng_addresses
        IFNULL(aggregated_member_lng_addresses, '') AS aggregated_member_lng_addresses,
        IFNULL(most_recent_member_lng_addresses, '') AS most_recent_member_lng_addresses,
        
        -- [Membership Period and Type Metrics]
        id_membership_period_sa_distinct,
        most_recent_id_membership_period_sa,
        
        memberships_type_purchased_distinct,
        least_recent_membership_type,
        most_recent_membership_type,
        
        -- [Membership Category and Creation Metrics]
        memberships_category_purchased_distinct,
        memberships_category_purchased_all,
        most_recent_new_member_category_6_sa,
        
        member_created_at_category_distinct,
        least_recent_member_created_at_category,
        most_recent_member_created_at_category,
        
        -- [Starts/Ends Metrics]
        starts_mp_distinct,
        most_recent_starts_mp,

        -- RACE METRICS
        start_years_distinct,
        start_year_least_recent,
        start_year_most_recent,
        CASE WHEN count_races_distinct > 1 THEN 1 ELSE 0 END AS is_repeat_racer,

        -- count of active memberships / membership matches
        count_is_membership_match,
        count_is_not_membership_match,
        count_races_distinct,
        count_of_start_years_distinct,
        CASE 
            WHEN count_of_start_years_distinct > 0 THEN count_races_distinct / count_of_start_years_distinct
            ELSE 0
        END AS avg_races_per_year,

        is_active_membership_distinct,   
        CASE WHEN FIND_IN_SET('1', is_active_membership_distinct) > 0 THEN 1 ELSE 0 END AS had_race_membership_match,  
        
        -- [Sales Metrics]
        count_of_purchased_years_all,
        IFNULL(sales_units_total, '') AS sales_units_total,
        IFNULL(sales_revenue_total, '') AS sales_revenue_total,

        -- CREATED AT DATES
        DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
        DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
        
    FROM participation_profiles
    WHERE profile_id IS NOT NULL
    -- LIMIT 500000
    ;
`;

module.exports = {
    query_participation_profile
}
async function query_participation_with_membership_sales_match(batch_size = 10, offset = 0) {
    return `
        SELECT
            -- *********************
            -- PARTICIPATION DATA
            -- *********************
            id_rr,
            id_race_rr,
            id_events_rr,
            id_sanctioning_events,

            name_event_type,
            TRIM(BOTH '"' FROM name_events_rr) AS name_events_rr,
    
            TRIM(BOTH '"' FROM city_events) AS city_events,
            state_code_events,
            zip_events,

            DATE_FORMAT(start_date_races, '%Y-%m-%d') AS start_date_races,
            start_date_year_races,
            start_date_month_races,
            start_date_quarter_races,
            
            is_ironman,
    
            id_profile_rr,
            gender_code,

            age,
            age_as_race_results_bin, -- create bin for age based on race results record

            name_distance_types,
            name_race_type,
            category,

            -- *********************
            -- REGION DATA
            -- *********************
            state_id,
            region_code,
            state_name,
            state_code,
            region_name,
            region_abbr,

            -- *********************
            -- MEMBERSHIP DATA
            -- *********************
            id_profiles,
            member_min_created_at_year,

            region_name_member,
            region_abbr_member,

            REPLACE(REPLACE(REPLACE(member_city_addresses, '\r', ''), '\n', ''), '"', '') AS member_city_addresses,
            member_postal_code_addresses,
            IFNULL(member_lng_addresses, '') AS member_lng_addresses,
            IFNULL(member_lat_addresses, '') AS member_lat_addresses,
            member_state_code_addresses,
            member_country_code_addresses,

            DATE_FORMAT(purchased_on_date_adjusted_mp, '%Y-%m-%d') AS purchased_on_date_adjusted_mp,
            purchased_on_month_adjusted_mp,
            purchased_on_year_adjusted_mp,

            TRIM(BOTH '"' FROM name_events) AS name_events,
            id_events,
            region_name_events,
            region_abbr_events,

            id_membership_periods_sa,
            DATE_FORMAT(starts_mp, '%Y-%m-%d') AS starts_mp,
            DATE_FORMAT(ends_mp, '%Y-%m-%d') AS ends_mp,

            real_membership_types_sa,
            new_member_category_6_sa,

            member_created_at_category,

            member_lapsed_renew_category,
            member_lifetime_purchases,
            member_lifetime_frequency,
            member_upgrade_downgrade_category,
            most_recent_prior_purchase_membership_type,

            origin_flag_category,
            origin_flag_ma,
            
            sales_revenue,
            sales_units,

            -- IDENTIFY DUPLICATES = when race result id is applied to more than 1 membership
            rn, -- Ranks duplicates based on the nearest MP purchase date to the race start date,

            -- IDENTIFY ACTIVE MEMBERSHIP DATES OVERLAP WITH RACE DATES
            is_active_membership,

            -- ******************
            -- CREATED AT DATES
            -- ******************
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
            
        FROM all_participation_data_with_membership_match
        -- WHERE id_profiles IS NOT NULL -- there are missing profiles
        ORDER BY id_rr
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 500000
        ;
    `;
};

module.exports = {
    query_participation_with_membership_sales_match
}
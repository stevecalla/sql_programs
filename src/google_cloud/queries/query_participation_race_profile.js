async function query_participation_race_profile(batch_size = 10, offset = 0) {
    return `
        SELECT
            year,
            month,

            IFNULL(id_sanctioning_events, '') AS id_sanctioning_events,
            id_events_rr,
            id_race_rr,

            TRIM(BOTH '"' FROM name_events_rr) AS name_events_rr,
            name_race_type,
            name_distance_types,
            name_event_type,
            category,
            is_ironman,
            gender_code,

            region_name,
            zip_events,
            city_events,
            state_code_events,

            DATE_FORMAT(start_date_races, '%Y-%m-%d') AS start_date_races,
            start_date_month_races,
            start_date_quarter_races,
            start_date_year_races,
                        
            -- Fractional aggregation: each profile contributes 1/event_count to its events.
            weighted_distinct_profiles,
            count_id_profile_distinct,  

            count_total_profiles,
            count_all_participants,

            -- count of active memberships / membership matches
            is_active_membership,
            count_is_membership_match,
            count_is_not_membership_match,

            -- count of new / repeat
            count_is_repeat,
            count_is_new,

            -- count for membership type = adult annual, one day, elite, youth
            count_is_adult_annual,
            count_is_one_day,
            count_is_elite,
            count_is_youth_annual,

            -- CREATED AT DATES
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
            
        FROM participation_race_profiles
        ORDER BY id_sanctioning_events
        LIMIT ${batch_size} OFFSET ${offset}
        -- LIMIT 1000
        ;
    `;
};

module.exports = {
    query_participation_race_profile
}
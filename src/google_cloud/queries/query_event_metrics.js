async function query_event_metrics(batch_size = 10, offset = 0) {
    return `
        SELECT
            -- RACE / EVENT INFO
            id_events,
            id_sanctioning_events,
            id_races,         
            
            -- EVENT TYPES
            event_type_id_events,
            name_event_type,
            
            -- WEBSITES
            event_website_url,
            registration_url,

            -- EVENTS
            TRIM(BOTH '"' FROM name_events) AS name_events,
            REPLACE(REPLACE(REPLACE(address_events, '\r', ''), '\n', ''), '"', '') AS address_events,
            REPLACE(REPLACE(REPLACE(city_events, '\r', ''), '\n', ''), '"', '') AS city_events,

            -- EVENTS GEO
            zip_events,
            state_code_events,
            country_code_events,

            -- EVENTS DATES
            DATE_FORMAT(created_at_events, '%Y-%m-%d') AS created_at_events,
            created_at_month_events,
            created_at_quarter_events,
            created_at_year_events,
            
            DATE_FORMAT(starts_events, '%Y-%m-%d') AS starts_events,
            starts_month_events,
            starts_quarter_events,
            starts_year_events,
            
            DATE_FORMAT(ends_events, '%Y-%m-%d') AS ends_events,
            ends_month_events,
            ends_quarter_events,
            ends_year_events,
            
            status_events,
    
            -- RACE DIRECTOR
            race_director_id_events,
            id_race_director,
            email_users,
            member_number_members,
            
            -- IRONMAN
            is_ironman,
            
            -- RACES TABLE
            DATE_FORMAT(start_date_races, '%Y-%m-%d') AS start_date_races,
            start_date_month_races,
            start_date_quarter_races,
            start_date_year_races,
            
            -- RACE DISTANCE TYPES
            name_distance_types,
            
            -- RACE TYPES
            id_race_types,
            name_race_type,

            -- CREATED AT DATES
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc,

            -- REGION
            region_state_code,	
            region_name,
            region_abbr
                
        FROM event_data_metrics
        WHERE 1 = 1
        ORDER BY id_events DESC, id_races ASC
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_event_metrics
}
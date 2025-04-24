function step_1_query_event_data() {
    return `
        SELECT
            -- RACE / EVENT INFO
            e.id AS id_events,
            e.sanctioning_event_id AS id_sanctioning_events,
            r.id AS id_races,
            
            -- EVENT TYPES
            e.event_type_id AS event_type_id_events,
            et.name AS name_event_type,
            
            -- WEBSITES
            e.event_website_url,
            e.registration_url,

            -- EVENTS
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.name, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS name_events,
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.address, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS address_events,
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.city, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS city_events,

            -- EVENTS GEO
            e.zip AS zip_events,
            e.state_code AS state_code_events,
            e.country_code AS country_code_events,

            -- EVENTS DATES
            DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_events,
            MONTH(e.created_at) AS created_at_month_events,
            QUARTER(e.created_at) AS created_at_quarter_events,
            YEAR(e.created_at) AS created_at_year_events,

            DATE_FORMAT(e.starts, '%Y-%m-%d') AS starts_events,
            MONTH(e.starts) AS starts_month_events,
            QUARTER(e.starts) AS starts_quarter_events,
            YEAR(e.starts) AS starts_year_events,

            DATE_FORMAT(e.ends, '%Y-%m-%d') AS ends_events,
            MONTH(e.ends) AS ends_month_events,
            QUARTER(e.ends) AS ends_quarter_events,
            YEAR(e.ends) AS ends_year_events,

            e.status AS status_events,

            e.race_director_id AS race_director_id_events,
            
            -- IRONMAN
            CASE 
                    WHEN e.name LIKE '%IRONMAN%' OR e.name LIKE '%Ironman%' 
                    OR e.name LIKE '%70.3%' OR e.name LIKE '%140.6%' THEN 1 
                    ELSE 0
            END AS is_ironman,
            
            -- RACES TABLE
            DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date_races,
            MONTH(r.start_date) AS start_date_month_races,
            QUARTER(r.start_date) AS start_date_quarter_races,
            YEAR(r.start_date) AS start_date_year_races,
            
            -- RACE DISTANCE TYPES
            dt.name AS name_distance_types,
            
            -- RACE TYPES
            rt.id AS id_race_types,
            rt.name AS name_race_type,

            -- CREATED AT DATES
            DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'America/Denver'), '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS created_at_utc
                
        FROM events AS e
            LEFT JOIN races AS r ON e.id = r.event_id 
                AND r.deleted_at IS NULL
            LEFT JOIN race_types AS rt ON r.race_type_id = rt.id
            LEFT JOIN event_types AS et ON e.event_type_id = et.id
            LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id

        WHERE 1 = 1
            -- AND e.sanctioning_event_id = '308400'
            -- AND e.sanctioning_event_id = '308417'
            
            -- FILTERS
            -- AND LOWER(e.name) LIKE '%test%'
            -- AND e.deleted_at IS NOT NULL

            AND YEAR(e.starts) >= 2014
            AND LOWER(e.name) NOT LIKE '%test%'
            AND e.deleted_at IS NULL
            -- AND r.deleted_at IS NULL -- put in the join to correctly eliminate deleted races

        ORDER BY e.id DESC, r.id ASC

        -- LIMIT 10 OFFSET 0
        ;
    `;
}

module.exports = {
    step_1_query_event_data,
}
// C:\Users\calla\development\usat\sql_code\8_events\step_1_get_event_data_042125.sql

function step_1_query_event_data() {
    return `
        SELECT
            -- RACE / EVENT INFO
            e.id AS id_events,
            -- e.sanctioning_event_id AS id_sanctioning_events,
            CASE 
                WHEN r.designation IS NOT NULL AND r.designation != '' 
                    THEN CONCAT(e.sanctioning_event_id, '-', r.designation)
                ELSE e.sanctioning_event_id
            END AS id_sanctioning_events,
            r.id AS id_races,
            
            -- EVENT TYPES
            e.event_type_id AS event_type_id_events,
            -- et.name AS name_event_type, 
            r.designation as designation_races,
            CASE
                WHEN r.designation IS NOT NULL THEN r.designation
                WHEN r.designation IS NULL AND e.event_type_id = 1 THEN 'Adult Race'
                WHEN r.designation IS NULL AND e.event_type_id = 2 THEN 'Adult Clinic'
                WHEN r.designation IS NULL AND e.event_type_id = 3 THEN 'Youth Race'
                WHEN r.designation IS NULL AND e.event_type_id = 4 THEN 'Youth Clinic'
                ELSE "missing_event_type_race_designation"
            END AS name_event_type,
            
            -- WEBSITES
            e.event_website_url,
            e.registration_url,

            -- EVENTS
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.name, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS name_events,
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.address, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS address_events,
            CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.city, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS city_events,

            -- EVENTS GEO
            -- e.zip AS zip_events,
            LPAD(CAST(e.zip AS CHAR), 5, '0') AS zip_events,
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

            -- RACE DIRECTOR
            e.race_director_id AS race_director_id_events,
            rd.id as id_race_director,
            u.email AS email_users,
            m.member_number AS member_number_members,
            
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
            LEFT JOIN race_directors AS rd ON e.race_director_id = rd.id
            LEFT JOIN users AS u ON u.id = rd.user_id
            LEFT JOIN profiles AS p ON p.user_id = u.id
            -- LEFT JOIN members AS m ON p.id = m.memberable_id
            -- 	AND m.memberable_type = "profiles"
            -- the basic join above results in multiple member records thus the sub join below is appropriate
            LEFT JOIN (
                SELECT
                    memberable_id,
                    member_number,
                    MAX(created_at) AS last_joined_at
                FROM members
                WHERE memberable_type = 'profiles'
                GROUP BY memberable_id
            ) AS m ON m.memberable_id = p.id

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
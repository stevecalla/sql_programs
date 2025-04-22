// SOURCE:
// C:\Users\calla\development\usat\sql_code\5_race_participation\discovery_race_data_by_event_and_profile_031325.sql

function step_1_get_participation_data(start_date, end_date, offset, batch_size) {
    return `
        SELECT 
                -- RACE / EVENT INFO
                rr.id AS id_rr,
                rr.race_id AS id_race_rr,
        
                r.id AS id_races,
                e.id AS id_events,
                e.sanctioning_event_id AS id_sanctioning_events,
                e.event_type_id AS event_type_id_events,
                
                -- EVENT TYPES
                et.name AS name_event_type,

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
                e.last_season_event_id AS last_season_event_id,
                
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
                
                -- MEMBER DETAIL
                rr.profile_id AS id_profile_rr,
                rr.member_number as member_number_rr,
                rr.gender_code,
                rr.gender_id,
                rr.score,
                rr.finish_status,
                rr.age,
                rr.readable_time,
                rr.milliseconds,
                rr.category,
                
                -- RACE DISTANCE TYPES
                dt.name AS name_distance_types,
                
                -- RACE TYPES
                rt.id AS id_race_types,
                rt.name AS name_race_type,

                -- CREATED AT DATES
                DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'America/Denver'), '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
                DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS created_at_utc
                
        FROM race_results AS rr
                LEFT JOIN races AS r ON rr.race_id = r.id 
                LEFT JOIN race_types AS rt ON r.race_type_id = rt.id
                LEFT JOIN events AS e ON r.event_id = e.id
                LEFT JOIN event_types AS et ON e.event_type_id = et.id
                LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id
        
        WHERE 1 = 1
                -- AND r.start_date >= @start_date
                -- AND r.start_date <= @end_date
                -- AND YEAR(r.start_date) = @year
                
                -- NODE / JS
                AND r.start_date >= '${start_date}'
                AND r.start_date <= '${end_date}'

        ORDER BY rr.id ASC

        -- NODE / JS
        LIMIT ${batch_size} OFFSET ${offset}  
    `;
}

module.exports = {
    step_1_get_participation_data,
}
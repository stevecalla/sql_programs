// SOURCE:
//C:\Users\calla\development\usat\sql_code\5_race_participation\discovery_race_count_by_event_summary_012925.sql

function step_1_get_participation_data(start_date, end_date, offset, batch_size) {
    return `
          SELECT 
                -- RACE / EVENT INFO
                rr.race_id AS id_race_rr
                , r.id AS id_races
                , e.id AS id_events
                , e.sanctioning_event_id AS id_santioning_events
                , e.event_type_id AS event_type_id_events
                , et.name AS name_event_type

                -- EVENTS / EVENT TYPES TABLE
                , CONCAT('"', 
                        REPLACE(
                                REPLACE(
                                        REPLACE(SUBSTRING(e.name, 1, 255), '''', ''), 
                                        '"', ''
                                ), 
                                ',', ''
                                ), 
                                '"'
                ) AS name_events
                , CONCAT('"', 
                        REPLACE(
                                REPLACE(
                                REPLACE(SUBSTRING(e.address, 1, 255), '''', ''), 
                                '"', ''
                                ), 
                                ',', ''
                                ), 
                                '"'
                ) AS address_events
                , CONCAT('"', 
                        REPLACE(
                        REPLACE(
                                REPLACE(SUBSTRING(e.city, 1, 255), '''', ''), 
                                '"', ''
                        ), 
                        ',', ''
                        ), 
                        '"'
                ) AS city_events

                , e.zip AS zip_events
                , e.state_code AS state_code_events
                , e.country_code AS country_code_events
                
                , DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_events
                , MONTH(e.created_at) AS created_at_month_events
                , QUARTER(e.created_at) AS created_at_quarter_events
                , YEAR(e.created_at) AS created_at_year_events

                , DATE_FORMAT(e.starts, '%Y-%m-%d') AS starts_events 
                , MONTH(e.starts) AS starts_month_events
                , QUARTER(e.starts) AS starts_quarter_events
                , YEAR(e.starts) AS starts_year_events

                , DATE_FORMAT(e.ends, '%Y-%m-%d') AS ends_events
                , MONTH(e.ends) AS ends_month_events
                , QUARTER(e.ends) AS ends_quarter_events
                , YEAR(e.ends) AS ends_year_events

                , e.status AS status_events

                , e.race_director_id AS race_director_id_events
                , e.last_season_event_id AS last_season_event_id
                
                -- MEMBER DETAIL
                , rr.gender_code
                , rr.gender_id
                , rr.score
				
                -- RACE DETAILS
                , dt.name AS name_distance_types
                , rr.finish_status
                , rr.category
                , rr.age
                , rr.readable_time
                , rr.milliseconds
                
                -- METRICS
                , COUNT(DISTINCT profile_id) AS count_profile_id_distinct -- EXCLUDES THOSE WITHOUT A PROFILE ID
                , COUNT(*) AS count_all_participation -- INCLUDES ALL RACE PARTICIPANTS BECAUSE THIS QUERY INCLUDES GRANULAR DATA

        FROM race_results AS rr
                LEFT JOIN races AS r ON rr.race_id = r.id 
                LEFT JOIN events AS e ON r.event_id = e.id
                LEFT JOIN event_types AS et ON e.event_type_id = et.id
                LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id
        WHERE 
                r.start_date >= '${start_date}'
                AND r.start_date <= '${end_date}'
                -- AND rr.profile_id IS NULL
                
        GROUP BY 1, 2, 3, 4, 5, 6, 7
        ORDER BY 4, 3, 1 ASC
        LIMIT ${batch_size} OFFSET ${offset}  
    `;
}

module.exports = {
    step_1_get_participation_data,
}

                
// -- MEMBER INFO (REMOVE TO GET HIGHER LEVEL SUMMARY)
// , rr.profile_id AS profile_id_rr
// , rr.member_number as member_number_rr

// r.start_date >= ${start_date}
// AND r.start_date <= ${end_date}

// r.start_date >= '2024-01-01 00:00:00'
// AND r.start_date <= '2024-01-10 00:00:00'

// YEAR(r.start_date) >= '2024-01-01'
// AND YEAR(r.start_date) <= '2024-01-10'
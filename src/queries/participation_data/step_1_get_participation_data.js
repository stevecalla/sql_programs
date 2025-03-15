// SOURCE:
// C:\Users\calla\development\usat\sql_code\5_race_participation\discovery_race_data_by_event_and_profile_031325.sql

function step_1_get_participation_data(start_date, end_date, offset, batch_size) {
    return `
        SELECT 
                -- RACE / EVENT INFO
                rr.race_id AS id_race_results,
                r.id AS id_races,
                e.id AS id_events,
                e.sanctioning_event_id AS id_sanctioning_events,
                e.event_type_id AS event_type_id_events,
                et.name AS name_event_type,

                -- RACES TABLE
                DATE_FORMAT(r.start_date, '%Y-%m-%d') AS start_date_races,
                MONTH(r.start_date) AS start_date_month_events,
                QUARTER(r.start_date) AS start_date_quarter_events,
                YEAR(r.start_date) AS start_date_year_events,

                -- EVENTS / EVENT TYPES TABLE
                CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.name, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS name_events,
                CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.address, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS address_events,
                CONCAT('"', REPLACE(REPLACE(REPLACE(SUBSTRING(e.city, 1, 255), '''', ''), '"', ''), ',', ''), '"') AS city_events,

                -- EVENTS GEO
                e.zip AS zip_events,
                e.state_code AS state_code_events,
                e.country_code AS country_code_events,

                -- EVENTS DATES
                DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at_events,
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

                -- MEMBER DETAIL
                rr.gender_code,
                rr.gender_id,

                -- RACE DETAILS
                dt.name AS name_distance_types,
                rr.category,
                
                -- RACE TYPES
                rt.id AS id_race_types,
                rt.name AS name_race_type,     
                
                -- MEMBER INFO (REMOVE TO GET HIGHER LEVEL SUMMARY)
                rr.profile_id AS id_profile_rr,
                rr.member_number as member_number_rr,
                rr.score,
                rr.finish_status,
                rr.age,
                rr.readable_time,
                rr.milliseconds,
                
                -- IRONMAN
                CASE 
                        WHEN e.name LIKE '%IRONMAN%' OR e.name LIKE '%Ironman%' 
                                OR e.name LIKE '%70.3%' OR e.name LIKE '%140.6%' THEN 1 
                        ELSE 0
                END AS is_ironman, -- 1 = is_ironman / 0 = is_not_ironman

                rr.created_at AS created_at_rr,
                rr.updated_at AS updated_at_rr,

                CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'America/Denver') AS created_at_mtn,
                UTC_TIMESTAMP() AS created_at_utc,

                -- METRICS
                COUNT(DISTINCT rr.profile_id) AS count_profile_id_distinct, -- Excludes those without a profile ID
                COUNT(*) AS count_all_participation, -- Includes all race participants because this query includes granular data

                -- GENDER COUNT
                COUNT(DISTINCT CASE WHEN rr.gender_id IN (1) THEN e.sanctioning_event_id END) AS gender_male_count,
                COUNT(DISTINCT CASE WHEN rr.gender_id IN (2) THEN e.sanctioning_event_id END) AS gender_female_count,
                COUNT(DISTINCT CASE WHEN rr.gender_id NOT IN (1, 2) THEN e.sanctioning_event_id END) AS gender_other_count

        FROM race_results AS rr
                LEFT JOIN races AS r ON rr.race_id = r.id 
                LEFT JOIN race_types AS rt ON r.race_type_id = rt.id
                LEFT JOIN events AS e ON r.event_id = e.id
                LEFT JOIN event_types AS et ON e.event_type_id = et.id
                LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id

        WHERE 
                r.start_date >= '${start_date}'
                AND r.start_date <= '${end_date}'
                -- AND rr.profile_id IS NULL
                
        GROUP BY 
                rr.race_id, r.id, e.id, e.sanctioning_event_id, e.event_type_id, et.name,
                e.name, e.address, e.city, e.zip, e.state_code, e.country_code,
                r.created_at, e.created_at, e.starts, e.ends, e.status, e.race_director_id,
                e.last_season_event_id, rr.gender_code, rr.gender_id,
                dt.name, rr.category, rt.id, rt.name,
                
                rr.profile_id,
                rr.member_number,
                rr.score,
                rr.finish_status,
                rr.age,
                rr.readable_time,
                rr.milliseconds

        ORDER BY e.sanctioning_event_id, e.id, rr.race_id ASC
        LIMIT ${batch_size} OFFSET ${offset}  
    `;
}

module.exports = {
    step_1_get_participation_data,
}
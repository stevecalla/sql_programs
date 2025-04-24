USE vapor;

SELECT * FROM events AS e WHERE e.sanctioning_event_id = '307440'LIMIT 10;
SELECT COUNT(*), COUNT(DISTINCT id), COUNT(DISTINCT sanctioning_event_id) FROM events;
SELECT status, COUNT(status) FROM events GROUP BY 1;
SELECT YEAR(starts), COUNT(*) FROM events GROUP BY 1;

-- COUNT QA CHECK BETWEEN EVENTS AND RACE START DATES
SELECT COUNT(*) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id;
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1; -- COUNT BY EVENT START DATE
SELECT YEAR(r.start_date), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1; -- COUNT BY RACE START DATE
SELECT YEAR(e.starts), YEAR(r.start_date), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1, 2; -- COUNT BY EVENT START BY RACE START DATE
-- PULL BAD RACE DATE INFO FOR SAM TO CORRECT
SELECT 
	e.sanctioning_event_id, 
    YEAR(e.starts), e.starts, 
    YEAR(r.start_date), r.start_date, 
    CASE
		WHEN YEAR(e.starts) = YEAR(r.start_date) THEN 0
        ELSE 1
	END AS is_not_year_match,
    COUNT(DISTINCT e.sanctioning_event_id) 
FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id 
GROUP BY 1, 2, 3, 4, 5
HAVING is_not_year_match IN (0, 1)
;

-- EVENT TABLE FILTER QA
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE LOWER(e.name) LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- test event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE LOWER(e.name) NOT LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- not test event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NOT NULL GROUP BY 1 WITH ROLLUP; -- deleted event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NULL GROUP BY 1 WITH ROLLUP; -- not deleted event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NULL AND LOWER(e.name) NOT LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- not deleted event records

SELECT
    YEAR(e.starts) AS event_year,

    -- How many “test” events
    SUM(CASE 
            WHEN LOWER(e.name) LIKE '%test%' THEN 1 
            ELSE 0 
        END) AS is_test,

    -- How many deleted events
    SUM(CASE 
            WHEN e.deleted_at IS NOT NULL THEN 1 
            ELSE 0 
        END) AS is_deleted,

    -- Total distinct events
    COUNT(DISTINCT e.sanctioning_event_id) AS total_events,

    -- Total less tests and deletions
    COUNT(DISTINCT e.sanctioning_event_id)
      - SUM(CASE WHEN LOWER(e.name) LIKE '%test%' THEN 1 ELSE 0 END)
      - SUM(CASE WHEN e.deleted_at IS NOT NULL THEN 1 ELSE 0 END)
    AS is_not_deleted_not_test_events

FROM events AS e
GROUP BY YEAR(e.starts)
WITH ROLLUP;

SELECT * FROM races AS r LIMIT 10;
SELECT YEAR(r.start_date), COUNT(DISTINCT r.id) FROM races AS r WHERE r.deleted_at IS NOT NULL GROUP BY 1 WITH ROLLUP; -- deleted race records
SELECT YEAR(r.start_date), COUNT(DISTINCT r.id) FROM races AS r WHERE r.deleted_at IS NULL GROUP BY 1 WITH ROLLUP; -- not deleted race records

-- SELECT COUNT(*) FROM races LIMIT 10;
-- SELECT * FROM event_types LIMIT 10;
-- SELECT * FROM race_types LIMIT 10;
-- SELECT * FROM vapor.profiles LIMIT 10;
    
SELECT 
    -- REQUESTED FIELDS
    -- status
    -- race gender
    -- RaceDirectorUserID
    -- Email
    
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
    r.womens_only, -- no doesn't work
    rt.id AS id_race_types,
    rt.name AS name_race_type,
    
    -- FILTERS
    CASE
        WHEN LOWER(e.name) LIKE '%test%' THEN 1
        WHEN LOWER(e.name) NOT LIKE '%test%' THEN 0
        ELSE 0
	END is_test,
    CASE
        WHEN e.deleted_at IS NOT NULL THEN 1
        WHEN e.deleted_at IS NULL THEN 0
        ELSE 0
	END is_deleted,
    e.deleted_at,

    -- CREATED AT DATES
    DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'America/Denver'), '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
    DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS created_at_utc
        
-- FROM race_results AS rr
FROM events AS e
    LEFT JOIN races AS r ON e.id = r.event_id 
    LEFT JOIN race_types AS rt ON r.race_type_id = rt.id
    LEFT JOIN event_types AS et ON e.event_type_id = et.id
    LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id

WHERE 1 = 1
    -- AND e.sanctioning_event_id = '308400'
    -- AND e.sanctioning_event_id = '308417'
    
    -- FILTERS
    -- AND LOWER(e.name) LIKE '%test%'
    -- AND e.deleted_at IS NOT NULL
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL
    AND r.deleted_at IS NULL

ORDER BY e.id DESC, r.id ASC

-- NODE / JS
-- LIMIT ${batch_size} OFFSET ${offset} 
-- 10 OFFSET 0
;


-- GET ROLLUP OF NUMBER OF EVENTS BY YEAR BY MONTH
WITH events_cte AS (
  SELECT
    e.sanctioning_event_id,
    YEAR(e.starts)  AS start_year,
    MONTH(e.starts) AS start_month
  FROM events AS e
    LEFT JOIN races        AS r  ON e.id = r.event_id 
    LEFT JOIN event_types  AS et ON e.event_type_id = et.id
    LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id
    LEFT JOIN race_types   AS rt ON r.race_type_id = rt.id
  WHERE LOWER(e.name) NOT LIKE '%test%'
    -- (any other filters you need)
)
SELECT COUNT(*) FROM events_cte;
SELECT
  start_year,
  start_month,
  COUNT(DISTINCT sanctioning_event_id) AS sanctioning_event_count
FROM events_cte
GROUP BY
  start_year,
  start_month
ORDER BY
  start_year ASC,
  start_month ASC
  ;

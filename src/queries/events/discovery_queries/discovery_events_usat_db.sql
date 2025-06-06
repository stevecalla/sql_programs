USE vapor;

-- SF RECONCILIATION
SELECT * FROM events AS e WHERE e.sanctioning_event_id = 310323; -- delete at date
SELECT * FROM events AS e WHERE e.sanctioning_event_id = 311130; -- delete at date
SELECT * FROM events AS e WHERE e.sanctioning_event_id IN (310323,310425,310725,310728,310769,310782,310783,310887,311146,311292,311293,311318,311319,311328,311374,311419,311420,311496,311537,311623,311637,311648,350340,350350,350554
); -- delete at date


-- INITIAL DISCOVERY
SELECT * FROM events AS e WHERE e.sanctioning_event_id = '307440' LIMIT 10;

SELECT * FROM events AS e WHERE e.sanctioning_event_id IN (307440, 350276) LIMIT 10;

SELECT sanctioning_event_id, name, created_at, deleted_at, status FROM events AS e WHERE e.sanctioning_event_id IN ( 350276, 350168, 350272, 350260, 350265, 350270, 350278, 
350286) LIMIT 10;

SELECT sanctioning_event_id, name, created_at, deleted_at, status FROM events AS e WHERE created_at > '2025-04-28' LIMIT 10;

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

-- GET 350000+ EVENTS FOR SAM
SELECT * FROM events AS e WHERE e.sanctioning_event_id >= 350000 LIMIT 10;
SELECT COUNT(*) FROM events AS e WHERE e.sanctioning_event_id >= 350000;
SELECT 
	e.sanctioning_event_id,
    e.created_at,
    e.updated_at,
    e.name,
    e.deleted_at,
    e.status,
    r.designation,    
    -- EVENT TYPES
    e.event_type_id AS event_type_id_events,
    et.name AS name_event_type,
    -- check the event race type?
    YEAR(e.starts), e.starts, 
    YEAR(r.start_date), r.start_date AS start_date_races, 
    CASE
		WHEN YEAR(e.starts) = YEAR(r.start_date) THEN 0
        ELSE 1
	END AS is_not_year_match,
    COUNT(DISTINCT e.sanctioning_event_id) 
FROM events AS e
	LEFT JOIN races AS r ON e.id = r.event_id
		  AND r.deleted_at IS NULL
    LEFT JOIN event_types AS et ON e.event_type_id = et.id
WHERE 1 = 1	
	AND e.sanctioning_event_id >= 350000
	AND YEAR(e.starts) >= 2014
	AND LOWER(e.name) NOT LIKE '%test%'
	AND e.deleted_at IS NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7
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
      - SUM(CASE WHEN LOWER(e.name) LIKE '%test%' OR e.deleted_at IS NOT NULL THEN 1 ELSE 0 END) -- use or to consider overlaps between these conditions
    AS is_not_deleted_not_test_events

-- FROM events AS e
-- WHERE 1 = 1 AND YEAR(e.starts) >= 2014
-- GROUP BY YEAR(e.starts)

FROM events AS e
    LEFT JOIN races AS r ON e.id = r.event_id 
		-- AND r.deleted_at IS NULL
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
    AND YEAR(e.starts) >= 2014
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL

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
    -- create sanctioning event id combined with designation
		    -- created id_designation_custom_races
        -- QA = ensured count was the same historically using sanction id vs the new combined sanction id
        -- fix exceptions = 2 exceptions "AND e.sanctioning_event_id IN (310522, 307623)"; fixed by Sam on 4/28/25
    -- race designation vs event type
      -- create new event type using event type or race designation
      -- modify the event type to match the race type (ie adult event = adult race)
    -- add to raw data query
        -- revised event type def 
        -- revised sanctioning id def
    -- key metrics
    -- python

    
    -- RACE / EVENT INFO
    e.id AS id_events,
    e.sanctioning_event_id AS id_sanctioning_events,
    r.designation,
    r.id AS id_races,
    
    -- RACE DESIGNATION
		-- field added to create count consistency over time
    r.designation AS designation_races,
    CASE 
		WHEN r.designation IS NOT NULL AND r.designation != '' 
        THEN CONCAT(e.sanctioning_event_id, '-', r.designation)
      ELSE e.sanctioning_event_id
    END AS id_designation_custom_races,
    
    -- EVENT TYPES
    e.event_type_id AS event_type_id_events, -- used prior to 4/18/25 change to new salesforce santioning db
    et.name AS name_event_type, -- used prior to 4/18/25 change to new salesforce santioning db
    -- new logic based on salesforce santioning db not using event type going forward, using race designation
    r.designation as designation_races,
    CASE
      WHEN r.designation IS NOT NULL THEN r.designation
      WHEN r.designation IS NULL AND e.event_type_id = 1 THEN 'Adult Race'
      WHEN r.designation IS NULL AND e.event_type_id = 2 THEN 'Adult Clinic'
      WHEN r.designation IS NULL AND e.event_type_id = 3 THEN 'Youth Race'
      WHEN r.designation IS NULL AND e.event_type_id = 4 THEN 'Youth Clinic'
      ELSE "missing_event_type_race_designation"
    END AS name_event_type_or_race_desigation,
    
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
    -- AND e.sanctioning_event_id IN (310522, 307623) -- exceptions: unique count for sanction id vs id_designation_custom_races
    -- FILTERS
    -- AND LOWER(e.name) LIKE '%test%'
    -- AND e.deleted_at IS NOT NULL

    AND YEAR(e.starts) >= 2014
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL
    -- AND r.deleted_at IS NULL

ORDER BY e.id DESC, r.id ASC
;

-- ORIGIN JOIN LOGIC THAT DID NOT WORK
SELECT * FROM events AS e WHERE e.sanctioning_event_id = 308417 LIMIT 10; -- race director id = 5076
SELECT * FROM profiles AS p WHERE user_id = 5076 LIMIT 10;  -- elise alfred; p.id 5050
SELECT * FROM users AS u WHERE id = 5076 LIMIT 10; -- email 'elisetonne@yahoo.com' doesn't match jen.mcveay@lls.org
SELECT * FROM members AS m LEFT JOIN profiles AS p ON p.id = m.memberable_id WHERE p.id = 5076 LIMIT 10; -- member_number = 161254 doesn't match 2100004549

-- REVISED JOIN LOGIC THAT USES p.user_id TO MATCH TO THE user TABLE
SELECT * FROM events AS e WHERE e.sanctioning_event_id = 308417 LIMIT 10; -- race director id = 5076
SELECT * FROM race_directors WHERE id = 5076;
SELECT * FROM profiles AS p WHERE user_id = 171943 LIMIT 10;  -- Jen McVeay 
SELECT * FROM users AS u WHERE id = 171943 LIMIT 10; -- email 'jennymac18@gmail.com' doesn't match jen.mcveay@lls.org
SELECT * FROM members AS m LEFT JOIN profiles AS p ON p.id = m.memberable_id WHERE p.id = 5076 LIMIT 10; -- member_number = 161254 doesn't match 2100004549

-- GET RACE DIRECTOR INFO
SELECT 
	e.sanctioning_event_id,
    e.name,
	e.race_director_id,
    rd.id AS id_rd,
    u.id AS id_u,
    u.email as email_u,
    p.user_id AS id_user_p
--     m.member_number,
--     m.memberable_type
    -- MAX(m.updated_at)
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
-- 		AND m.memberable_type = "profiles"
WHERE 1 = 1
--     AND e.sanctioning_event_id = '308400'
--     OR e.sanctioning_event_id = '308417'
    AND YEAR(e.starts) >= 2014
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL
-- GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
;

-- GET ROLLUP OF NUMBER OF EVENTS BY YEAR BY MONTH
WITH events_cte AS (
  SELECT
    e.sanctioning_event_id,
    YEAR(e.starts)  AS start_year,
    MONTH(e.starts) AS start_month
  FROM events AS e
    LEFT JOIN races AS r  ON e.id = r.event_id 
    LEFT JOIN event_types AS et ON e.event_type_id = et.id
    LEFT JOIN distance_types AS dt ON r.distance_type_id = dt.id
    LEFT JOIN race_types AS rt ON r.race_type_id = rt.id
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

-- CHECK DELETED RACES
SELECT
	COUNT(*)
FROM events AS e
    LEFT JOIN races AS r ON e.id = r.event_id 
		AND r.deleted_at IS NULL
WHERE 1 = 1
--     AND e.sanctioning_event_id = '308400'
--     OR e.sanctioning_event_id = '308417'
    AND YEAR(e.starts) >= 2014
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL
-- GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
;


USE vapor;

-- EVENTS TABLE
SELECT * FROM events AS e WHERE e.sanctioning_event_id = '307440'LIMIT 10;
SELECT * FROM events AS e WHERE e.sanctioning_event_id = '350122'LIMIT 10;
SELECT "events_count", COUNT(*), COUNT(DISTINCT id), COUNT(DISTINCT sanctioning_event_id) FROM events;
SELECT "events_count",  "deleted not null", COUNT(*), COUNT(DISTINCT id), COUNT(DISTINCT sanctioning_event_id) FROM events WHERE deleted_at IS NOT NULL GROUP BY 1, 2;
SELECT "events", status, COUNT(status) FROM events GROUP BY 1, 2;
SELECT "events", YEAR(starts), COUNT(*) FROM events GROUP BY 1, 2; -- 2024 = 1,467 / 2025 = 1,251
SELECT "events",  "deleted not null", YEAR(starts), COUNT(*) FROM events WHERE deleted_at IS NULL GROUP BY 1, 2, 3 ORDER BY 3;

-- RACES TABLE
SELECT * FROM races AS r LIMIT 10;
SELECT * FROM races AS r WHERE r.event_id = 33376 LIMIT 10;
SELECT "races_count", COUNT(*) FROM races AS r LIMIT 10;
SELECT "races_count", "deleted not null", COUNT(*) FROM races WHERE deleted_at IS NOT NULL;
SELECT "races", YEAR(r.start_date), COUNT(DISTINCT r.id) FROM races AS r WHERE r.deleted_at IS NOT NULL GROUP BY 1, 2 WITH ROLLUP; -- deleted race records

-- COUNT QA CHECK BETWEEN EVENTS AND RACE START DATES
SELECT "events & races join count", COUNT(*) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id;
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1; -- COUNT BY EVENT START DATE; 2024 = 1,467 / 2025 = 1,251
SELECT YEAR(r.start_date), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1; -- COUNT BY RACE START DATE
SELECT YEAR(e.starts), YEAR(r.start_date), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e LEFT JOIN races AS r ON e.id = r.event_id GROUP BY 1, 2; -- COUNT BY EVENT START BY RACE START DATE

-- EVENT TABLE FILTER QA
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE LOWER(e.name) LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- test event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE LOWER(e.name) NOT LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- not test event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NOT NULL GROUP BY 1 WITH ROLLUP; -- deleted event records
SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NULL GROUP BY 1 WITH ROLLUP; -- not deleted event records

SELECT YEAR(e.starts), COUNT(DISTINCT e.sanctioning_event_id) FROM events AS e WHERE e.deleted_at IS NULL AND LOWER(e.name) NOT LIKE '%test%' GROUP BY 1 WITH ROLLUP; -- not deleted event records

SELECT
    YEAR(e.starts) AS event_year,
    
	-- find difference unique count using sanctioning id and id_designation_custom_races
  --     e.sanctioning_event_id,
  -- 	CASE 
  -- 		WHEN r.designation IS NOT NULL AND r.designation != '' 
  --           THEN CONCAT(e.sanctioning_event_id, '-', r.designation)
  --         ELSE e.sanctioning_event_id
  -- 	END AS count_combined_distinct,
    
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
    AS is_not_deleted_not_test_events,
    
    -- RACE DESIGNATION
    COUNT(DISTINCT 
      CASE 
        WHEN r.designation IS NOT NULL AND r.designation != '' 
          THEN CONCAT(e.sanctioning_event_id, '-', r.designation)
        ELSE e.sanctioning_event_id
      END
    ) AS count_combined_distinct
    
--     CASE
-- 		when event type = make it that event
--         when desigantion = make it that designation
--         else "missing value"
-- 	END AS event_type....

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
    -- AND YEAR(e.starts) >= 2014
    AND YEAR(e.starts) = 2024
    AND LOWER(e.name) NOT LIKE '%test%'
    AND e.deleted_at IS NULL

GROUP BY YEAR(e.starts)
-- GROUP BY YEAR(e.starts), 2, 3 -- find difference unique count using sanctioning id and id_designation_custom_races
WITH ROLLUP;

-- SELECT COUNT(*) FROM races LIMIT 10;
-- SELECT * FROM event_types LIMIT 10;
-- SELECT * FROM race_types LIMIT 10;
-- SELECT * FROM vapor.profiles LIMIT 10;
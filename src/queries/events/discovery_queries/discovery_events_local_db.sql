USE usat_sales_db;

-- ****************************
-- EVENT DATA RAW TABLE
-- ****************************
SELECT * FROM all_event_data_raw LIMIT 10;
SELECT id_sanctioning_events, name_events, starts_events, start_date_races FROM all_event_data_raw WHERE id_sanctioning_events IN (309261, 309811) GROUP BY 1, 2, 3, 4 ORDER BY 1 LIMIT 10;
SELECT * FROM all_event_data_raw WHERE id_sanctioning_events = 309811;
SELECT status_events, COUNT(status_events) FROM all_event_data_raw GROUP BY 1 WITH ROLLUP;
SELECT COUNT(*) FROM all_event_data_raw LIMIT 10;

SELECT starts_year_events, COUNT(DISTINCT id_sanctioning_events) FROM all_event_data_raw GROUP BY 1 WITH ROLLUP;
SELECT starts_year_events, start_date_year_races, COUNT(DISTINCT id_sanctioning_events) FROM all_event_data_raw GROUP BY 1, 2;
SELECT start_date_year_races, COUNT(DISTINCT id_sanctioning_events) FROM all_event_data_raw GROUP BY 1 WITH ROLLUP;

-- GET ROLLUP OF NUMBER OF EVENTS BY YEAR BY MONTH
WITH events_cte AS (
  SELECT
    e.id_sanctioning_events,
    e.starts_year_events,
    e.starts_month_events
  FROM all_event_data_raw AS e
)
SELECT
  starts_year_events,
  starts_month_events,
  COUNT(DISTINCT id_sanctioning_events) AS sanctioning_event_count
FROM events_cte
GROUP BY
  starts_year_events,
  starts_month_events
ORDER BY
  starts_year_events ASC,
  starts_month_events ASC
;
-- ****************************
-- EVENT METRICS TABLE
-- ****************************
SELECT * FROM usat_sales_db.event_data_metrics;
SELECT COUNT(*), COUNT(DISTINCT id_sanctioning_events) FROM usat_sales_db.event_data_metrics;
SELECT DISTINCT region_name, region_state_code, COUNT(*) FROM event_data_metrics GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC;

SELECT 
	e.*,
  rg.state_code AS region_state_code,	
	rg.region_name,
  rg.region_abbr

FROM all_event_data_raw AS e
	LEFT JOIN region_data AS rg ON rg.state_code = e.state_code_events

WHERE 1 = 1
ORDER BY id_events DESC, id_races ASC
LIMIT 10 OFFSET 0
;
-- ****************************
-- PYTHON QUERY
-- ****************************
SELECT 
    id_sanctioning_events AS ApplicationID,
    -- id_races,

    TRIM(BOTH '"' FROM name_events) AS Name,

    starts_events AS StartDate,

    start_date_races AS RaceDate,

    status_events AS Status,

    state_code_events AS 2LetterCode,
    zip_events AS ZipCode,

    name_event_type AS Value,

	member_number_members AS RaceDirectorUserID,

    event_website_url AS Website,
    registration_url AS RegistrationWebsite,

    email_users AS Email,
	DATE_FORMAT(created_at_events, '%Y-%m-%d') AS CreatedDate

FROM all_event_data_raw AS e

WHERE 1 = 1
    AND id_sanctioning_events IS NOT NULL
    AND start_date_year_races IN (2024, 2025)
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
ORDER BY id_sanctioning_events
-- LIMIT 10 OFFSET 0
;

-- PYTHON QUERY
SELECT 
	start_date_year_races,
    COUNT(DISTINCT id_sanctioning_events) AS ApplicationID
FROM all_event_data_raw AS e
WHERE 1 = 1
    AND id_sanctioning_events IS NOT NULL
    -- AND start_date_year_races IN (2025)
GROUP BY 1
ORDER BY start_date_year_races DESC
-- LIMIT 10 OFFSET 0
;
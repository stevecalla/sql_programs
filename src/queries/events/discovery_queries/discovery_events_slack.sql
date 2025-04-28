-- COUNT BY MONTH YOY
SELECT * FROM event_data_metrics LIMIT 10;

-- COUNT BY YEAR TREND
SELECT starts_year_events, COUNT(DISTINCT id_sanctioning_events) FROM event_data_metrics GROUP BY 1 ORDER BY 1 LIMIT 100;

-- COUNT BY MONTH YOY
SELECT
  starts_month_events,
  COUNT(DISTINCT IF(starts_year_events = 2024, id_sanctioning_events, NULL))
    AS count_2024_sanctioning_id_distinct,
  COUNT(DISTINCT IF(starts_year_events = 2025, id_sanctioning_events, NULL))
    AS count_2025_sanctioning_id_distinct
FROM event_data_metrics
GROUP BY starts_month_events
ORDER BY starts_month_events
LIMIT 100;


-- COUNT DRAFT BY YEAR BY MONTH YOY
-- CURRENT MONTH BY TYPE COUNT WITH YOY CHANGE
-- EVENTS IN A GIVEN MONTH
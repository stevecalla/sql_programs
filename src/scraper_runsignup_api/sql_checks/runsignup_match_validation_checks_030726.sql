-- ============================================================
-- Query 1
-- Description: View a small sample of raw RunSignup rows to confirm
-- the table loaded correctly and columns look correct.
-- ============================================================
SELECT
  1 AS query_number,
  'sample_rows_preview' AS query_label,
  r.*
FROM all_runsignup_data_raw r
LIMIT 10;


-- ============================================================
-- Query 2
-- Description: Get the total number of rows loaded into the
-- RunSignup table.
-- ============================================================
SELECT
  2 AS query_number,
  'total_row_count' AS query_label,
  COUNT(*) AS total_rows
FROM all_runsignup_data_raw;


-- ============================================================
-- Query 3
-- Description: Count events by year and event type and show how
-- many matched to a USAT sanctioned event vs total events.
-- Note: RunSignup does not have a source-side USAT sanction number,
-- so we only review matched_usat_sanctioned vs total rows.
-- ============================================================
SELECT
  3 AS query_number,
  'event_counts_by_year_event_type' AS query_label,
  event_year,
  event_type,
  COUNT(DISTINCT CASE WHEN matched_usat_sanctioned = 1 THEN race_id END) AS matched_distinct_race_id_count,
  COUNT(DISTINCT CASE WHEN matched_usat_sanctioned = 1 THEN event_id END) AS matched_distinct_event_id_count,
  COUNT(DISTINCT race_id) AS count_distinct_race_id,
  COUNT(DISTINCT event_id) AS count_distinct_event_id,
  COUNT(*) AS total_count
FROM all_runsignup_data_raw
GROUP BY event_year, event_type
ORDER BY event_type, event_year;

-- ============================================================
-- Query 4
-- Description: Inspect RunSignup events that matched to USAT
-- internal IDs and review the matching method and score.
-- ============================================================
SELECT
  4 AS query_number,
  'inspect_matched_events' AS query_label,
  id,
  race_id,
  race_name,
  event_id,
  event_name,
  address_city,
  address_state,
  event_start_time,
  event_type,
  distance,
  usat_match_name,
  usat_match_city,
  usat_match_state,
  usat_match_date,
  usat_event_id_internal,
  usat_sanction_id_internal,
  usat_status_internal,
  usat_event_type_internal,
  usat_race_type_internal,
  match_method,
  match_score_internal,
  name_score_internal,
  date_diff_days_internal,
  city_match_flag_internal
FROM all_runsignup_data_raw
WHERE event_year = 2026
  AND matched_usat_sanctioned = 1
ORDER BY match_score_internal DESC, id
LIMIT 1000;

-- ============================================================
-- Query 5
-- Description: Show the distribution of match methods used
-- by the matching logic.
-- ============================================================
SELECT
  5 AS query_number,
  'match_method_distribution' AS query_label,
  match_method,
  COUNT(*) AS row_count
FROM all_runsignup_data_raw
WHERE event_year = 2026
GROUP BY match_method
ORDER BY row_count DESC, match_method;

-- ============================================================
-- Query 6
-- Description: Summary showing how many RunSignup rows were matched
-- to a USAT sanctioned event vs unmatched.
-- ============================================================
SELECT
  6 AS query_number,
  'final_match_summary' AS query_label,
  matched_usat_sanctioned,
  COUNT(*) AS row_count
FROM all_runsignup_data_raw
WHERE event_year = 2026
GROUP BY matched_usat_sanctioned
ORDER BY matched_usat_sanctioned;


-- ============================================================
-- Query 7
-- Description: Review fuzzy matching results where matches
-- were made using broader logic such as state/month or state
-- only. Helps validate the name/date/city pairing quality.
-- ============================================================
SELECT
  7 AS query_number,
  'validate_fuzzy_name_pairings' AS query_label,
  id,
  race_id,
  race_name,
  usat_match_name,
  address_city,
  usat_match_city,
  address_state,
  usat_match_state,
  event_start_time,
  usat_match_date,
  event_type,
  distance,
  match_method,
  match_score_internal,
  name_score_internal,
  date_diff_days_internal,
  city_match_flag_internal
FROM all_runsignup_data_raw
WHERE event_year = 2026
  AND match_method IN ('state_month_pm_1', 'state_only')
ORDER BY match_score_internal DESC, id
-- LIMIT 50
;

-- ============================================================
-- Query 8
-- Description: Inspect RunSignup events that did not match to a USAT
-- sanctioned event to understand why they were excluded.
-- ============================================================
SELECT
  8 AS query_number,
  'unmatched_event_inspection' AS query_label,
  id,
  race_id,
  race_name,
  event_id,
  event_name,
  address_city,
  address_state,
  event_start_time,
  event_type,
  distance,
  usat_match_name,
  usat_match_city,
  usat_match_state,
  usat_match_date,
  match_method,
  match_score_internal,
  name_score_internal,
  date_diff_days_internal,
  city_match_flag_internal,
  matched_usat_sanctioned,
  score_bin_internal
FROM all_runsignup_data_raw
WHERE event_year = 2026
  AND matched_usat_sanctioned = 0
ORDER BY id
LIMIT 50;

-- ============================================================
-- Query 9
-- Description: Review score bin distribution for RunSignup rows.
-- Helps assess whether the threshold is too strict or too loose.
-- ============================================================
SELECT
  9 AS query_number,
  'score_bin_distribution' AS query_label,
  score_bin_internal,
  COUNT(*) AS row_count
FROM all_runsignup_data_raw
WHERE event_year = 2026
GROUP BY score_bin_internal
ORDER BY score_bin_internal;


-- ============================================================
-- Query 10
-- Description: Review high-scoring unmatched rows to identify
-- near-misses that may need threshold or normalization tuning.
-- ============================================================
SELECT
  10 AS query_number,
  'high_scoring_unmatched_rows' AS query_label,
  id,
  race_id,
  race_name,
  address_city,
  address_state,
  event_start_time,
  event_type,
  distance,
  usat_match_name,
  usat_match_city,
  usat_match_state,
  usat_match_date,
  match_method,
  match_score_internal,
  name_score_internal,
  date_diff_days_internal,
  city_match_flag_internal,
  matched_usat_sanctioned,
  score_bin_internal
FROM all_runsignup_data_raw
WHERE event_year = 2026
  AND matched_usat_sanctioned = 0
  AND match_score_internal >= 75
ORDER BY match_score_internal DESC, id
LIMIT 100;
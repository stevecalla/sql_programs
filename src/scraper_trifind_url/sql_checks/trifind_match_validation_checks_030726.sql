-- ============================================================
-- Query 1
-- Description: View a small sample of raw Trifind rows to confirm
-- the table loaded correctly and columns look correct.
-- ============================================================
SELECT
  1 AS query_number,
  'sample_rows_preview' AS query_label,
  t.*
FROM all_trifind_data_raw t
LIMIT 10;

-- ============================================================
-- Query 2
-- Description: Get the total number of rows loaded into the
-- Trifind table.
-- ============================================================
SELECT
  2 AS query_number,
  'total_row_count' AS query_label,
  COUNT(*) AS total_rows
FROM all_trifind_data_raw;

-- ============================================================
-- Query 3
-- Description: Count events by year and race type and show how
-- many have a USAT sanction number vs total events.
-- ============================================================
SELECT
  3 AS query_number,
  'event_counts_by_year_race_type' AS query_label,
  event_year,
  race_type,
  SUM(CASE WHEN usat_event_id_number IS NOT NULL THEN 1 ELSE 0 END) AS usat_sanctioned_count,
  SUM(CASE WHEN matched_usat_sanctioned = 1 THEN 1 ELSE 0 END) AS matched_usat_sanctioned_count,
  COUNT(*) AS total_count
FROM all_trifind_data_raw
GROUP BY event_year, race_type
ORDER BY event_year, race_type;

-- ============================================================
-- Query 4
-- Description: Inspect Trifind events that appear to be USAT
-- sanctioned and see how they matched to USAT internal IDs.
-- ============================================================
SELECT
  4 AS query_number,
  'inspect_sanctioned_matches' AS query_label,
  id,
  title,
  usat_event_id_number,
  is_usat_sanctioned,
  usat_event_id_internal,
  usat_sanction_id_internal,
  match_method,
  match_score_internal
FROM all_trifind_data_raw
WHERE event_year = 2026
  AND is_usat_sanctioned = 'Yes'
  AND match_score_internal < 100
ORDER BY id
LIMIT 1000;

-- ============================================================
-- Query
-- Description: Show which sanction numbers match rows in
-- event_data_metrics and which ones do not.
-- ============================================================
WITH sanction_list AS (
    SELECT 32032 AS id_events UNION ALL
    SELECT 32420 UNION ALL
    SELECT 32465 UNION ALL
    SELECT 32536 UNION ALL
    SELECT 32580 UNION ALL
    SELECT 32673 UNION ALL
    SELECT 32741 UNION ALL
    SELECT 33031 UNION ALL
    SELECT 33160 UNION ALL
    SELECT 33164 UNION ALL
    SELECT 33360 UNION ALL
    SELECT 33551 UNION ALL
    SELECT 38172 UNION ALL
    SELECT 38326
)
SELECT
    ROW_NUMBER() OVER (ORDER BY s.id_events) AS row_num,
    s.id_events,
    COUNT(e.id_events) AS matching_rows,
    CASE
        WHEN COUNT(e.id_events) = 0 THEN 'NO_MATCH'
        ELSE 'MATCH'
    END AS match_status,
    COUNT(*) OVER () AS total_sanctions_checked
FROM sanction_list s
LEFT JOIN event_data_metrics e
    ON e.id_events = s.id_events
GROUP BY s.id_events
ORDER BY s.id_events;

SELECT id_events, COUNT(*) FROM event_data_metrics WHERE id_events IN (38172,38326) GROUP BY 1 ORDER BY 1;

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
FROM all_trifind_data_raw
WHERE event_year = 2026
GROUP BY match_method
ORDER BY row_count DESC;


-- ============================================================
-- Query 6
-- Description: Summary showing how many events were matched
-- to a USAT sanctioned event vs unmatched.
-- ============================================================
SELECT
  6 AS query_number,
  'final_match_summary' AS query_label,
  matched_usat_sanctioned,
  COUNT(*) AS row_count
FROM all_trifind_data_raw
WHERE event_year = 2026
GROUP BY matched_usat_sanctioned;


-- ============================================================
-- Query 7
-- Description: Review fuzzy matching results where matches
-- were made using broader logic such as state/month or state
-- only. Helps validate the name/date pairing quality.
-- ============================================================
SELECT
  7 AS query_number,
  'validate_fuzzy_name_pairings' AS query_label,
  id,
  title,
  usat_match_name,
  state,
  usat_match_state,
  event_date,
  usat_match_date,
  match_method,
  match_score_internal,
  reason_for_sanction
FROM all_trifind_data_raw
WHERE event_year = 2026
  AND match_method IN ('state_month_pm_1', 'state_only')
ORDER BY match_score_internal DESC, id
-- LIMIT 50
;


-- ============================================================
-- Query 8
-- Description: Inspect events that did not match to a USAT
-- sanctioned event to understand why they were excluded.
-- ============================================================
SELECT
  8 AS query_number,
  'unmatched_event_inspection' AS query_label,
  id,
  title,
  state,
  event_date,
  is_usat_sanctioned,
  usat_event_id_number,
  usat_match_name,
  match_method,
  match_score_internal,
  matched_usat_sanctioned,
  reason_for_sanction
FROM all_trifind_data_raw
WHERE event_year = 2026
  AND matched_usat_sanctioned = 0
ORDER BY id
LIMIT 50;
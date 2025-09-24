// C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_participation_event_details_062425.sql

// CREATED MTN AND UTC CREATED AT DATES
async function query_create_mtn_utc_timestamps() {
    return `
        SET @created_at_mtn = (         
            SELECT CASE 
                WHEN UTC_TIMESTAMP() >= DATE_ADD(
                    DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01'),
                        INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01')) + 1) % 7 + 7) DAY),
                    INTERVAL 2 HOUR)
                AND UTC_TIMESTAMP() < DATE_ADD(
                    DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01'),
                        INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01')) + 1) % 7) DAY),
                    INTERVAL 2 HOUR)
                THEN DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -6 HOUR), '%Y-%m-%d %H:%i:%s')
                    ELSE DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -7 HOUR), '%Y-%m-%d %H:%i:%s')
                END
            );

        SET @created_at_utc = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s');

        SELECT @created_at_mtn AS created_at_mtn, @created_at_utc AS created_at_utc;
    `;
}

async function step_8_query_event_vs_participation_match_data(created_at_mtn, created_at_utc) {
    return `
        WITH participant_events AS (
            SELECT
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                id_sanctioning_events,
                GROUP_CONCAT(DISTINCT(start_date_month_races)) AS month_label,
                GROUP_CONCAT(DISTINCT(start_date_races)) AS start_date_races
            FROM participation_race_profiles
            WHERE 1 = 1
                AND start_date_year_races = YEAR(CURDATE())
                -- AND LOWER(name_event_type) IN ('adult race', 'youth race')
            GROUP BY 
                DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), id_sanctioning_events
        ),
            sanctioned_events AS (
                SELECT
                    DATE_FORMAT(created_at_mtn, '%Y-%m-%d') AS created_at_mtn,
                    starts_month_events AS month_label,
                    LEFT(id_sanctioning_events, 6) AS id_sanctioning_short,
                    id_sanctioning_events,
                    name_events,
                    starts_events,
                    starts_month_events,
                    state_code_events
                FROM event_data_metrics
                WHERE 1 = 1
                    AND starts_year_events IN (YEAR(CURDATE()))
                    AND status_events NOT IN ('cancelled', 'declined', 'deleted')
                    -- AND LOWER(name_event_type) IN ('adult race', 'youth race')
                GROUP BY 
                    DATE_FORMAT(created_at_mtn, '%Y-%m-%d'), starts_month_events, id_sanctioning_short, 
                    id_sanctioning_events, name_events, starts_events, starts_month_events, 
                    state_code_events
            ),
            sanctioned_events_with_reported_flag AS ( 
                SELECT   
                    ROW_NUMBER() OVER (ORDER BY s.id_sanctioning_short ASC) AS row_num,  -- row numbering

                    s.id_sanctioning_short                      AS s_id_sanctioning_short,
                    GROUP_CONCAT(s.id_sanctioning_events ORDER BY s.id_sanctioning_events ASC) AS s_id_sanctioning_events,

                    TRIM(BOTH '"' FROM TRIM(BOTH '''' FROM name_events)) AS s_name_events,
                    
                    s.starts_events                AS s_starts_events,
                    s.month_label                  AS s_month_label,
                    s.state_code_events            AS s_state_code_events,

                    p.id_sanctioning_events        AS p_id_sanctioning_events,
                    p.month_label                   AS p_month_label,
                    p.start_date_races             AS p_start_date_races,
                    
                    CASE
                        WHEN p.id_sanctioning_events IS NOT NULL THEN '✅ Reported'
                        ELSE '❌ Not Reported'
                    END AS reported_flag,
                    
                    -- s.created_at_mtn AS s_created_at_mtn,
                    '${created_at_mtn}' AS created_at_mtn,
                    '${created_at_utc}' AS created_at_utc,

                    COUNT(s.id_sanctioning_events) AS count_s_id_sanctioning_events, -- identify those with count > 1 given group concat
                    COUNT(*) OVER () AS row_count   -- ✅ adds row count at the first column 

                FROM sanctioned_events AS s
                    LEFT JOIN participant_events AS p ON p.id_sanctioning_events = s.id_sanctioning_short
                WHERE 1 = 1
                    -- AND s.month_label = 6
                GROUP BY 2, 4, 5, 6, 7, 8, 9, 10, 11, 12
                HAVING 1 = 1 
                    -- AND reported_flag = '❌ Not Reported'
                ORDER BY 1 ASC
            ) 
            SELECT * 
            FROM sanctioned_events_with_reported_flag AS s 
            ORDER BY s.s_month_label, s.s_id_sanctioning_events
        ;
    `;
}

module.exports = {
    step_8_query_event_vs_participation_match_data,
    query_create_mtn_utc_timestamps,
}
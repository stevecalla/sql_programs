// discovery: C:\Users\calla\development\usat\sql_code\8_events\discovery_match_sanction_events_with_sales_data.sql
// C:\Users\calla\development\usat\sql_code\8_events\step_5_get_python_event_data_v070625.sql

function step_5_query_python_event_data(batch_size, offset) {
    return `
        -- ================================================
        -- Step 1: Event data metrics for last two years
        WITH event_metrics_cte AS (
            SELECT
                em.id_sanctioning_events,
                LEFT(em.id_sanctioning_events, 6) AS id_sanctioning_events_6_digits,
                REPLACE(em.name_events, '"', '') AS name_events,
                em.starts_year_events,
                MAX(em.starts_events) AS starts_events,
                MAX(em.start_date_races) AS start_date_races,
                em.status_events,
                em.state_code_events,
                -- em.zip_events,
                LPAD(CAST(em.zip_events AS CHAR), 5, '0') AS zip_events,
                em.name_event_type,
                em.member_number_members AS RaceDirectorUserID,
                em.event_website_url,
                em.registration_url,
                em.email_users,
                em.created_at_events
            FROM event_data_metrics AS em
            WHERE 1=1
                -- TODO: 2024 vs 2025
                AND em.starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1)
                -- TODO: 2025 vs 2026
                -- AND em.starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) + 1)
            GROUP BY
                em.id_sanctioning_events, em.name_events, em.starts_year_events,
                -- em.starts_events, em.start_date_races, 
                em.status_events,
                em.state_code_events, em.zip_events, em.name_event_type,
                em.member_number_members, em.event_website_url,
                em.registration_url, em.email_users, em.created_at_events
            )
            -- SELECT * FROM event_metrics_cte; -- 2709

            -- ================================================
            -- Step 2: Sales data aggregation (by event) for same years
            , sales_data_cte AS (
                SELECT
                    s.id_sanctioning_events,
                    LEFT(s.id_sanctioning_events, 6) AS id_sanctioning_events_6_digits,
                    s.id_sanctioning_events_and_type,
                    REPLACE(s.name_events, '"', '') AS name_events,
                    s.starts_year_events,
                    s.starts_events,
                    s.status_events,
                    s.state_code_events,
                    -- s.zip_events,
                    LPAD(CAST(s.zip_events AS CHAR), 5, '0') AS zip_events,
                    s.name_event_type,
                    s.race_director_id_events,
                    s.created_at_events,
                    COUNT(DISTINCT s.id_membership_periods_sa) AS sales_units,
                    SUM(s.sales_revenue) AS sales_revenue
                FROM sales_key_stats_2015 s
                WHERE 1 = 1
                    -- TODO: 2024 vs 2025
                    AND s.starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1)
                    -- TODO: 2025 vs 2026
                    -- AND s.starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) + 1)
                    AND s.id_sanctioning_events NOT IN (999999) -- exclude test event
                GROUP BY
                    s.id_sanctioning_events,
                    s.id_sanctioning_events_and_type,
                    s.name_events,
                    s.starts_year_events,
                    s.starts_events,
                    s.status_events,
                    s.state_code_events,
                    s.zip_events,
                    s.name_event_type,
                    s.race_director_id_events,
                    s.created_at_events
            )
            -- SELECT * FROM sales_data_cte; -- 2031

            -- ================================================
            -- Step 3: "Orphan" sales (no event match)
            , missing_sales_cte AS (
                SELECT
                    NULL AS id_sanctioning_events,
                    s.name_events AS name_events_or_sales,
                    s.starts_year_events AS starts_year_events,
                    s.starts_events AS starts_events,
                    NULL AS start_date_races,
                    s.status_events AS status_events,
                    s.state_code_events AS state_code_events,
                    -- s.zip_events AS zip_events,
                    LPAD(CAST(s.zip_events AS CHAR), 5, '0') AS zip_events,
                    s.name_event_type AS name_event_type,
                    s.race_director_id_events AS RaceDirectorUserID,
                    NULL AS event_website_url,
                    NULL AS registration_url,
                    NULL AS email_users,
                    s.created_at_events AS created_at_events,
                    s.id_sanctioning_events_and_type AS id_sanctioning_events_and_type,
                    s.sales_units,
                    s.sales_revenue,
                    'from_missing_in_event_data_metrics' AS source
                FROM sales_data_cte s
                    LEFT JOIN event_metrics_cte em ON em.id_sanctioning_events = s.id_sanctioning_events_and_type
                        AND em.starts_year_events = s.starts_year_events
                WHERE em.id_sanctioning_events IS NULL
            )
            -- SELECT * FROM missing_sales_cte; -- 23

            -- ================================================
            -- Step 4: Combine event details + sales data
            , combined_event_sales_data_cte AS (
                SELECT
                    em.id_sanctioning_events AS ApplicationID,
                    TRIM(BOTH '"' FROM em.name_events) AS Name,
                    DATE_FORMAT(em.starts_events, '%Y-%m-%d') AS StartDate,
                    DATE_FORMAT(em.start_date_races, '%Y-%m-%d') AS RaceDate,
                    em.status_events AS Status,
                    em.state_code_events AS 2LetterCode,
                    em.zip_events AS ZipCode,
                    em.name_event_type AS Value,
                    em.RaceDirectorUserID,
                    em.event_website_url AS Website,
                    em.registration_url AS RegistrationWebsite,
                    em.email_users AS Email,
                    DATE_FORMAT(em.created_at_events, '%Y-%m-%d') AS CreatedDate,
                    s.id_sanctioning_events_and_type,
                    s.sales_units,
                    s.sales_revenue,
                    'from_event_data_metrics' AS source
                FROM event_metrics_cte em
                    LEFT JOIN sales_data_cte s ON em.id_sanctioning_events = s.id_sanctioning_events_and_type
                        AND em.starts_year_events = s.starts_year_events

                UNION ALL

                -- Include orphan sales
                SELECT
                    id_sanctioning_events_and_type AS ApplicationID,
                    name_events_or_sales AS Name,
                    DATE_FORMAT(starts_events, '%Y-%m-%d') AS StartDate,
                    NULL AS RaceDate,
                    status_events AS Status,
                    state_code_events AS 2LetterCode,
                    zip_events AS ZipCode,
                    name_event_type AS Value,
                    RaceDirectorUserID,
                    NULL AS Website,
                    NULL AS RegistrationWebsite,
                    NULL AS Email,
                    DATE_FORMAT(created_at_events, '%Y-%m-%d') AS CreatedDate,
                    id_sanctioning_events_and_type,
                    sales_units,
                    sales_revenue,
                    source
                FROM missing_sales_cte
            )

            -- SELECT
            --     YEAR(StartDate),
            --     FORMAT(SUM(sales_units), 0) AS sales_units,
            --     FORMAT(SUM(sales_revenue), 0) AS sales_revenue
            -- FROM combined_event_sales_data_cte
            -- GROUP BY 1
            -- ORDER BY 1

            -- ================================================
            -- Step 5: Final select, ordered for clarity
            SELECT
                ApplicationID,
                Name,
                StartDate,
                RaceDate,
                Status,
                2LetterCode,
                ZipCode,
                Value,
                RaceDirectorUserID,
                Website,
                RegistrationWebsite,
                Email,
                CreatedDate,
                sales_units,
                sales_revenue,
                source
            FROM combined_event_sales_data_cte
            -- WHERE source IN ('from_event_data_metrics')
            ORDER BY source ASC, ApplicationID, StartDate, Name
            LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    step_5_query_python_event_data,
}
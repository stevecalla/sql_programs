// C:\Users\calla\development\usat\sql_code\7_auto_renew\step_4a_discovery_join_to_sales_2023_forward_recursive.sql

function main(is_test, created_at_dates) {
    const limit_start_year = is_test ? 2026 : 2023;
    const limit_ends_mp = is_test ? '2026-01-01': '2023-01-01';
    const { created_at_mtn, created_at_utc } = created_at_dates;

    return `
        -- ============================================================================
        -- RECURSIVE VERSION TO GET MORE YEARS  (Step #2: avoid join explosion by
        -- selecting ONLY the earliest next membership per ended row via TWO LATERALs)
        -- ============================================================================
        
        -- SET @start_year = ${limit_start_year};
        -- SET @ends_mp = ${limit_ends_mp};

        WITH RECURSIVE
        params AS (
        SELECT
            DATE_SUB(CURDATE(), INTERVAL 1 DAY) AS as_of_date,
            -- @start_year AS start_year
            ${limit_start_year} AS start_year
        ),
        years AS (
        SELECT
            p.start_year AS report_year,
            p.as_of_date
        FROM params p
        UNION ALL
        SELECT
            y.report_year + 1,
            y.as_of_date
        FROM years y
        WHERE y.report_year + 1 <= YEAR(y.as_of_date)
        ),
        period_definitions AS (
        SELECT
            report_year,
            'FULL' AS period_type,
            DATE(CONCAT(report_year, '-01-01')) AS period_start,
            DATE(CONCAT(report_year + 1, '-01-01')) AS period_end,
            as_of_date
        FROM years

        UNION ALL

        SELECT
            report_year,
            'YTD' AS period_type,
            DATE(CONCAT(report_year, '-01-01')) AS period_start,
            CASE
            WHEN report_year < YEAR(as_of_date)
                THEN DATE(CONCAT(report_year, '-', DATE_FORMAT(as_of_date, '%m-%d')))
            ELSE as_of_date
            END AS period_end,
            as_of_date
        FROM years
        ),
        ended_periods AS (
        SELECT
            pd.report_year,
            pd.period_type,
            pd.period_start,
            pd.period_end,

            s.id_profiles,
            s.member_number_members_sa,
            s.id_membership_periods_sa,
            s.purchased_on_adjusted_mp,
            s.starts_mp AS original_start,
            s.ends_mp   AS original_end,
            s.real_membership_types_sa,
            s.new_member_category_6_sa,
            s.origin_flag_category,
            s.origin_flag_ma
        FROM period_definitions pd
        JOIN sales_key_stats_2015 s
            ON s.ends_mp >= pd.period_start
        AND s.ends_mp <  pd.period_end
        -- AND s.ends_mp >= @ends_mp
        AND s.ends_mp >= ${limit_ends_mp}
        WHERE 1 = 1
            -- cap only the YTD rows to as_of_date (and do it safely for DATETIME)
            AND (
            pd.period_type <> 'YTD'
            OR s.ends_mp < DATE_ADD((SELECT as_of_date FROM params), INTERVAL 1 DAY)
            )
        ),
        /* Step #2 change: TWO lateral joins, one per renewal window */
        final_rows AS (
        SELECT
            e.report_year,
            e.period_type,
            e.period_start,
            e.period_end,

            e.id_profiles,
            e.member_number_members_sa,

            e.id_membership_periods_sa AS original_id_membership_periods_sa,

            e.purchased_on_adjusted_mp AS original_purchased_on_adjusted_mp,
            DATE_FORMAT(e.purchased_on_adjusted_mp, '%Y-%m-%d') AS original_purchased_on_date_adjusted_mp,
            YEAR(e.purchased_on_adjusted_mp) AS original_purchased_on_year_adjusted_mp,
            MONTH(e.purchased_on_adjusted_mp) AS original_purchased_on_month_adjusted_mp,
            
            e.original_start,
            YEAR(e.original_start) AS original_start_year,
            MONTH(e.original_start) AS original_start_month,

            e.original_end,
            YEAR(e.original_end) AS original_end_year,
            MONTH(e.original_end) AS original_end_month,

            e.real_membership_types_sa AS original_type,
            e.new_member_category_6_sa AS original_category,
            e.origin_flag_category AS original_origin_flag_category,
            e.origin_flag_ma AS original_origin_flag_ma,

            -- =========================================================
            -- LATERAL #1: within 365 days
            -- =========================================================
            n_365.purchased_on_date_mp        AS next_purchased_on_date_mp_365,
            n_365.id_membership_periods_sa    AS next_id_membership_periods_sa_365,
            n_365.starts_mp                   AS next_start_365,
            n_365.ends_mp                     AS next_end_365,
            n_365.real_membership_types_sa    AS next_type_365,
            n_365.new_member_category_6_sa    AS next_category_365,
            n_365.origin_flag_category        AS next_origin_flag_category_365,
            n_365.origin_flag_ma              AS next_origin_flag_ma_365,

            CASE WHEN n_365.starts_mp IS NOT NULL THEN 1 ELSE 0 END AS renewed_flag_365,
            DATEDIFF(n_365.purchased_on_date_mp, e.original_end) AS days_to_renew_365,

            CASE
            WHEN n_365.starts_mp IS NULL THEN 'no_renewal'
            WHEN DATEDIFF(n_365.purchased_on_date_mp, e.original_end) < -30 THEN 'very_early'
            WHEN DATEDIFF(n_365.purchased_on_date_mp, e.original_end) BETWEEN -30 AND -1 THEN 'early'
            WHEN DATEDIFF(n_365.purchased_on_date_mp, e.original_end) = 0 THEN 'on_time'
            WHEN DATEDIFF(n_365.purchased_on_date_mp, e.original_end) BETWEEN 1 AND 30 THEN 'grace_period'
            WHEN DATEDIFF(n_365.purchased_on_date_mp, e.original_end) > 30 THEN 'reacquired'
            END AS renewal_timing_category_365,

            -- =========================================================
            -- LATERAL #2: before 1/31 (Jan 31 inclusive ≈ before Feb 1)
            -- =========================================================
            n_jan31.purchased_on_date_mp      AS next_purchased_on_date_mp_jan31,
            n_jan31.id_membership_periods_sa  AS next_id_membership_periods_sa_jan31,
            n_jan31.starts_mp                 AS next_start_jan31,
            n_jan31.ends_mp                   AS next_end_jan31,
            n_jan31.real_membership_types_sa  AS next_type_jan31,
            n_jan31.new_member_category_6_sa  AS next_category_jan31,
            n_jan31.origin_flag_category      AS next_origin_flag_category_jan31,
            n_jan31.origin_flag_ma            AS next_origin_flag_ma_jan31,

            CASE WHEN n_jan31.starts_mp IS NOT NULL THEN 1 ELSE 0 END AS renewed_flag_jan31,
            DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) AS days_to_renew_jan31,

            CASE
            WHEN n_jan31.starts_mp IS NULL THEN 'no_renewal'
            WHEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) < -30 THEN 'very_early'
            WHEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) BETWEEN -30 AND -1 THEN 'early'
            WHEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) = 0 THEN 'on_time'
            WHEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) BETWEEN 1 AND 30 THEN 'grace_period'
            WHEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end) > 30 THEN 'reacquired'
            END AS renewal_timing_category_jan31,

            -- =========================================================
            -- OPTIONAL: pick a "primary" next membership
            -- Here: prefer jan31-window match, else fall back to 365-day match.
            -- =========================================================
            COALESCE(n_jan31.purchased_on_date_mp,      n_365.purchased_on_date_mp)       AS next_purchased_on_date_mp,
            COALESCE(n_jan31.id_membership_periods_sa,  n_365.id_membership_periods_sa)   AS next_id_membership_periods_sa,
            COALESCE(n_jan31.starts_mp,                 n_365.starts_mp)                  AS next_start,
            COALESCE(n_jan31.ends_mp,                   n_365.ends_mp)                    AS next_end,
            COALESCE(n_jan31.real_membership_types_sa,  n_365.real_membership_types_sa)   AS next_type,
            COALESCE(n_jan31.new_member_category_6_sa,  n_365.new_member_category_6_sa)   AS next_category,
            COALESCE(n_jan31.origin_flag_category,      n_365.origin_flag_category)       AS next_origin_flag_category,
            COALESCE(n_jan31.origin_flag_ma,            n_365.origin_flag_ma)             AS next_origin_flag_ma,

            CASE
            WHEN n_jan31.starts_mp IS NOT NULL THEN 1
            WHEN n_365.starts_mp   IS NOT NULL THEN 1
            ELSE 0
            END AS renewed_flag,

            CASE
            WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
            WHEN n_365.starts_mp   IS NOT NULL THEN DATEDIFF(n_365.purchased_on_date_mp,   e.original_end)
            ELSE NULL
            END AS days_to_renew,

            CASE
            WHEN COALESCE(n_jan31.starts_mp, n_365.starts_mp) IS NULL THEN 'no_renewal'
            WHEN (
                CASE
                WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
                ELSE DATEDIFF(n_365.purchased_on_date_mp, e.original_end)
                END
            ) < -30 THEN 'very_early'
            WHEN (
                CASE
                WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
                ELSE DATEDIFF(n_365.purchased_on_date_mp, e.original_end)
                END
            ) BETWEEN -30 AND -1 THEN 'early'
            WHEN (
                CASE
                WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
                ELSE DATEDIFF(n_365.purchased_on_date_mp, e.original_end)
                END
            ) = 0 THEN 'on_time'
            WHEN (
                CASE
                WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
                ELSE DATEDIFF(n_365.purchased_on_date_mp, e.original_end)
                END
            ) BETWEEN 1 AND 30 THEN 'grace_period'
            WHEN (
                CASE
                WHEN n_jan31.starts_mp IS NOT NULL THEN DATEDIFF(n_jan31.purchased_on_date_mp, e.original_end)
                ELSE DATEDIFF(n_365.purchased_on_date_mp, e.original_end)
                END
            ) > 30 THEN 'reacquired'
            END AS renewal_timing_category,

            ROW_NUMBER() OVER (
            PARTITION BY e.report_year, e.period_type, e.id_profiles
            ORDER BY e.original_end, e.original_start, e.original_purchased_on_adjusted_mp, e.original_id_membership_periods_sa
            ) AS original_seq

        FROM (
            SELECT
            e.*,
            e.purchased_on_adjusted_mp AS original_purchased_on_adjusted_mp,
            e.id_membership_periods_sa AS original_id_membership_periods_sa
            FROM ended_periods e
        ) e

        -- -----------------------------
        -- LATERAL #1: 365-day window
        -- -----------------------------
        LEFT JOIN LATERAL (
            SELECT

            s.purchased_on_date_mp,
            s.id_membership_periods_sa,
            s.starts_mp,
            s.ends_mp,
            s.real_membership_types_sa,
            s.new_member_category_6_sa,
            s.origin_flag_category,
            s.origin_flag_ma

            FROM sales_key_stats_2015 s
            WHERE s.id_profiles = e.id_profiles
            AND s.starts_mp > e.original_end
            AND s.starts_mp <= DATE_ADD(e.original_end, INTERVAL 365 DAY)
            ORDER BY
            s.starts_mp,
            s.purchased_on_date_mp,
            s.id_membership_periods_sa
            LIMIT 1
        ) n_365 ON TRUE

        -- -----------------------------
        -- LATERAL #2: before Jan 31 cutoff
        -- (i.e., starts < Feb 1 of next year)
        -- -----------------------------
        LEFT JOIN LATERAL (
            SELECT
            s.purchased_on_date_mp,
            s.id_membership_periods_sa,
            s.starts_mp,
            s.ends_mp,
            s.real_membership_types_sa,
            s.new_member_category_6_sa,
            s.origin_flag_category,
            s.origin_flag_ma
            FROM sales_key_stats_2015 s
            WHERE s.id_profiles = e.id_profiles
            AND s.starts_mp > e.original_end
            AND s.starts_mp < DATE_ADD(DATE(CONCAT(YEAR(e.original_end) + 1, '-01-01')), INTERVAL 31 DAY)
            ORDER BY
            s.starts_mp,
            s.purchased_on_date_mp,
            s.id_membership_periods_sa
            LIMIT 1
        ) n_jan31 ON TRUE
        ),
        summary_by_dims AS (
        SELECT
            'SUMMARY — renewal rates (FULL + YTD)' AS query_label,
            report_year,
            period_type,
            period_start,
            period_end,

            original_type,
            original_category,
            original_origin_flag_category,
            original_origin_flag_ma,

            COUNT(*) AS ended_row_count,

            -- primary (coalesced) renewal stats
            SUM(renewed_flag) AS did_renew_row_count,
            (COUNT(*) - SUM(renewed_flag)) AS did_not_renew_count,
            (COUNT(*) - SUM(renewed_flag)) / COUNT(*) AS did_not_renew_rate,
            SUM(renewed_flag) / COUNT(*) AS did_renew_rate,

            -- 365-window renewal stats
            SUM(renewed_flag_365) AS did_renew_row_count_365,
            (COUNT(*) - SUM(renewed_flag_365)) AS did_not_renew_count_365,
            (COUNT(*) - SUM(renewed_flag_365)) / COUNT(*) AS did_not_renew_rate_365,
            SUM(renewed_flag_365) / COUNT(*) AS did_renew_rate_365,

            -- jan31-window renewal stats
            SUM(renewed_flag_jan31) AS did_renew_row_count_jan31,
            (COUNT(*) - SUM(renewed_flag_jan31)) AS did_not_renew_count_jan31,
            (COUNT(*) - SUM(renewed_flag_jan31)) / COUNT(*) AS did_not_renew_rate_jan31,
            SUM(renewed_flag_jan31) / COUNT(*) AS did_renew_rate_jan31

        FROM final_rows
        GROUP BY
            report_year,
            period_type,
            period_start,
            period_end,
            original_type,
            original_category,
            original_origin_flag_category,
            original_origin_flag_ma
        ),
        summary_rollup AS (
        SELECT
            'ROLLUP — overall renewal rate by year/period' AS query_label,
            report_year,
            period_type,
            period_start,
            period_end,

            COUNT(*) AS ended_row_count,

            -- primary (coalesced)
            SUM(renewed_flag) AS did_renew_count,
            (COUNT(*) - SUM(renewed_flag)) AS did_not_renew_count,
            (COUNT(*) - SUM(renewed_flag)) / COUNT(*) AS did_not_renew_rate,
            SUM(renewed_flag) / COUNT(*) AS did_renew_rate,

            -- 365-window
            SUM(renewed_flag_365) AS did_renew_count_365,
            (COUNT(*) - SUM(renewed_flag_365)) AS did_not_renew_count_365,
            (COUNT(*) - SUM(renewed_flag_365)) / COUNT(*) AS did_not_renew_rate_365,
            SUM(renewed_flag_365) / COUNT(*) AS did_renew_rate_365,

            -- jan31-window
            SUM(renewed_flag_jan31) AS did_renew_count_jan31,
            (COUNT(*) - SUM(renewed_flag_jan31)) AS did_not_renew_count_jan31,
            (COUNT(*) - SUM(renewed_flag_jan31)) / COUNT(*) AS did_not_renew_rate_jan31,
            SUM(renewed_flag_jan31) / COUNT(*) AS did_renew_rate_jan31

        FROM final_rows
        GROUP BY
            report_year,
            period_type,
            period_start,
            period_end
        ),
        /* most granular detail + the matching dim-level counts/rates */
        /* CHANGED: atomic detail with prior summary field names (safe to SUM / AVG) */
        detail_granular_atomic AS (
        SELECT
            'DETAIL — atomic membership rows (safe to SUM/AVG)' AS query_label,

            fr.*,

            -- atomic counts using the SAME field names as summary_by_dims (PRIMARY)
            1 AS ended_row_count,
            fr.renewed_flag AS did_renew_row_count,
            1 - fr.renewed_flag AS did_not_renew_count,

            -- atomic “rates” (0/1). These are safe to AVG to get the true rate.
            fr.renewed_flag AS did_renew_rate,
            1 - fr.renewed_flag AS did_not_renew_rate,

            -- atomic counts/rates for 365 window
            fr.renewed_flag_365 AS did_renew_row_count_365,
            1 - fr.renewed_flag_365 AS did_not_renew_count_365,
            fr.renewed_flag_365 AS did_renew_rate_365,
            1 - fr.renewed_flag_365 AS did_not_renew_rate_365,

            -- atomic counts/rates for jan31 window
            fr.renewed_flag_jan31 AS did_renew_row_count_jan31,
            1 - fr.renewed_flag_jan31 AS did_not_renew_count_jan31,
            fr.renewed_flag_jan31 AS did_renew_rate_jan31,
            1 - fr.renewed_flag_jan31 AS did_not_renew_rate_jan31

        FROM final_rows fr
        )
        -- ------------------------------------------------------------
        -- sanity checks (optional)
        -- ------------------------------------------------------------
        -- SELECT
        --   (SELECT COUNT(*) FROM ended_periods) AS ended_cnt,
        --   (SELECT COUNT(*) FROM final_rows) AS final_cnt,
        --   (SELECT SUM(ended_row_count) FROM summary_by_dims) AS summary_by_dims,
        --   (SELECT SUM(ended_row_count) FROM summary_rollup) AS summary_rollup,
        --   (SELECT SUM(ended_row_count) FROM detail_granular_atomic) AS detail_granular_atomic,
        --   (SELECT COUNT(*) FROM detail_granular_atomic) AS detail_granular_cnt;

        -- ------------------------------------------------------------
        -- 1) detailed breakdown (dims)
        -- ------------------------------------------------------------
        -- SELECT *
        -- FROM summary_by_dims
        -- ORDER BY
        --   period_type,
        --   report_year,
        --   original_type,
        --   original_category;

        -- ------------------------------------------------------------
        -- 2) rollup totals
        -- ------------------------------------------------------------
        -- SELECT *
        -- FROM summary_rollup
        -- ORDER BY
        --   report_year,
        --   period_type;

        -- ------------------------------------------------------------
        -- 3) most granular detail + dim-level counts
        -- ------------------------------------------------------------
        SELECT 
            d.*,
            
            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM detail_granular_atomic AS d
        ORDER BY
            period_type,
            report_year,
            original_type,
            original_category,
            original_origin_flag_category,
            original_origin_flag_ma,
            id_profiles,
            original_end
        ;
    `;
}

module.exports = {
    step_4a_get_generic_sales_renewal_data: main,
}
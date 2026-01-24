// C:\Users\calla\development\usat\sql_code\19_membership_base\discovery_base_membership_012226.sql

const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../../utilities/date_time_tools/get_mountain_time_offset_hours.js");

function main(is_test) {
    const limit_where_statement = is_test ? "LIMIT 100" : "";

    // Batch timestamps (UTC → MTN via offset fn)
    const now_utc = new Date();
    const mtn_offset_hours = get_mountain_time_offset_hours(now_utc);
    const now_mtn = new Date(now_utc.getTime() + mtn_offset_hours * 60 * 60 * 1000);

    // IMPORTANT: strings for MySQL DATETIME columns
    const created_at_utc = to_mysql_datetime(now_utc);
    const created_at_mtn = to_mysql_datetime(now_mtn);

    return `
        -- QUERY #1 — SUMMARY (stable counts)
        -- Query 1 = aggregated summary rows (one row per year + membership_type + new_member_category)
        -- How to read it:
        -- unique_profiles = distinct profiles who “best map” into that bucket for that year
        -- unique_profiles_sales_ytd = distinct profiles in the same bucket whose purchased_on_adjusted_mp is within the YTD window for that year (same day-of-year cutoff)
        -- Within a given year, a profile can only appear in one membership type and one category in your counts. But yes, the same profile can appear in multiple years.
        -- If someone has a membership spanning multiple years:
        -- 2024 → profile counted once
        -- 2025 → counted once (possibly with a different type/category)
        -- 2026 → counted once
        -- That’s intentional and correct.
        -- If you ever want to prove this to yourself:
        -- SELECT
        --   year,
        --   id_profiles,
        --   COUNT(*) AS rows_per_profile_year
        -- FROM best_memberships
        -- GROUP BY year, id_profiles
        -- HAVING COUNT(*) > 1;

        WITH ytd_params AS (
            SELECT
                CURDATE() AS ytd_as_of_run_date,
                DAYOFYEAR(CURDATE()) AS ytd_as_of_day_of_year
        ),
        years AS (	
            SELECT 2015 AS y UNION ALL SELECT 2016 UNION ALL SELECT 2017 UNION ALL	
            SELECT 2018 UNION ALL SELECT 2019 UNION ALL SELECT 2020 UNION ALL	
            SELECT 2021 UNION ALL SELECT 2022 UNION ALL SELECT 2023 UNION ALL 
            SELECT 2024 UNION ALL SELECT 2025 UNION ALL
            SELECT 2026
        ),
        exploded_years AS (	
            SELECT	
                s.id_profiles,
                s.real_membership_types_sa,
                s.new_member_category_6_sa,
                s.ends_mp,
                s.purchased_on_adjusted_mp,
                y.y AS year
            FROM sales_key_stats_2015 s	
            JOIN years y ON y.y BETWEEN s.starts_year_mp AND s.ends_year_mp	
            ${limit_where_statement}
        ),
        membership_counts_by_profile_year AS (	
            SELECT
                year,
                id_profiles,
                COUNT(*) AS total_memberships_for_year
            FROM exploded_years
            GROUP BY year, id_profiles
        ),
        ranked_memberships AS (	
            SELECT
                e.*,
                ROW_NUMBER() OVER (
                    PARTITION BY e.year, e.id_profiles
                    ORDER BY
                        CASE
                            WHEN e.real_membership_types_sa = 'adult_annual' THEN 1
                            WHEN e.real_membership_types_sa = 'youth_annual' THEN 2
                            WHEN e.real_membership_types_sa = 'one_day' THEN 3
                            WHEN e.real_membership_types_sa = 'elite' THEN 4
                            ELSE 5
                        END,
                        e.ends_mp ASC,
                        e.purchased_on_adjusted_mp ASC
                        -- add unique key here if available to fully break ties
                ) AS membership_type_priority
            FROM exploded_years e
        ),
        best_memberships AS (	
            SELECT
                rm.*,
                mc.total_memberships_for_year
            FROM ranked_memberships rm
            JOIN membership_counts_by_profile_year mc
            ON rm.year = mc.year AND rm.id_profiles = mc.id_profiles
            WHERE rm.membership_type_priority = 1
        )
        SELECT
            bm.year,
            bm.real_membership_types_sa AS membership_type,
            bm.new_member_category_6_sa AS new_member_category,
            COUNT(DISTINCT bm.id_profiles) AS unique_profiles,
            SUM(bm.total_memberships_for_year) AS total_memberships_all_profiles_that_year,

            COUNT(DISTINCT CASE
                WHEN bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                AND bm.purchased_on_adjusted_mp <
                    DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN bm.id_profiles
            END) AS unique_profiles_sales_ytd,

            SUM(CASE
                WHEN bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                AND bm.purchased_on_adjusted_mp <
                    DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN bm.total_memberships_for_year
                ELSE 0
            END) AS total_memberships_all_profiles_sales_ytd,

            -- WRAPPED IN MAX TO AVOID EXPANDING GROUP BY
            MAX(p.ytd_as_of_run_date)   AS ytd_as_of_run_date,
            MAX(p.ytd_as_of_day_of_year) AS ytd_as_of_day_of_year,

            -- CREATED AT DATES
            MAX('${created_at_mtn}') AS created_at_mtn,
            MAX('${created_at_utc}') AS created_at_utc

        FROM best_memberships bm
        CROSS JOIN ytd_params p
        GROUP BY bm.year, bm.real_membership_types_sa, bm.new_member_category_6_sa
        ORDER BY bm.year, bm.real_membership_types_sa, bm.new_member_category_6_sa
    ;
    `;
}

module.exports = {
    step_1_query_membership_base_data: main,
}
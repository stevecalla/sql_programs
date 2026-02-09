// C:\Users\calla\development\usat\sql_code\19_membership_base\discovery_base_membership_012226_detail_v2.sql

const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../../utilities/date_time_tools/get_mountain_time_offset_hours.js");

function main(is_test, created_at_dates) {
    const limit_where_statement = is_test ? "LIMIT 100" : "";
    const { created_at_mtn, created_at_utc } = created_at_dates;

    return `
        -- QUERY #2 — DETAIL (drill-down, same YTD logic)
        -- Query 2 = detail rows (one row per year + id_profiles after your “best membership per year” logic
        -- How to read it: This is your “reviewable” dataset.
        -- is_sales_ytd = 1 means that row’s purchase date falls within the “same day-of-year” YTD window for that year.
        -- You can pivot this in Excel/Power BI however you want (by state, age bin, region, upgrade flag, etc.)
        -- If you filter Query 2 to:
        -- year=2025, membership_type=adult_annual, new_member_category=Renew
        -- …and then count distinct id_profiles, you should match Query 1’s unique_profiles for that same bucket (modulo any additional filters you applied in Query 2).

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
                s.member_number_members_sa,

                s.purchased_on_adjusted_mp,
                s.purchased_on_year_adjusted_mp,
                s.purchased_on_quarter_adjusted_mp,
                s.purchased_on_month_adjusted_mp,

                s.starts_mp,
                s.starts_year_mp,
                s.starts__quarter_mp,
                s.starts_month_mp,

                s.ends_mp,
                s.ends_year_mp,
                s.ends_quarter_mp,
                s.ends_month_mp,

                s.real_membership_types_sa,	
                s.new_member_category_6_sa,	

                s.member_min_created_at_year,
                s.member_lapsed_renew_category,
                s.member_created_at_category,

                s.most_recent_prior_purchase_membership_type,
                s.most_recent_prior_purchase_membership_category,

                s.member_first_purchase_year_category,
                s.member_first_purchase_years_out,
                s.member_first_purchase_year,
                
                s.member_lifetime_frequency,
                s.member_lifetime_purchases,

                s.member_upgrade_downgrade_category,
                s.member_upgrade_downgrade_major,

                s.age_at_end_of_year,
                s.age_as_year_end_bin,
                s.date_of_birth_year_mp,

                s.member_state_code_addresses,
                s.region_name_member,

                s.gender_id_profiles,
                s.gender_profiles,

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
        -- todo: 02/09/26
        purchase_dates_by_profile_year AS (
            SELECT
                year,
                id_profiles,

                -- Earliest purchase among ALL memberships that map into this profile-year
                MIN(purchased_on_adjusted_mp) AS first_purchase_any_for_year,

                -- Earliest purchase that occurred within the calendar year (for YTD)
                MIN(CASE
                    WHEN purchased_on_adjusted_mp >= MAKEDATE(year, 1)
                    AND purchased_on_adjusted_mp <  MAKEDATE(year + 1, 1)
                    THEN purchased_on_adjusted_mp
                    END) AS first_purchase_in_year

            FROM exploded_years
            GROUP BY year, id_profiles
        ),
        ranked_memberships AS (	
            SELECT	
                e.*,
                ROW_NUMBER() OVER (
                    PARTITION BY year, id_profiles	
                    ORDER BY	
                        CASE	
                            WHEN real_membership_types_sa = 'adult_annual' THEN 1	
                            WHEN real_membership_types_sa = 'youth_annual' THEN 2	
                            WHEN real_membership_types_sa = 'one_day' THEN 3	
                            WHEN real_membership_types_sa = 'elite' THEN 4	
                            ELSE 5	
                        END,	
                        ends_mp DESC,
                        purchased_on_adjusted_mp DESC
                ) AS membership_type_priority	
            FROM exploded_years e	
        ),
        -- best_memberships AS (	
        --     SELECT 	
        --         rm.*, 	
        --         mc.total_memberships_for_year	
        --     FROM ranked_memberships rm	
        --     JOIN membership_counts_by_profile_year mc	
        --     ON rm.year = mc.year AND rm.id_profiles = mc.id_profiles	
        --     WHERE rm.membership_type_priority = 1	
        -- )
        best_memberships AS (
            SELECT
                rm.*,
                mc.total_memberships_for_year,
                pd.first_purchase_any_for_year,
                pd.first_purchase_in_year
            FROM ranked_memberships rm
            JOIN membership_counts_by_profile_year mc
                ON rm.year = mc.year AND rm.id_profiles = mc.id_profiles
            JOIN purchase_dates_by_profile_year pd
                ON rm.year = pd.year AND rm.id_profiles = pd.id_profiles
            WHERE rm.membership_type_priority = 1
        )

        /* ------------------------------------------------------------
        Final DETAIL output
        ------------------------------------------------------------ */
        SELECT
            bm.*,

            /* per-row contribution to Query #1:
            SUM(total_memberships_all_profiles_that_year) */
            bm.total_memberships_for_year AS total_memberships_all_profiles_that_year,

            -- Distinct profiles whose membership purchase date occurred before the same day-of-year cutoff, regardless of calendar year.
            /* same YTD logic as Query #1 */
            CASE
                WHEN 1 = 1
                    -- AND bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                    -- AND bm.purchased_on_adjusted_mp < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)

                    -- todo: 02/09/26
                    AND bm.first_purchase_any_for_year < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN 1 ELSE 0
            END AS is_sales_through_day_of_year,

            /* per-row contribution to Query #1:
            SUM(total_memberships_all_profiles_sales_ytd) */
            CASE
                WHEN 1 = 1
                    -- AND bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                    -- AND bm.purchased_on_adjusted_mp < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)

                    -- todo: 02/09/26
                    AND bm.first_purchase_any_for_year < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN bm.total_memberships_for_year
                ELSE 0
            END AS total_memberships_all_profiles_sales_through_day_of_year,

            -- Distinct profiles whose membership purchase date falls between January 1 and the same day-of-year cutoff within that year.
            -- “sales_through_doy applies only a day-of-year cutoff, while sales_ytd applies both a calendar-year boundary and the same day-of-year cutoff.”
            /* same YTD logic as Query #1 */
            CASE
                WHEN 1 = 1
                    AND bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                    AND bm.purchased_on_adjusted_mp < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)

                    -- todo: 02/09/26
                    -- AND bm.first_purchase_in_year >= MAKEDATE(bm.year, 1)
                    -- AND bm.first_purchase_in_year <  DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN 1 ELSE 0
            END AS is_sales_ytd,

            /* per-row contribution to Query #1:
            SUM(total_memberships_all_profiles_sales_ytd) */
            CASE
                WHEN 1 = 1
                    AND bm.purchased_on_adjusted_mp >= MAKEDATE(bm.year, 1)
                    AND bm.purchased_on_adjusted_mp < DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)

                    -- todo: 02/09/26
                    -- AND bm.first_purchase_in_year >= MAKEDATE(bm.year, 1)
                    -- AND bm.first_purchase_in_year <  DATE_ADD(MAKEDATE(bm.year, 1), INTERVAL p.ytd_as_of_day_of_year DAY)
                THEN bm.total_memberships_for_year
                ELSE 0
            END AS total_memberships_all_profiles_sales_ytd,

            p.ytd_as_of_run_date,
            p.ytd_as_of_day_of_year,
            
            -- CREATED AT DATES
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM best_memberships bm
            CROSS JOIN ytd_params p
        ORDER BY
            bm.year,
            bm.real_membership_types_sa,
            bm.new_member_category_6_sa,
            bm.id_profiles
        ;
    `;
}

module.exports = {
    step_2_query_membership_detail_data: main,
}
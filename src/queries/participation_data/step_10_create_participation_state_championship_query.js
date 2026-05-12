// C:\Users\calla\development\usat\sql_programs\src\queries\participation_data\step_3_create_participation_with_membership_match.js

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

// SOURCE C:\Users\calla\development\usat\sql_code\32_national_rankings\discovery_state_champ_051126_v2_with_membership_with_natl_ranking.sql
function query_step_10_create_participation_rankings_table(table_name, created_at_mtn, created_at_utc) {
    return `
        CREATE TABLE ${table_name} AS

        WITH filtered_results AS (
            SELECT
                -- PROFILE / USER
                p.id AS id_profiles,
                DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth_profiles,
                p.deleted_at AS deleted_at_profiles,
                p.name AS full_name_profiles,
                p.first_name AS first_name_profiles,
                p.last_name AS last_name_profiles,
                u.email AS email_users,
                u.deleted_at AS deleted_at_users,

                -- GENDER
                g.short AS flag_genders,
                g.label AS label_genders,

                -- LOCATION
                st.name AS state_profile_states,

                -- EVENT / RACE
                e.id AS id_events,
                e.starts AS starts_events,
                e.name AS name_events,
                e.state_name AS state_name_events,
                e.event_type_id AS event_type_id_events,
                e.sanctioning_event_id AS sanctioning_event_id_events,
                e.deleted_at AS deleted_at_events,
                r.designation AS designation_races,
                r.deleted_at AS deleted_at_races,
                rt.name AS name_race_types,
                dt.name AS name_distance_types,

                -- RACE RESULT
                rr.id AS id_race_results,
                rr.created_at AS created_at_race_results,
                rr.finish_status AS finish_status_race_results,
                rr.category AS category_race_results,
                rr.first_name AS first_name_race_results,
                rr.last_name AS last_name_race_results,
                rr.age AS age_race_results,
                rr.gender_code AS gender_code_race_results,
                rr.milliseconds AS milliseconds_race_results,
                SEC_TO_TIME(FLOOR(rr.milliseconds / 1000)) AS formatted_time_race_results

            FROM race_results AS rr
                LEFT JOIN profiles AS p ON rr.profile_id = p.id
                INNER JOIN races AS r ON rr.race_id = r.id
                INNER JOIN events AS e ON r.event_id = e.id
                INNER JOIN race_types AS rt ON r.race_type_id = rt.id
                INNER JOIN distance_types AS dt ON r.distance_type_id = dt.id
                LEFT JOIN users AS u ON p.user_id = u.id
                LEFT JOIN genders AS g ON p.gender_id = g.id
                INNER JOIN addresses AS ad ON p.primary_address_id = ad.id
                INNER JOIN states AS st ON ad.state_id = st.id

            WHERE 1 = 1
                AND r.designation = 'Adult Race'
                AND e.event_type_id = 1
                AND rr.created_at >= '2023-07-25 00:00:00'
                AND rr.finish_status NOT IN ('DNF', 'DNS', 'DQ')
                AND e.deleted_at IS NULL
                AND r.deleted_at IS NULL
                AND u.deleted_at IS NULL
                AND p.deleted_at IS NULL
                AND rt.name IN ('Triathlon', 'Triathlon Off-Road')
                AND rr.category <> 'ELITE'
                AND p.date_of_birth >= '1900-01-01'
                AND rr.id <> 5454368
                AND e.starts > '2025-12-31'
                AND e.starts < '2027-01-01'
                AND st.name IN ('Florida', 'Massachusetts')
                AND e.state_name IN ('Florida', 'Massachusetts')
                AND e.state_name = st.name
        ),

        membership_period_results AS (
            SELECT
                ma.profile_id AS id_profiles_ma,

                GROUP_CONCAT(mp.id ORDER BY mp.starts SEPARATOR ' | ') AS ids_membership_periods,
                GROUP_CONCAT(mp.membership_type_id ORDER BY mp.starts SEPARATOR ' | ') AS ids_membership_type_membership_periods,
                GROUP_CONCAT(mt.name ORDER BY mp.starts SEPARATOR ' | ') AS names_membership_types,
                GROUP_CONCAT(mp.starts ORDER BY mp.starts SEPARATOR ' | ') AS starts_membership_periods,
                GROUP_CONCAT(mp.ends ORDER BY mp.starts SEPARATOR ' | ') AS ends_membership_periods,
                GROUP_CONCAT(mt.group ORDER BY mp.starts SEPARATOR ' | ') AS groups_membership_types,

                COUNT(mp.id) AS count_membership_periods

            FROM membership_periods AS mp
                LEFT JOIN membership_types AS mt ON mp.membership_type_id = mt.id
                LEFT JOIN membership_applications AS ma ON ma.membership_period_id = mp.id

            WHERE 1 = 1
                AND mp.deleted_at IS NULL
                AND (
                    (
                        mp.starts < DATE_ADD(MAKEDATE(YEAR(CURDATE()), 1), INTERVAL 1 YEAR)
                        AND mp.ends >= MAKEDATE(YEAR(CURDATE()), 1)
                    )
                    OR (
                        mp.starts >= DATE_ADD(MAKEDATE(YEAR(CURDATE()), 1), INTERVAL 1 YEAR)
                        AND mp.ends >= DATE_ADD(MAKEDATE(YEAR(CURDATE()), 1), INTERVAL 1 YEAR)
                    )
                )

            GROUP BY ma.profile_id
        ),

        ranking_base AS (
            SELECT
                p.id AS id_profiles,
                p.date_of_birth AS date_of_birth_profiles,
                p.is_us_citizen AS is_us_citizen_profiles,
                p.deleted_at AS deleted_at_profiles,

                u.email AS email_users,
                u.deleted_at AS deleted_at_users,

                m.memberable_type AS memberable_type_members,
                m.deleted_at AS deleted_at_members,

                g.label AS label_genders,

                ad.address AS address_member_addresses,
                ad.city AS city_member_addresses,
                ad.postal_code AS postal_code_member_addresses,

                st.name AS name_member_states,
                st.code AS code_member_states,
                st.country_code AS country_code_member_states,

                rlp.ranked_at AS ranked_at_ranking_list_periods,
                rl.id AS id_ranking_lists,

                ag.min AS min_age_groups,
                ag.max AS max_age_groups,
                rt.name AS name_race_types,
                rs.name AS name_ranking_series,

                rlpe.id AS id_ranking_list_period_entries,
                rlpe.member_number AS member_number_ranking_list_period_entries,
                rlpe.first_name AS first_name_ranking_list_period_entries,
                rlpe.last_name AS last_name_ranking_list_period_entries,
                rlpe.rank AS rank_ranking_list_period_entries,
                rlpe.score AS score_ranking_list_period_entries,
                rlpe.multiplier_score AS multiplier_score_ranking_list_period_entries,
                rlpe.all_american AS all_american_ranking_list_period_entries

            FROM ranking_list_period_entries AS rlpe
                INNER JOIN ranking_list_periods AS rlp ON rlpe.ranking_list_period_id = rlp.id
                INNER JOIN profiles AS p ON rlpe.profile_id = p.id
                INNER JOIN genders AS g ON p.gender_id = g.id
                INNER JOIN users AS u ON p.user_id = u.id
                LEFT JOIN addresses AS ad ON p.primary_address_id = ad.id
                INNER JOIN members AS m ON p.id = m.memberable_id
                LEFT JOIN states AS st ON ad.state_id = st.id
                INNER JOIN ranking_lists AS rl ON rlp.ranking_list_id = rl.id
                INNER JOIN ranking_configs AS rc ON rl.ranking_config_id = rc.id
                INNER JOIN age_groups AS ag ON rc.age_group_id = ag.id
                INNER JOIN race_types AS rt ON rc.race_type_id = rt.id
                INNER JOIN ranking_series AS rs ON rc.ranking_series_id = rs.id

            WHERE 1 = 1
                AND m.deleted_at IS NULL
                AND u.deleted_at IS NULL
                AND p.deleted_at IS NULL
                AND m.memberable_type = 'profiles'
                AND rs.name = 'National Rankings'
                AND rlp.ranked_at = '2026-12-31'
                AND st.code IN ('FL', 'MA')
                AND rt.name IN ('Triathlon', 'Triathlon Off-Road')
        ),

        ranking_results AS (
            SELECT
                id_profiles,

                ranked_at_ranking_list_periods,
                id_ranking_lists,

                min_age_groups,
                max_age_groups,
                CONCAT(min_age_groups, '-', max_age_groups) AS ranked_age_bin,
                name_race_types,
                name_ranking_series,

                id_ranking_list_period_entries,
                member_number_ranking_list_period_entries,
                first_name_ranking_list_period_entries,
                last_name_ranking_list_period_entries,
                rank_ranking_list_period_entries,
                score_ranking_list_period_entries,
                multiplier_score_ranking_list_period_entries,
                all_american_ranking_list_period_entries

            FROM ranking_base

            GROUP BY 
                id_profiles,
                name_race_types
        )

        SELECT 
            fr.id_profiles,
            fr.full_name_profiles,
            fr.last_name_profiles,
            fr.first_name_profiles,
            fr.date_of_birth_profiles,
            fr.email_users,

            fr.gender_code_race_results, -- new

            -- membership periods
            mpr.ids_membership_periods,
            mpr.ids_membership_type_membership_periods,
            mpr.names_membership_types,
            mpr.starts_membership_periods,
            mpr.ends_membership_periods,
            mpr.groups_membership_types,
            mpr.count_membership_periods,

            -- events
            GROUP_CONCAT(fr.id_events ORDER BY fr.starts_events SEPARATOR ' | ') AS ids_events,
            GROUP_CONCAT(fr.starts_events ORDER BY fr.starts_events SEPARATOR ' | ') AS starts_events,
            GROUP_CONCAT(fr.name_events ORDER BY fr.starts_events SEPARATOR ' | ') AS names_events,

            -- race results
            GROUP_CONCAT(fr.age_race_results ORDER BY fr.starts_events SEPARATOR ' | ') AS age_race_results,
            GROUP_CONCAT(fr.designation_races ORDER BY fr.starts_events SEPARATOR ' | ') AS designations_races,
            GROUP_CONCAT(fr.name_distance_types ORDER BY fr.starts_events SEPARATOR ' | ') AS names_distance_types,
            GROUP_CONCAT(fr.name_race_types ORDER BY fr.starts_events SEPARATOR ' | ') AS names_race_types,
            GROUP_CONCAT(fr.id_race_results ORDER BY fr.starts_events SEPARATOR ' | ') AS ids_race_results,
        
            -- NEW:
            GROUP_CONCAT(fr.milliseconds_race_results ORDER BY fr.starts_events SEPARATOR ' | ') AS milliseconds_race_results,
            GROUP_CONCAT(fr.formatted_time_race_results ORDER BY fr.starts_events SEPARATOR ' | ') AS formatted_time_race_results,

            COUNT(DISTINCT fr.id_profiles) AS count_distinct_profiles,
            COUNT(fr.id_race_results) AS count_total_race_results,

            -- ranking period / list
            rrnk.ranked_at_ranking_list_periods,
            rrnk.id_ranking_lists,

            -- ranking config
            rrnk.min_age_groups,
            rrnk.max_age_groups,
            rrnk.ranked_age_bin,
            rrnk.name_race_types AS ranked_name_race_types,
            rrnk.name_ranking_series,

            -- ranking entry
            rrnk.id_ranking_list_period_entries,
            rrnk.member_number_ranking_list_period_entries,
            rrnk.first_name_ranking_list_period_entries,
            rrnk.last_name_ranking_list_period_entries,
            rrnk.rank_ranking_list_period_entries,
            rrnk.score_ranking_list_period_entries,
            rrnk.multiplier_score_ranking_list_period_entries,
            rrnk.all_american_ranking_list_period_entries,

            -- created at dates
            '${created_at_mtn}' AS created_at_mtn,
            '${created_at_utc}' AS created_at_utc

        FROM filtered_results AS fr
            LEFT JOIN membership_period_results AS mpr 
                ON fr.id_profiles = mpr.id_profiles_ma
            LEFT JOIN ranking_results AS rrnk 
                ON fr.id_profiles = rrnk.id_profiles
                AND fr.name_race_types = rrnk.name_race_types

        GROUP BY
            fr.id_profiles,
            fr.name_race_types,
            rrnk.name_race_types

        ORDER BY fr.id_profiles ASC
        ;
`;
}

module.exports = {
    query_create_mtn_utc_timestamps,
    query_step_10_create_participation_rankings_table,
}
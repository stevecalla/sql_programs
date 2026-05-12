async function main(batch_size = 10000, offset = 0) {
    return `
        SELECT 
            -- profile
            id_profiles,
            full_name_profiles,
            last_name_profiles,
            first_name_profiles,

            DATE_FORMAT(date_of_birth_profiles, '%Y-%m-%d') AS date_of_birth_profiles,
            
            email_users,

            -- membership periods
            ids_membership_periods,
            ids_membership_type_membership_periods,
            names_membership_types,

            starts_membership_periods, -- date but type varchar b/c it might include multiple
            ends_membership_periods, -- date but type varchar b/c it might include multiple

            groups_membership_types,
            count_membership_periods,

            -- events
            ids_events,
            starts_events, -- date but type varchar b/c it might include multiple
            names_events,

            -- race results
            age_race_results,
            designations_races,
            names_distance_types,
            names_race_types,
            ids_race_results,

            count_distinct_profiles,
            count_total_race_results,

            -- ranking period / list
            DATE_FORMAT(ranked_at_ranking_list_periods, '%Y-%m-%d') AS ranked_at_ranking_list_periods,
            id_ranking_lists,

            -- ranking config
            min_age_groups,
            max_age_groups,
            ranked_age_bin,
            ranked_name_race_types,
            name_ranking_series,

            -- ranking entry
            id_ranking_list_period_entries,
            member_number_ranking_list_period_entries,
            first_name_ranking_list_period_entries,
            last_name_ranking_list_period_entries,
            rank_ranking_list_period_entries,
            score_ranking_list_period_entries,
            multiplier_score_ranking_list_period_entries,
            all_american_ranking_list_period_entries,

            -- created at dates
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM all_participation_state_rankings_results
        WHERE id_profiles IS NOT NULL
        ORDER BY id_profiles
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
};

module.exports = {
    query_participation_state_rankings_results: main,
};
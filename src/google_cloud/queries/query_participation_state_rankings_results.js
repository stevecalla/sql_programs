async function main(batch_size = 10000, offset = 0) {
    return `
        SELECT 
            -- profile info
            id_profiles,
            full_name_profiles,
            last_name_profiles,
            first_name_profiles,
            DATE_FORMAT(date_of_birth_profiles, '%Y-%m-%d') AS date_of_birth_profiles,
            email_users,
            gender_code_race_results, 
            state_profile_states,

            -- membership periods
            ids_membership_periods,
            ids_membership_type_membership_periods,
            names_membership_types,

            starts_membership_periods, -- date but type varchar b/c it might include multiple
            ends_membership_periods, -- date but type varchar b/c it might include multiple

            groups_membership_types,
            has_annual_membership_through_current_year_end,
            count_membership_periods,

            -- events
            ids_events,
            ids_sanctioning_events,
            starts_events, -- date but type varchar b/c it might include multiple
            names_events,
            state_name_events,

            -- race results
            age_race_results,
            designations_races,
            names_distance_types,
            names_race_types,
            ids_race_results,
            milliseconds_race_results,
            formatted_time_race_results,

            count_distinct_profiles,
            count_local_race_results,
            count_local_race_results_flag,

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
            all_american_ranking_list_period_entries,

            ids_race_results_used_for_ranking,
            start_date_race_results_used_for_ranking,
            scores_race_results_used_for_ranking,
            state_ranking_result_events,
            count_race_results_in_ranking_table,

            score_ranking_list_period_entries,
            multiplier_score_ranking_list_period_entries,
            
            scores_top_three_used_for_avg,
            scores_top_three_same_state_used_for_avg,
            avg_top_three_score_all_states,
            avg_top_three_score_same_state,

            debug_calc_rows,
            debug_top_three_rows_used,
            debug_top_three_score_calc_detail,
            debug_top_three_calc_final_score,
            debug_entry_score_compare,
            debug_top_three_calc_vs_entry_diff,

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
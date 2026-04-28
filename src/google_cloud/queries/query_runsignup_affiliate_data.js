async function main(batch_size = 10, offset = 0, TABLE_NAME) {
    return `  
        SELECT
            query_label,

            race_id,

            comparison_status,
            is_possible_exception,

            date_match,

            url,
            external_race_url,
            usat_registration_url,
            registration_url_final_rule,
            registration_url_final,
            registration_url_affiliate_final,
            registration_url_affiliate_final_char_count,

            event_type,
            setting_name_member_settings,
            membership_settings_source_member_settings,

            race_name,
            address_state,
            address_city,

            DATE_FORMAT(race_next_date, '%Y-%m-%d') AS race_next_date,
            race_next_year_date,
            race_next_month_date,

            usat_event_id_member_settings,
            usat_sanction_id_internal,
            registration_url_final_sanction_id,

            usat_match_name,
            usat_match_state,
            usat_match_city,

            DATE_FORMAT(usat_match_date, '%Y-%m-%d') AS usat_match_date,
            usat_match_year_date,
            usat_match_month_date,

            match_method,
            match_score_internal,
                
            race_count_distinct,
            row_count_total,

            -- CREATED AT DATES
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM ${TABLE_NAME}
        WHERE 1 = 1
        ORDER BY race_id ASC
        LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
    query_runsignup_affiliate_data: main
}
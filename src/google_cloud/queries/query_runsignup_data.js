async function main(batch_size = 10, offset = 0) {
    return `   
        -- QUERY TO EXTRACT RUNSIGNUP RACE / EVENT DATA (batched)
        SELECT DISTINCT
        -- TRACEABILITY
        id,
        page,
        row_index,

        -- FIRST-OCCURRENCE FLAGS
        race_count_first,
        event_count_first,

        -- RACE-LEVEL
        race_id,
        race_name,

        is_registration_open,
        is_private_race,
        is_draft_race,

        DATE_FORMAT(created_runsignup_timestamp, '%Y-%m-%d %H:%i:%s') AS created_runsignup_timestamp,
        DATE_FORMAT(created_runsignup_date, '%Y-%m-%d') AS created_runsignup_date,
        created_runsignup_month,
        created_runsignup_year,

        DATE_FORMAT(last_runsignup_modified_timestamp, '%Y-%m-%d %H:%i:%s') AS last_runsignup_modified_timestamp,
        DATE_FORMAT(last_runsignup_modified_date, '%Y-%m-%d') AS last_runsignup_modified_date,
        last_runsignup_modified_month,
        last_runsignup_modified_year,

        description,
        timezone,

        -- URLS / SOCIAL
        url,
        external_race_url,
        external_results_url,
        fb_page_id,
        fb_event_id,
        logo_url,

        -- ADDRESS
        address_street,
        address_street2,
        address_city,
        address_state,
        address_zipcode,
        address_country_code,

        -- RACE DATES + HELPERS
        DATE_FORMAT(race_last_date, '%Y-%m-%d') AS race_last_date,
        DATE_FORMAT(race_last_end_date, '%Y-%m-%d') AS race_last_end_date,
        DATE_FORMAT(race_next_date, '%Y-%m-%d') AS race_next_date,
        DATE_FORMAT(race_next_end_date, '%Y-%m-%d') AS race_next_end_date,

        race_month,
        race_year,

        -- EVENT-LEVEL
        event_id,
        race_event_days_id,

        event_name,
        event_details,

        event_type,
        distance,

        volunteer,
        require_dob,
        require_phone,

        participant_cap,

        -- EVENT DATES + HELPERS
        DATE_FORMAT(event_start_time, '%Y-%m-%d %H:%i:%s') AS event_start_time,
        DATE_FORMAT(event_end_time, '%Y-%m-%d %H:%i:%s') AS event_end_time,

        event_month,
        event_year,

        DATE_FORMAT(event_registration_opens, '%Y-%m-%d %H:%i:%s') AS event_registration_opens,
        event_registration_opens_month,
        event_registration_opens_year,

        -- REGISTRATION PERIODS (RAW + BEST-EFFORT FIELDS)
        DATE_FORMAT(event_reg_opens, '%Y-%m-%d %H:%i:%s') AS event_reg_opens,
        DATE_FORMAT(event_reg_closes, '%Y-%m-%d %H:%i:%s') AS event_reg_closes,

        event_race_fee,
        event_processing_fee,

        CAST(event_registration_periods_json AS CHAR) AS event_registration_periods_json,

        -- CREATED AT DATES
        DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
        DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

        FROM all_runsignup_data_raw
        WHERE 1 = 1
        ORDER BY id ASC
        LIMIT ${batch_size} OFFSET ${offset}
    ;
  `;
}

module.exports = {
    query_runsignup_race_event_data: main
}
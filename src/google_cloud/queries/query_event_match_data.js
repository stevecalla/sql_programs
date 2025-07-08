async function query_event_match_data(batch_size = 10, offset = 0) {
    return `
        SELECT
            ApplicationID, -- id_sanctioning_events
            Name,
            
            DATE_FORMAT(StartDate, '%Y-%m-%d') AS StartDate, -- event date
            DATE_FORMAT(RaceDate, '%Y-%m-%d') AS RaceDate,
            DATE_FORMAT(CreatedDate, '%Y-%m-%d') AS CreatedDate, -- created_at_events

            Status,
            2LetterCode,
            ZipCode,
            Value, -- event type / race designation

            RaceDirectorUserID, -- member_number_members
            Email, -- race director email_users

            Website, -- event_website_url
            RegistrationWebsite, -- registration_url
            
            sales_units,
            sales_revenue,
            source,

            DATE_FORMAT(earliest_start_date, '%Y-%m-%d') AS earliest_start_date,
            year,
            month,
            month_name,
            possible_duplicate,

            application_id_last_year,
            status_last_year,

            has_match,
            match_category,
            match_category_detailed,
            match_idx_last_year,
            match_formula_used,
            match_score_name_only,
            match_score_name_and_zip,
            match_score_name_and_site,
            match_score_bin,
            match_name_last_year,
            earliest_start_date_2024,
            website_last_year,
            zip_code_last_year,
            state_code_last_year,

            DATE_FORMAT(common_date, '%Y-%m-%d') AS common_date,
            common_year,
            common_month,

            status_this_year,
            common_status,
            source_year,

            -- CREATED AT DATES
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at_mtn
                
        FROM usat_sales_db.event_data_metrics_yoy_match
        WHERE 1 = 1
            AND ApplicationID IS NOT NULL
            AND source IS NOT NULL
            -- AND source IN ('from_missing_in_event_data_metrics')
        ORDER BY ApplicationID
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_event_match_data
}
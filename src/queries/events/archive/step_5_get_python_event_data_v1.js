// C:\Users\calla\development\usat\sql_code\8_events\step_5_get_python_event_data.sql

function step_5_query_python_event_data(batch_size, offset) {
    return `
        SELECT 
            id_sanctioning_events AS ApplicationID,
            -- id_races,

            TRIM(BOTH '"' FROM name_events) AS Name,

            -- starts_events AS StartDate,
            DATE_FORMAT(starts_events, '%Y-%m-%d') AS StartDate,

            -- start_date_races AS RaceDate,
            DATE_FORMAT(start_date_races, '%Y-%m-%d') AS RaceDate,

            status_events AS Status,

            state_code_events AS 2LetterCode,
            zip_events AS ZipCode,

            name_event_type AS Value,

            member_number_members AS RaceDirectorUserID,

            event_website_url AS Website,
            registration_url AS RegistrationWebsite,
            
            email_users AS Email,

            DATE_FORMAT(created_at_events, '%Y-%m-%d') AS CreatedDate

        -- FROM all_event_data_raw AS e
        FROM event_data_metrics AS e

        WHERE 1 = 1
            AND id_sanctioning_events IS NOT NULL
            
            -- AND starts_year_events IN (2024, 2025)
            AND starts_year_events IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1)
            
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    step_5_query_python_event_data,
}
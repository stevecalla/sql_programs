// C:\Users\calla\development\usat\sql_code\8_events\step_1_get_event_data_042125.sql

function step_1_query_event_data() {
    return `
        -- Set date range variables
        SET @start_date = '2025-08-01';
        SET @end_date   = '2025-09-01';

        WITH maxdate AS (
        SELECT 
            MAX(updated_at) AS max_updated_at
        FROM membership_periods
        WHERE starts >= @start_date AND starts < @end_date
        )
        SELECT 
            md.max_updated_at AS latest_updated_at
            , mp.*
        FROM membership_periods mp
            JOIN maxdate md ON mp.updated_at = md.max_updated_at
        WHERE mp.starts >= @start_date AND mp.starts < @end_date

        ;
    `;
}

module.exports = {
    step_1_query_event_data,
}
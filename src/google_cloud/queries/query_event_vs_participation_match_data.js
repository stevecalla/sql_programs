// C:\Users\calla\development\usat\sql_code\22_slack_daily_stats_052225\discovery_participation_event_details_062425.sql

async function query_event_vs_participation_match_data(batch_size = 10, offset = 0) {
    return `
        SELECT   
            row_num,  -- row numbering

            s_id_sanctioning_short,
            s_id_sanctioning_events,

            s_name_events,
            
            s_starts_events,
            s_month_label,
            s_state_code_events,

            p_id_sanctioning_events,
            p_month_label,
            p_start_date_races,
            
            reported_flag,
            
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc,
            
            -- CALC FIELDS
           event_type_category,
           count_s_id_sanctioning_events,   -- identify those with count > 1 given group concat
           row_count                        -- ✅ adds row count at the first column 

        FROM event_vs_participation_match_data
        ORDER BY row_num ASC
        LIMIT ${batch_size} OFFSET ${offset}
    `;
}

module.exports = {
    query_event_vs_participation_match_data,
}
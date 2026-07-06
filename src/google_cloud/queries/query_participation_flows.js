// Batched SELECT from the reporting flows table (MySQL) for the BigQuery load. Mirrors the other
// query_* files (batch_size / offset paging, stable ORDER BY).
async function query_participation_flows(batch_size = 50000, offset = 0) {
    return `
        SELECT
            start_date_year_races,
            start_date_month_races,
            home_state,
            event_state,
            participations,
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
        FROM all_participation_data_with_membership_match_flows
        ORDER BY start_date_year_races, home_state, event_state, start_date_month_races
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_participation_flows,
};

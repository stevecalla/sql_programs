// Batched SELECT from the reporting events table (MySQL) for the BigQuery load. Mirrors the other
// query_* files (batch_size / offset paging, stable ORDER BY). One row per (year, month, event); month
// is NULL for the annual roll-up.
async function query_participation_events(batch_size = 50000, offset = 0) {
    return `
        SELECT
            start_date_year_races,
            start_date_month_races,
            event_id,
            event_name,
            event_city,
            event_state,
            region_name,
            zip5,
            DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
            away,
            turnout,
            events,
            races,
            adult,
            adult_events,
            adult_races,
            female,
            male,
            age_4_19,
            age_20_29,
            age_30_39,
            age_40_49,
            age_50_59,
            age_60_plus,
            home,
            ironman,
            new_count,
            unique_athletes,
            lat,
            lng,
            DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
            DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc
        FROM all_participation_data_with_membership_match_events
        ORDER BY start_date_year_races, event_id, start_date_month_races
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_participation_events,
};

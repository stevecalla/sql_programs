// Batched SELECT from the reporting summary table (MySQL) for the BigQuery load. Mirrors the other
// query_* files (batch_size / offset paging, stable ORDER BY).
async function query_participation_summary(batch_size = 50000, offset = 0) {
    return `
        SELECT
            start_date_year_races,
            start_date_month_races,
            geo_level,
            geo_key,
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
            unique_athletes
        FROM all_participation_data_with_membership_match_summary
        ORDER BY start_date_year_races, geo_level, geo_key, start_date_month_races
        LIMIT ${batch_size} OFFSET ${offset}
        ;
    `;
}

module.exports = {
    query_participation_summary,
};

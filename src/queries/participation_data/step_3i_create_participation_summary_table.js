// step_3i_create_participation_summary_table.js
// SQL builders for the reporting summary tables — pre-aggregates all_participation_data_with_membership_match
// down to per (year, month, geo) metric rows + per (year, month, home->event) flow rows, so the reporting
// app reads a few hundred rows instead of aggregating ~6M every load.
//
// Field logic mirrors the reporting query AND the parent ETL:
//   event state  = state_code_events        home  = member_state_code_addresses = state_code_events
//   event region = region_name (from the region_data join already on the parent; complete + correct)
//   home region  = region_data joined on member_state_code_addresses (same join, member side)
//   gender = gender_code ('F'/'M')          IRONMAN = is_ironman = 1
//   age bands = age_as_race_results_bin     new = member_created_at_category_starts_mp = 'created_year'
//   unique = id_profiles
// Scope: the 50 US states (excludes the 'NA' / territory rows), matching the dashboard's US total.

const STATES = [
    'AK','AL','AR','AZ','CA','CO','CT','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD',
    'ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VA','VT','WA','WI','WV','WY',
];
const STATE_LIST = STATES.map((s) => `'${s}'`).join(',');
const ADULT_BINS = "('20-29','30-39','40-49','50-59','60-69','70-79','80-89','90-99')";

// Rolling last five calendar years (current year + 4 prior) — keeps the summary small + fast and
// self-maintaining (no yearly edits). Computed DB-side so it's always correct at build time. Override
// with a fixed year via REPORTING_SUMMARY_MIN_YEAR (e.g. 2019 for more history). The composite index
// (start_date_year_races, state_code_events) range-scans straight to this cutoff.
const MIN_YEAR = process.env.REPORTING_SUMMARY_MIN_YEAR
    ? String(Number(process.env.REPORTING_SUMMARY_MIN_YEAR))
    : '(YEAR(CURDATE()) - 4)';

// Shared metric expressions. home_expr defines "home" (in-state for state rows, in-region for region rows).
function metric_cols(home_expr) {
    return `
            COUNT(t.id_rr) AS turnout,
            COUNT(DISTINCT t.id_events_rr) AS events,
            COUNT(DISTINCT t.id_race_rr) AS races,
            SUM(t.age_as_race_results_bin IN ${ADULT_BINS}) AS adult,
            COUNT(DISTINCT CASE WHEN t.age_as_race_results_bin IN ${ADULT_BINS} THEN t.id_events_rr END) AS adult_events,
            COUNT(DISTINCT CASE WHEN t.age_as_race_results_bin IN ${ADULT_BINS} THEN t.id_race_rr END) AS adult_races,
            SUM(t.gender_code = 'F') AS female,
            SUM(t.gender_code = 'M') AS male,
            SUM(t.age_as_race_results_bin IN ('4-9','10-19')) AS age_4_19,
            SUM(t.age_as_race_results_bin = '20-29') AS age_20_29,
            SUM(t.age_as_race_results_bin = '30-39') AS age_30_39,
            SUM(t.age_as_race_results_bin = '40-49') AS age_40_49,
            SUM(t.age_as_race_results_bin = '50-59') AS age_50_59,
            SUM(t.age_as_race_results_bin IN ('60-69','70-79','80-89','90-99')) AS age_60_plus,
            SUM(${home_expr}) AS home,
            SUM(t.member_state_code_addresses IS NULL OR t.member_state_code_addresses NOT IN (${STATE_LIST})) AS unknown_home_count,
            SUM(t.is_ironman = 1) AS ironman,
            SUM(t.member_created_at_category_starts_mp = 'created_year') AS new_count,
            COUNT(DISTINCT t.id_profiles) AS unique_athletes,
            MAX(t.created_at_mtn) AS created_at_mtn,
            MAX(t.created_at_utc) AS created_at_utc`;
}

// CREATE the summary table. Each geo level uses GROUP BY ... WITH ROLLUP so ONE scan produces both the
// monthly rows AND the annual (month = NULL) subtotal — with COUNT(DISTINCT) computed correctly at both
// levels. HAVING drops the extra ROLLUP super-aggregate rows. 3 scans instead of 6.
async function create_participation_summary_table(summary_table, base_table) {
    const W = `WHERE t.state_code_events IN (${STATE_LIST}) AND t.start_date_year_races >= ${MIN_YEAR}`;
    const home_state = 't.member_state_code_addresses = t.state_code_events';
    const home_region = 'rm.region_name = t.region_name';   // member region (join) = event region (parent)
    const member_join = `LEFT JOIN region_data rm ON t.member_state_code_addresses = rm.state_code`;

    return `
        CREATE TABLE ${summary_table} AS
        -- state: monthly + annual (ROLLUP over month). HAVING keeps only real-state rows.
        SELECT t.start_date_year_races, t.start_date_month_races,
               'state' AS geo_level, t.state_code_events AS geo_key, ${metric_cols(home_state)}
        FROM ${base_table} t ${W}
        GROUP BY t.start_date_year_races, t.state_code_events, t.start_date_month_races WITH ROLLUP
        HAVING t.state_code_events IS NOT NULL
        UNION ALL
        -- region: monthly + annual (ROLLUP over month). HAVING keeps only real-region rows.
        SELECT t.start_date_year_races, t.start_date_month_races,
               'region' AS geo_level, t.region_name AS geo_key, ${metric_cols(home_region)}
        FROM ${base_table} t ${member_join} ${W} AND t.region_name IS NOT NULL AND t.region_name <> ''
        GROUP BY t.start_date_year_races, t.region_name, t.start_date_month_races WITH ROLLUP
        HAVING t.region_name IS NOT NULL
        UNION ALL
        -- national (US total; needed for the exact national unique count): monthly + annual (ROLLUP).
        SELECT t.start_date_year_races, t.start_date_month_races,
               'national' AS geo_level, 'US' AS geo_key, ${metric_cols(home_state)}
        FROM ${base_table} t ${W}
        GROUP BY t.start_date_year_races, t.start_date_month_races WITH ROLLUP
        HAVING t.start_date_year_races IS NOT NULL
        ;
    `;
}

// CREATE the flows table (home -> event cross-state counts). ROLLUP gives monthly + annual in one scan.
async function create_participation_flows_table(flows_table, base_table) {
    const W = `WHERE t.state_code_events IN (${STATE_LIST}) AND t.member_state_code_addresses IN (${STATE_LIST}) AND t.member_state_code_addresses <> t.state_code_events AND t.start_date_year_races >= ${MIN_YEAR}`;
    return `
        CREATE TABLE ${flows_table} AS
        SELECT t.start_date_year_races, t.start_date_month_races,
               t.member_state_code_addresses AS home_state, t.state_code_events AS event_state,
               COUNT(t.id_rr) AS participations,
               MAX(t.created_at_mtn) AS created_at_mtn,
               MAX(t.created_at_utc) AS created_at_utc
        FROM ${base_table} t ${W}
        GROUP BY t.start_date_year_races, t.member_state_code_addresses, t.state_code_events, t.start_date_month_races WITH ROLLUP
        HAVING t.state_code_events IS NOT NULL
        ;
    `;
}

// CREATE the events table (Path A: one row per year × sanctioning event, monthly + annual via ROLLUP).
// Same metric set + logic as the summary (consistent by construction), plus the event's name/city/state/
// region and a lat/lng for the map pin. lat/lng come from zip_lat_lng_reference (ZIP5 centroid), with
// a ZIP3-average fallback for any event ZIP not present at the 5-digit level. The descriptive event fields
// are aggregated with MAX (one value per event) so they survive the GROUP BY / ROLLUP.
async function create_participation_events_table(events_table, base_table) {
    const W = `WHERE t.state_code_events IN (${STATE_LIST}) AND t.start_date_year_races >= ${MIN_YEAR}`;
    const home_state = 't.member_state_code_addresses = t.state_code_events';
    const zip_ref = 'zip_lat_lng_reference';

    return `
        CREATE TABLE ${events_table} AS
        SELECT ev.*,
               ROUND(ev.turnout / NULLIF(ev.races, 0))                       AS per_race,
               ROUND(ev.adult   / NULLIF(ev.races, 0))                       AS adult_per_race,
               ROUND(100 * ev.female / NULLIF(ev.turnout, 0))                AS female_pct,
               ROUND(100 * ev.male   / NULLIF(ev.turnout, 0))                AS male_pct,
               ROUND(100 * ev.age_4_19    / NULLIF(ev.turnout, 0))           AS age_4_19_pct,
               ROUND(100 * ev.age_20_29   / NULLIF(ev.turnout, 0))           AS age_20_29_pct,
               ROUND(100 * ev.age_30_39   / NULLIF(ev.turnout, 0))           AS age_30_39_pct,
               ROUND(100 * ev.age_40_49   / NULLIF(ev.turnout, 0))           AS age_40_49_pct,
               ROUND(100 * ev.age_50_59   / NULLIF(ev.turnout, 0))           AS age_50_59_pct,
               ROUND(100 * ev.age_60_plus / NULLIF(ev.turnout, 0))           AS age_60_plus_pct,
               COALESCE(ROUND(100 * ev.home / NULLIF(ev.home + ev.away, 0)), 0)         AS home_pct,
               (100 - COALESCE(ROUND(100 * ev.home / NULLIF(ev.home + ev.away, 0)), 0)) AS away_pct,
               COALESCE(ROUND(100 * ev.unknown_home_count / NULLIF(ev.turnout, 0)), 0)  AS unknown_home_pct,
               (ev.turnout - ev.new_count)                                   AS repeat_count,
               COALESCE(ROUND(100 * ev.new_count / NULLIF(ev.turnout, 0)), 0)           AS new_pct,
               (100 - COALESCE(ROUND(100 * ev.new_count / NULLIF(ev.turnout, 0)), 0))   AS repeat_pct,
               ROUND(ev.turnout / NULLIF(ev.unique_athletes, 0), 1)          AS per_participant,
               ROUND(COALESCE(z.lat, z3.lat), 6) AS lat,
               ROUND(COALESCE(z.lng, z3.lng), 6) AS lng
        FROM (
            SELECT t.start_date_year_races, t.start_date_month_races,
                   t.id_sanctioning_events AS event_id,
                   MAX(TRIM(BOTH '"' FROM TRIM(t.name_events_rr))) AS event_name,
                   MAX(TRIM(BOTH '"' FROM TRIM(t.city_events))) AS event_city,
                   MAX(t.state_code_events) AS event_state,
                   MAX(t.region_name)       AS region_name,
                   LEFT(MAX(t.zip_events), 5) AS zip5,
                   MAX(DATE(t.start_date_races)) AS event_date,
                   MAX(t.is_ironman = 1) AS is_ironman_event,
                   SUM(t.member_state_code_addresses IN (${STATE_LIST}) AND t.member_state_code_addresses <> t.state_code_events) AS away,
                   ${metric_cols(home_state)}
            FROM ${base_table} t ${W}
            GROUP BY t.start_date_year_races, t.id_sanctioning_events, t.start_date_month_races WITH ROLLUP
            HAVING t.id_sanctioning_events IS NOT NULL
        ) ev
        LEFT JOIN ${zip_ref} z ON z.zip5 = ev.zip5
        LEFT JOIN (
            SELECT LEFT(zip5, 3) AS zip3, AVG(lat) AS lat, AVG(lng) AS lng
            FROM ${zip_ref}
            GROUP BY LEFT(zip5, 3)
        ) z3 ON z3.zip3 = LEFT(ev.zip5, 3)
        ;
    `;
}

async function query_append_index_fields_events(events_table) {
    return `
        ALTER TABLE ${events_table}
            ADD INDEX idx_events_yr_month (start_date_year_races, start_date_month_races),
            ADD INDEX idx_events_yr_event (start_date_year_races, event_id),
            ADD INDEX idx_events_yr_state (start_date_year_races, event_state)
        ;
    `;
}

async function query_append_index_fields_summary(summary_table) {
    return `
        ALTER TABLE ${summary_table}
            ADD INDEX idx_summary_yr_level_geo (start_date_year_races, geo_level, geo_key),
            ADD INDEX idx_summary_yr_month (start_date_year_races, start_date_month_races)
        ;
    `;
}

async function query_append_index_fields_flows(flows_table) {
    return `
        ALTER TABLE ${flows_table}
            ADD INDEX idx_flows_yr_month (start_date_year_races, start_date_month_races),
            ADD INDEX idx_flows_yr_home_event (start_date_year_races, home_state, event_state)
        ;
    `;
}

module.exports = {
    create_participation_summary_table,
    create_participation_flows_table,
    create_participation_events_table,
    query_append_index_fields_summary,
    query_append_index_fields_flows,
    query_append_index_fields_events,
};

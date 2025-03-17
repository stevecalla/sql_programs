// SOURCE C:\Users\calla\development\usat\sql_code\5_race_participation\local_participation_raw_merge_region_and_sales.sql

async function step_3_create_participation_with_regions() {
    return `
        DROP TABLE IF EXISTS all_participation_data_with_regions;

        CREATE TABLE IF NOT EXISTS all_participation_data_with_regions AS
        SELECT
            p.*,
            r.*
        FROM all_participation_data_raw AS p
            LEFT JOIN region_data AS r ON p.state_code_events = r.state_code
        -- LIMIT 100
        ;

        ALTER TABLE all_participation_data_with_regions
            ADD INDEX idx_id_events (id_events),
            ADD INDEX idx_name_event_type (name_event_type),
            ADD INDEX idx_name_events (name_events),
            ADD INDEX idx_starts_events (starts_events),
            ADD INDEX idx_id_profile_rr (id_profile_rr),
            ADD INDEX idx_member_number_rr (member_number_rr),
            ADD INDEX idx_gender_code_rr (gender_code),
            ADD INDEX idx_start_date_races (start_date_races),
            ADD INDEX idx_name_distance_types (name_distance_types),
            ADD INDEX idx_name_race_type (name_race_type)
            ADD INDEX idx_state_code_events (state_code_events)
            ADD INDEX idx_region_abbr (region_abbr)
            ADD INDEX idx_region_name (region_name)
        ;
    `;
}

module.exports = {
    step_3_create_participation_with_regions,
}
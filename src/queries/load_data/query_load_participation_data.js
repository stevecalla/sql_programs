const id_fields = `
    -- RACE / EVENT INFO
    id_rr,
    id_race_rr,
    id_races,
    id_events,
    id_sanctioning_events,
    event_type_id_events,
`;

const event_types = `
    name_event_type,
`;

const events_table = `
    -- EVENTS
    name_events,
    address_events,
    city_events,

    -- EVENTS GEO
    zip_events,
    state_code_events,
    country_code_events,

    -- EVENTS DATES
    created_at_events,
    created_at_month_events,
    created_at_quarter_events,
    created_at_year_events,

    starts_events,
    starts_month_events,
    starts_quarter_events,
    starts_year_events,

    ends_events,
    ends_month_events,
    ends_quarter_events,
    ends_year_events,

    status_events,

    race_director_id_events,
    last_season_event_id,
    
    -- IRONMAN
    is_ironman,
`;

const races_table = `
    -- RACES TABLE
    start_date_races,
    start_date_month_races,
    start_date_quarter_races,
    start_date_year_races,
`;

const race_results_table = `
    -- RACE RESULTS MEMBER DETAIL
    id_profile_rr,
    member_number_rr,
    gender_code,
    gender_id,
    score,
    finish_status,
    age,
    readable_time,
    milliseconds,
`;

const distance_types_table = `
    name_distance_types,
`;

const race_types_table = `
    -- RACE TYPES
    id_race_types,
    name_race_type,
`;

const created_at_dates = `
    -- CREATED AT DATES
    created_at_mtn,
    created_at_utc,
`;

const gender_count = `
    -- GENDER COUNT
    gender_male_count,
    gender_female_count,
    gender_other_count,
`;

const metrics = `
    -- METRICS
    count_profile_id_distinct,
    count_all_participation
`;

// LOAD DATA INFILE C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/usat_participation_data/results_2025-03-14_22-02-23_participation_data_2024-01-01_batch_1.csv
function query_load_participation_data(filePath, table) {
  return `
    LOAD DATA LOCAL INFILE '${filePath}'
    INTO TABLE ${table}
    FIELDS TERMINATED BY ','
    ENCLOSED BY '"'
    LINES TERMINATED BY '\\n'
    -- todo:
    IGNORE 1 LINES
    -- REMOVES HEADER & ROW WITH ALL NULLS DUE TO RIGHT JOINS
    -- IGNORE 2 LINES
    (
      ${id_fields}
      ${event_types}
      ${events_table}
      ${races_table}
      ${race_results_table}
      ${distance_types_table}
      ${race_types_table}
      ${created_at_dates}
      ${gender_count}
      ${metrics}
    ) 
  `
  }
    
module.exports = {
    query_load_participation_data,
};
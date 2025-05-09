const id_fields = `
    -- RACE / EVENT INFO
    id_rr INT,
    id_race_rr INT,
    id_races INT,
    id_events INT,
    id_sanctioning_events INT,
    event_type_id_events INT,
`;

const event_types = `
    name_event_type VARCHAR(255),
`;

const events_table = `
    -- EVENTS
    name_events VARCHAR(255),
    address_events VARCHAR(255),
    city_events VARCHAR(191),

    -- EVENTS GEO
    zip_events VARCHAR(50),
    state_code_events VARCHAR(10),
    country_code_events VARCHAR(10),

    -- EVENTS DATES
    created_at_events DATETIME,
    created_at_month_events INT,
    created_at_quarter_events INT,
    created_at_year_events INT,

    starts_events DATE,
    starts_month_events INT,
    starts_quarter_events INT,
    starts_year_events INT,

    ends_events DATE,
    ends_month_events INT,
    ends_quarter_events INT,
    ends_year_events INT,

    status_events VARCHAR(50),

    race_director_id_events INT,
    last_season_event_id INT,
    
    -- IRONMAN
    is_ironman BOOLEAN,
`;

const races_table = `
    -- RACES TABLE
    start_date_races DATE,
    start_date_month_races INT,
    start_date_quarter_races INT,
    start_date_year_races INT,
`;

const race_results_member_detail_table = `
    -- RACE RESULTS MEMBER DETAIL
    id_profile_rr VARCHAR(255),
    member_number_rr VARCHAR(255),
    gender_code VARCHAR(50),
    gender_id INT,
    score DECIMAL(10,2),
    finish_status VARCHAR(50),
    age INT,
    readable_time VARCHAR(50),
    milliseconds INT,
    category VARCHAR(50),
`;

const distance_types_table = `
    name_distance_types VARCHAR(255),
`;

const race_types_table = `
    -- RACE TYPES
    id_race_types INT,
    name_race_type VARCHAR(255),
`;

const created_at_dates = `
    -- CREATED AT DATES
    created_at_mtn DATETIME,
    created_at_utc DATETIME,
`;

const index_fields = `
    -- PRIMARY KEY (id_race_rr, id_profile_rr),
    INDEX idx_id_events (id_events),

    INDEX idx_name_event_type (name_event_type),

    INDEX idx_name_events (name_events),
    INDEX idx_starts_events (starts_events),

    -- INDEX idx_id_profile_rr (id_profile_rr),
    -- INDEX idx_member_number_rr (member_number_rr),
    INDEX idx_gender_code_rr (gender_code),

    INDEX idx_start_date_races (start_date_races),

    INDEX idx_name_distance_types (name_distance_types),

    INDEX idx_name_race_type (name_race_type) 
`;

async function query_create_participation_table(table_name) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${id_fields}
      ${event_types}
      ${events_table}
      ${races_table}
      ${race_results_member_detail_table}
      ${distance_types_table}
      ${race_types_table}
      ${created_at_dates}
      ${index_fields}
    );
  `;

  return query;
}

module.exports = {
    query_create_participation_table,
}
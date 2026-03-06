// all_runsignup_data_schema.js

const main = [
  // TRACEABILITY
  {
    name: "id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Auto-increment primary key from local MySQL extract table",
    fields: []
  },
  {
    name: "page",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "RunSignup API page number used during extraction",
    fields: []
  },
  {
    name: "row_index",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Streaming row index assigned during extraction",
    fields: []
  },

  // FIRST-OCCURRENCE FLAGS
  {
    name: "race_count_first",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Flag indicating the first occurrence of a race_id within the extract year",
    fields: []
  },
  {
    name: "event_count_first",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Flag indicating the first occurrence of an event_id within the extract year",
    fields: []
  },

  // RACE-LEVEL
  {
    name: "race_id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "RunSignup race_id",
    fields: []
  },
  {
    name: "race_name",
    mode: "NULLABLE",
    type: "STRING",
    description: "RunSignup race name",
    fields: []
  },

  {
    name: "is_registration_open",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Race registration open flag (1/0)",
    fields: []
  },
  {
    name: "is_private_race",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Race private flag (1/0)",
    fields: []
  },
  {
    name: "is_draft_race",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Race draft flag (1/0)",
    fields: []
  },

  {
    name: "created_runsignup_timestamp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "RunSignup-created timestamp normalized to YYYY-MM-DD HH:MM:SS",
    fields: []
  },
  {
    name: "created_runsignup_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Date extracted from created_runsignup_timestamp",
    fields: []
  },
  {
    name: "created_runsignup_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from created_runsignup_timestamp",
    fields: []
  },
  {
    name: "created_runsignup_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from created_runsignup_timestamp",
    fields: []
  },

  {
    name: "last_runsignup_modified_timestamp",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "RunSignup last-modified timestamp normalized to YYYY-MM-DD HH:MM:SS",
    fields: []
  },
  {
    name: "last_runsignup_modified_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Date extracted from last_runsignup_modified_timestamp",
    fields: []
  },
  {
    name: "last_runsignup_modified_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from last_runsignup_modified_timestamp",
    fields: []
  },
  {
    name: "last_runsignup_modified_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from last_runsignup_modified_timestamp",
    fields: []
  },

  {
    name: "description",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race description with HTML stripped",
    fields: []
  },
  {
    name: "timezone",
    mode: "NULLABLE",
    type: "STRING",
    description: "RunSignup race timezone value",
    fields: []
  },

  // URLS / SOCIAL
  {
    name: "url",
    mode: "NULLABLE",
    type: "STRING",
    description: "RunSignup race URL",
    fields: []
  },
  {
    name: "external_race_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "External race website URL",
    fields: []
  },
  {
    name: "external_results_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "External results URL",
    fields: []
  },
  {
    name: "fb_page_id",
    mode: "NULLABLE",
    type: "STRING",
    description: "Facebook page identifier from RunSignup",
    fields: []
  },
  {
    name: "fb_event_id",
    mode: "NULLABLE",
    type: "STRING",
    description: "Facebook event identifier from RunSignup",
    fields: []
  },
  {
    name: "logo_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "RunSignup race logo URL",
    fields: []
  },

  // ADDRESS
  {
    name: "address_street",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address street",
    fields: []
  },
  {
    name: "address_street2",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address street line 2",
    fields: []
  },
  {
    name: "address_city",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address city",
    fields: []
  },
  {
    name: "address_state",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address state",
    fields: []
  },
  {
    name: "address_zipcode",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address zip code",
    fields: []
  },
  {
    name: "address_country_code",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address country code",
    fields: []
  },

  // RACE DATES + HELPERS
  {
    name: "race_last_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race last date (YYYY-MM-DD)",
    fields: []
  },
  {
    name: "race_last_end_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race last end date (YYYY-MM-DD)",
    fields: []
  },
  {
    name: "race_next_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race next date (YYYY-MM-DD)",
    fields: []
  },
  {
    name: "race_next_end_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race next end date (YYYY-MM-DD)",
    fields: []
  },

  {
    name: "race_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from race_next_date",
    fields: []
  },
  {
    name: "race_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from race_next_date",
    fields: []
  },

  // EVENT-LEVEL
  {
    name: "event_id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "RunSignup event_id",
    fields: []
  },
  {
    name: "race_event_days_id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "RunSignup race_event_days_id",
    fields: []
  },

  {
    name: "event_name",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event name",
    fields: []
  },
  {
    name: "event_details",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event details with HTML stripped",
    fields: []
  },

  {
    name: "event_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event type from RunSignup",
    fields: []
  },
  {
    name: "distance",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event distance from RunSignup",
    fields: []
  },

  {
    name: "volunteer",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Volunteer flag (1/0)",
    fields: []
  },
  {
    name: "require_dob",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Require date of birth flag (1/0)",
    fields: []
  },
  {
    name: "require_phone",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Require phone flag (1/0)",
    fields: []
  },

  {
    name: "participant_cap",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Participant cap for the event",
    fields: []
  },

  // EVENT DATES + HELPERS
  {
    name: "event_start_time",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Event start time normalized to YYYY-MM-DD HH:MM:SS",
    fields: []
  },
  {
    name: "event_end_time",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Event end time normalized to YYYY-MM-DD HH:MM:SS",
    fields: []
  },

  {
    name: "event_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from event_start_time",
    fields: []
  },
  {
    name: "event_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from event_start_time",
    fields: []
  },

  {
    name: "event_registration_opens",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Event registration opens timestamp normalized to YYYY-MM-DD HH:MM:SS",
    fields: []
  },
  {
    name: "event_registration_opens_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from event_registration_opens",
    fields: []
  },
  {
    name: "event_registration_opens_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from event_registration_opens",
    fields: []
  },

  // REGISTRATION PERIODS (RAW + BEST-EFFORT FIELDS)
  {
    name: "event_reg_opens",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Best-effort registration open timestamp from the first registration period",
    fields: []
  },
  {
    name: "event_reg_closes",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Best-effort registration close timestamp from the first registration period",
    fields: []
  },

  {
    name: "event_race_fee",
    mode: "NULLABLE",
    type: "NUMERIC",
    description: "Best-effort race fee from the first registration period",
    fields: []
  },
  {
    name: "event_processing_fee",
    mode: "NULLABLE",
    type: "NUMERIC",
    description: "Best-effort processing fee from the first registration period",
    fields: []
  },

  {
    name: "event_registration_periods_json",
    mode: "NULLABLE",
    type: "STRING",
    description: "Raw registration periods JSON serialized as a string for BigQuery load compatibility",
    fields: []
  },

  // CREATED AT (PIPELINE TIMESTAMPS)
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row extraction timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row extraction timestamp in UTC",
    fields: []
  }
];

module.exports = { all_runsignup_data_schema: main };
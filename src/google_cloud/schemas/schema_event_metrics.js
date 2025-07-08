const event_metrics_schema = [
  // ID Fields
  {
    name: "id_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Primary key for events table",
    fields: []
  },
  {
    name: "id_sanctioning_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Sanctioning event identifier",
    fields: []
  },
  {
    name: "id_races",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Primary key for races table",
    fields: []
  },  
  // Event Types & Race Designation
  {
    name: "event_type_id_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Identifier for event type",
    fields: []
  },
  {
    name: "designation_races",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the race type / designation",
    fields: []
  },
  {
    name: "name_event_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the event type",
    fields: []
  },

  // Website & Registration
  {
    name: "event_website_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "URL for the event's official website",
    fields: []
  },
  {
    name: "registration_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "URL for event registration",
    fields: []
  },
  // Event Details
  {
    name: "name_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the event",
    fields: []
  },
  {
    name: "address_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event street address",
    fields: []
  },
  {
    name: "city_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "City where the event takes place",
    fields: []
  },
  
  // Geo Fields
  {
    name: "zip_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Postal code for the event",
    fields: []
  },
  {
    name: "state_code_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "State code for the event",
    fields: []
  },
  {
    name: "country_code_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Country code for the event",
    fields: []
  },

  // Created At Dates
  {
    name: "created_at_events",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Timestamp when event record was created",
    fields: []
  },
  {
    name: "created_at_month_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month part of creation date",
    fields: []
  },
  {
    name: "created_at_quarter_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Quarter part of creation date",
    fields: []
  },
  {
    name: "created_at_year_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year part of creation date",
    fields: []
  },

  // Event Start & End
  {
    name: "starts_events",
    mode: "NULLABLE",
    type: "DATE",
    description: "Event start date",
    fields: []
  },
  {
    name: "starts_month_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start month of event",
    fields: []
  },
  {
    name: "starts_quarter_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start quarter of event",
    fields: []
  },
  {
    name: "starts_year_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start year of event",
    fields: []
  },
  {
    name: "ends_events",
    mode: "NULLABLE",
    type: "DATE",
    description: "Event end date",
    fields: []
  },
  {
    name: "ends_month_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End month of event",
    fields: []
  },
  {
    name: "ends_quarter_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End quarter of event",
    fields: []
  },
  {
    name: "ends_year_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "End year of event",
    fields: []
  },

  // Status
  {
    name: "status_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Current status of the event",
    fields: []
  },
  // RACE DIRECTOR
  {
    name: "race_director_id_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "User ID of the race director",
    fields: []
  },
  {
    name: "id_race_director",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "ID of the race director",
    fields: []
  },
  {
    name: "email_users",
    mode: "NULLABLE",
    type: "STRING",
    description: "Email of the race director",
    fields: []
  },
  {
    name: "member_number_members",
    mode: "NULLABLE",
    type: "STRING",
    description: "Member number of the race director",
    fields: []
  },
  // Ironman Flag
  {
    name: "is_ironman",
    mode: "NULLABLE",
    type: "BOOLEAN",
    description: "Indicates if this is an Ironman event",
    fields: []
  },

  // Races Table Fields
  {
    name: "start_date_races",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race start date",
    fields: []
  },
  {
    name: "start_date_month_races",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start month of race",
    fields: []
  },
  {
    name: "start_date_quarter_races",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start quarter of race",
    fields: []
  },
  {
    name: "start_date_year_races",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Start year of race",
    fields: []
  },

  // Distance Types
  {
    name: "name_distance_types",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the distance type",
    fields: []
  },

  // Race Types
  {
    name: "id_race_types",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Identifier for race type",
    fields: []
  },
  {
    name: "name_race_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the race type",
    fields: []
  },

  // Created At Dates (Timezone Variants)
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Creation timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Creation timestamp in UTC",
    fields: []
  },

  // Region Fields
  {
    name: "region_state_code",
    mode: "NULLABLE",
    type: "STRING",
    description: "State code for the region",
    fields: []
  },
  {
    name: "region_name",
    mode: "NULLABLE",
    type: "STRING",
    description: "Name of the region",
    fields: []
  },
  {
    name: "region_abbr",
    mode: "NULLABLE",
    type: "STRING",
    description: "Region abbreviation for the event",
    fields: []
  }
];

module.exports = { event_metrics_schema };

// discovery_participation_event_details_062425 — result schema
const event_vs_participation_match_schema = [
  // Row numbering
  {
    name: "row_num",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Sequential row number in the ordered result",
    fields: []
  },

  // Source / Sanctioning (s_*)
  {
    name: "s_id_sanctioning_short",
    mode: "NULLABLE",
    type: "STRING",
    description: "Shorthand sanctioning event identifier from source system",
    fields: []
  },
  {
    name: "s_id_sanctioning_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Full sanctioning event identifier from source system",
    fields: []
  },

  {
    name: "s_name_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event name from source system",
    fields: []
  },

  {
    name: "s_starts_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event start date (source system)",
    fields: []
  },
  {
    name: "s_month_label",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month label derived for the source event (e.g., '2025-06')",
    fields: []
  },
  {
    name: "s_state_code_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Two-letter state/region code for the source event",
    fields: []
  },

  // Participation (p_*)
  {
    name: "p_id_sanctioning_events",
    mode: "NULLABLE",
    type: "STRING",
    description: "Sanctioning event identifier found in participation data",
    fields: []
  },
  {
    name: "p_month_label",
    mode: "NULLABLE",
    type: "STRING",
    description: "Month label derived for participation data (e.g., '2025-06')",
    fields: []
  },
  {
    name: "p_start_date_races",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race start date from participation data",
    fields: []
  },

  // Flags
  {
    name: "reported_flag",
    mode: "NULLABLE",
    type: "STRING",
    description: "Flag indicating if event appears reported/linked",
    fields: []
  },

  // Created timestamps (formatted as strings)
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "STRING", // DATE_FORMAT returns string
    description: "Creation timestamp formatted in Mountain Time (YYYY-MM-DD HH:MM:SS)",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "STRING", // DATE_FORMAT returns string
    description: "Creation timestamp formatted in UTC (YYYY-MM-DD HH:MM:SS)",
    fields: []
  },

  // Calculated / derived fields
  {
    name: "event_type_category",
    mode: "NULLABLE",
    type: "STRING",
    description: "Derived category for event type (e.g., 'race', 'clinic', 'unknown')",
    fields: []
  },
  {
    name: "count_s_id_sanctioning_events",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Count of matching source sanctioning IDs (for deduplication diagnostics)",
    fields: []
  },
  {
    name: "row_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total rows considered in the result set",
    fields: []
  }
];

module.exports = { 
  event_vs_participation_match_schema,
};
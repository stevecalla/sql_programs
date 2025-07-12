const event_data_metrics_yoy_match_schema = [
  // Identification fields
  {
    name: "ApplicationID",
    type: "STRING",
    mode: "REQUIRED",
    description: "Unique identifier for the application/event in the source data"
  },
  {
    name: "Name",
    type: "STRING",
    mode: "NULLABLE",
    description: "Event name/title"
  },

  // Event Dates
  {
    name: "StartDate",
    type: "DATE",
    mode: "NULLABLE",
    description: "Event start date (StartDate)"
  },
  {
    name: "RaceDate",
    type: "DATE",
    mode: "NULLABLE",
    description: "Race date if different from start (RaceDate)"
  },
  {
    name: "CreatedDate",
    type: "DATE",
    mode: "NULLABLE",
    description: "Event record created date (CreatedDate)"
  },

  // Status and Geo fields
  {
    name: "Status",
    type: "STRING",
    mode: "NULLABLE",
    description: "Current status of event (Status)"
  },
  {
    name: "2LetterCode",
    type: "STRING",
    mode: "NULLABLE",
    description: "State code (2LetterCode)"
  },
  {
    name: "ZipCode",
    type: "STRING",
    mode: "NULLABLE",
    description: "Postal code (ZipCode)"
  },

  // Event Type / Designation
  {
    name: "Value",
    type: "STRING",
    mode: "NULLABLE",
    description: "Event type or race designation (Value)"
  },

  // Race director / User info
  {
    name: "RaceDirectorUserID",
    type: "STRING",
    mode: "NULLABLE",
    description: "User ID/member number for race director (RaceDirectorUserID)"
  },
  {
    name: "Email",
    type: "STRING",
    mode: "NULLABLE",
    description: "Race director email address (Email)"
  },

  // Websites
  {
    name: "Website",
    type: "STRING",
    mode: "NULLABLE",
    description: "URL for the event website (Website)"
  },
  {
    name: "RegistrationWebsite",
    type: "STRING",
    mode: "NULLABLE",
    description: "Registration site URL (RegistrationWebsite)"
  },

  // Sales metrics
  {
    name: "sales_units",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Number of sales units (registrations)"
  },
  {
    name: "sales_revenue",
    type: "FLOAT",
    mode: "NULLABLE",
    description: "Sales revenue for the event"
  },
  {
    name: "source",
    type: "STRING",
    mode: "NULLABLE",
    description: "Data source for this record"
  },

  // Date normalization
  {
    name: "earliest_start_date",
    type: "DATE",
    mode: "NULLABLE",
    description: "Earliest start date for related records"
  },
  {
    name: "year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Year component of event"
  },
  {
    name: "month",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Month component of event"
  },
  {
    name: "month_name",
    type: "STRING",
    mode: "NULLABLE",
    description: "Month name of event"
  },

  // Duplicate / match reference
  {
    name: "possible_duplicate",
    type: "BOOLEAN",
    mode: "NULLABLE",
    description: "Flag if possible duplicate"
  },
  {
    name: "application_id_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "ApplicationID from prior year match"
  },
  {
    name: "status_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Event status from prior year"
  },

  // Match logic fields
  {
    name: "has_match",
    type: "BOOLEAN",
    mode: "NULLABLE",
    description: "Flag if a match was found to prior year"
  },
  {
    name: "match_category",
    type: "STRING",
    mode: "NULLABLE",
    description: "Broad match category assigned by logic"
  },
  {
    name: "match_category_detailed",
    type: "STRING",
    mode: "NULLABLE",
    description: "Detailed match category"
  },
  {
    name: "match_idx_last_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Index of the matching event from last year"
  },
  {
    name: "match_formula_used",
    type: "STRING",
    mode: "NULLABLE",
    description: "Which formula was used for the match"
  },
  {
    name: "match_score_name_only",
    type: "FLOAT",
    mode: "NULLABLE",
    description: "Fuzzy match score on name only"
  },
  {
    name: "match_score_name_and_zip",
    type: "FLOAT",
    mode: "NULLABLE",
    description: "Fuzzy match score on name and zip"
  },
  {
    name: "match_score_name_and_site",
    type: "FLOAT",
    mode: "NULLABLE",
    description: "Fuzzy match score on name and website"
  },
  {
    name: "match_score_bin",
    type: "STRING",
    mode: "NULLABLE",
    description: "Match score bin (confidence range)"
  },
  {
    name: "match_name_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Event name from prior year match"
  },
  {
    name: "earliest_start_date_2024",
    type: "DATE",
    mode: "NULLABLE",
    description: "Earliest start date from 2024 match"
  },
  {
    name: "website_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Website from prior year match"
  },
  {
    name: "zip_code_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Zip code from prior year match"
  },
  {
    name: "state_code_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "State code from prior year match"
  },

  // Common date fields (for YOY analysis)
  {
    name: "common_date",
    type: "DATE",
    mode: "NULLABLE",
    description: "Date normalized for YOY analysis"
  },
  {
    name: "common_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Common year across YOY records"
  },
  {
    name: "common_month",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Common month across YOY records"
  },

  // Status for comparison
  {
    name: "status_this_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Event status in this year (current row)"
  },
  {
    name: "common_status",
    type: "STRING",
    mode: "NULLABLE",
    description: "Normalized status for comparison"
  },
  {
    name: "source_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Year from which the source data is drawn"
  },

  // --- Added Missing Fields Below ---

  // This year/last year event timing and date breakdowns
  {
    name: "earliest_start_date_this_year",
    type: "DATE",
    mode: "NULLABLE",
    description: "Earliest start date for the event this year"
  },
  {
    name: "year_this_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Year for this year's event"
  },
  {
    name: "month_this_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Month for this year's event"
  },
  {
    name: "weekday_this_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Weekday for this year's event"
  },
  {
    name: "day_this_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Day of month for this year's event"
  },
  {
    name: "earliest_start_date_last_year",
    type: "DATE",
    mode: "NULLABLE",
    description: "Earliest start date for last year's event"
  },
  {
    name: "month_last_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Month for last year's event"
  },
  {
    name: "weekday_last_year",
    type: "STRING",
    mode: "NULLABLE",
    description: "Weekday for last year's event"
  },
  {
    name: "day_last_year",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Day of month for last year's event"
  },

  // Year-over-year timing shift
  {
    name: "day_diff",
    type: "INTEGER",
    mode: "NULLABLE",
    description: "Difference in days between this and last year's event"
  },
  {
    name: "month_match",
    type: "STRING",
    mode: "NULLABLE",
    description: "Whether event month matched year-over-year"
  },

  // Timestamps
  {
    name: "created_at",
    type: "DATETIME",
    mode: "NULLABLE",
    description: "Created at timestamp in Mountain time"
  }
];

module.exports = { event_data_metrics_yoy_match_schema };

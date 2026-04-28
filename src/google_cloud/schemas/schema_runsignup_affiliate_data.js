// all_runsignup_affiliate_data_schema.js

const main = [
  {
    name: "query_label",
    mode: "NULLABLE",
    type: "STRING",
    description: "Static query label carried with each row",
    fields: []
  },
  {
    name: "race_id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "RunSignup race_id",
    fields: []
  },
  {
    name: "comparison_status",
    mode: "NULLABLE",
    type: "STRING",
    description: "Comparison result between usat_event_id_member_settings and usat_sanction_id_internal",
    fields: []
  },
  {
    name: "is_possible_exception",
    mode: "NULLABLE",
    type: "STRING",
    description: "Manual exception note based on race-level review logic",
    fields: []
  },
  {
    name: "date_match",
    mode: "NULLABLE",
    type: "STRING",
    description: "Date comparison category between race_next_date and usat_match_date",
    fields: []
  },
  {
    name: "url",
    mode: "NULLABLE",
    type: "STRING",
    description: "RunSignup registration URL",
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
    name: "usat_registration_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "USAT registration URL carried in the affiliate URL table",
    fields: []
  },
  {
    name: "registration_url_final_rule",
    mode: "NULLABLE",
    type: "STRING",
    description: "Rule used to determine the final registration URL selection",
    fields: []
  },
  {
    name: "registration_url_final",
    mode: "NULLABLE",
    type: "STRING",
    description: "Final selected registration URL",
    fields: []
  },
  {
    name: "registration_url_affiliate_final",
    mode: "NULLABLE",
    type: "STRING",
    description: "Final selected registration URL with affiliate token appended when applicable",
    fields: []
  },
  {
    name: "registration_url_affiliate_final_char_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Character count of the final affiliate registration URL",
    fields: []
  },
  {
    name: "event_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event type value carried in the affiliate URL table",
    fields: []
  },
  {
    name: "setting_name_member_settings",
    mode: "NULLABLE",
    type: "STRING",
    description: "Membership setting name from RunSignup member settings logic",
    fields: []
  },
  {
    name: "membership_settings_source_member_settings",
    mode: "NULLABLE",
    type: "STRING",
    description: "Source indicator for the membership settings value",
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
    name: "address_state",
    mode: "NULLABLE",
    type: "STRING",
    description: "Race address state",
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
    name: "race_next_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Race next date formatted as YYYY-MM-DD",
    fields: []
  },
  {
    name: "race_next_year_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from race_next_date",
    fields: []
  },
  {
    name: "race_next_month_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from race_next_date",
    fields: []
  },
  {
    name: "usat_event_id_member_settings",
    mode: "NULLABLE",
    type: "STRING",
    description: "USAT event id captured from RunSignup member settings",
    fields: []
  },
  {
    name: "usat_sanction_id_internal",
    mode: "NULLABLE",
    type: "STRING",
    description: "Matched internal USAT sanction id",
    fields: []
  },
  {
    name: "registration_url_final_sanction_id",
    mode: "NULLABLE",
    type: "STRING",
    description: "registration_url_final_sanction_id",
    fields: []
  },
  {
    name: "usat_match_name",
    mode: "NULLABLE",
    type: "STRING",
    description: "Matched USAT event name",
    fields: []
  },
  {
    name: "usat_match_state",
    mode: "NULLABLE",
    type: "STRING",
    description: "Matched USAT state",
    fields: []
  },
  {
    name: "usat_match_city",
    mode: "NULLABLE",
    type: "STRING",
    description: "Matched USAT city",
    fields: []
  },
  {
    name: "usat_match_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Matched USAT event date formatted as YYYY-MM-DD",
    fields: []
  },
  {
    name: "usat_match_year_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from usat_match_date",
    fields: []
  },
  {
    name: "usat_match_month_date",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from usat_match_date",
    fields: []
  },
  {
    name: "match_method",
    mode: "NULLABLE",
    type: "STRING",
    description: "Method used to generate the internal USAT match",
    fields: []
  },
  {
    name: "match_score_internal",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Internal match score for the selected USAT match",
    fields: []
  },
  {
    name: "race_count_distinct",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Distinct race count value included in the extract",
    fields: []
  },
  {
    name: "row_count_total",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Total row count value included in the extract",
    fields: []
  },
  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row creation timestamp in Mountain Time",
    fields: []
  },
  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "DATETIME",
    description: "Row creation timestamp in UTC",
    fields: []
  }
];

module.exports = {
  all_runsignup_affiliate_match_schema: main
};
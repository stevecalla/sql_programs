// all_trifind_data_schema.js

const main = [
  // PRIMARY KEY
  {
    name: "id",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Auto-increment primary key from local MySQL extract table",
    fields: []
  },

  // LISTING-LEVEL
  {
    name: "seq",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Sequential row number assigned during the streaming extract",
    fields: []
  },

  {
    name: "title",
    mode: "NULLABLE",
    type: "STRING",
    description: "Event title scraped from the Trifind listing page",
    fields: []
  },
  {
    name: "url",
    mode: "NULLABLE",
    type: "STRING",
    description: "Trifind event detail page URL",
    fields: []
  },
  {
    name: "event_date",
    mode: "NULLABLE",
    type: "DATE",
    description: "Event date normalized to YYYY-MM-DD from the Trifind listing page",
    fields: []
  },

  {
    name: "event_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Year extracted from event_date",
    fields: []
  },
  {
    name: "event_month",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Month extracted from event_date",
    fields: []
  },

  {
    name: "city",
    mode: "NULLABLE",
    type: "STRING",
    description: "City parsed from the Trifind listing location",
    fields: []
  },
  {
    name: "state",
    mode: "NULLABLE",
    type: "STRING",
    description: "State parsed from the Trifind listing location",
    fields: []
  },
  {
    name: "location",
    mode: "NULLABLE",
    type: "STRING",
    description: "Full location string scraped from the Trifind listing page",
    fields: []
  },

  {
    name: "race_type",
    mode: "NULLABLE",
    type: "STRING",
    description: "Sport or race type bucket used in the Trifind custom search",
    fields: []
  },
  {
    name: "is_canceled",
    mode: "NULLABLE",
    type: "STRING",
    description: "Canceled flag derived from the event title (Yes/No)",
    fields: []
  },
  {
    name: "is_duplicate_listing",
    mode: "NULLABLE",
    type: "STRING",
    description: "Duplicate listing flag based on the scraper dedupe key (Yes/No)",
    fields: []
  },

  // DETAIL-LEVEL
  {
    name: "register_now_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "Register Now URL found on the Trifind event detail page",
    fields: []
  },
  {
    name: "visit_race_website_url",
    mode: "NULLABLE",
    type: "STRING",
    description: "Visit Race Website URL found on the Trifind event detail page",
    fields: []
  },

  {
    name: "usat_link",
    mode: "NULLABLE",
    type: "STRING",
    description: "USAT-related link found on the event detail page when present",
    fields: []
  },
  {
    name: "usat_link_text",
    mode: "NULLABLE",
    type: "STRING",
    description: "Anchor text associated with the USAT link on the event detail page",
    fields: []
  },
  {
    name: "usat_sanction_number",
    mode: "NULLABLE",
    type: "STRING",
    description: "USAT sanction number best-effort extracted from the USAT link URL",
    fields: []
  },
  {
    name: "is_usat_sanctioned",
    mode: "NULLABLE",
    type: "STRING",
    description: "USAT sanctioned flag based on detection of a qualifying USAT link (Yes/No)",
    fields: []
  },

  {
    name: "previous_results_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: "Count of previous results years detected on the Trifind event detail page",
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

module.exports = { all_trifind_data_schema: main };
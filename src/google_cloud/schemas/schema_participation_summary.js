// BigQuery schema for all_participation_data_with_membership_match_summary (reporting pre-aggregate).
// One row per (year, month, geo_level, geo_key); month is NULL for the annual roll-up.
const participation_summary_schema = [
  { "name": "start_date_year_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start year", "fields": [] },
  { "name": "start_date_month_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start month (NULL = annual total)", "fields": [] },
  { "name": "geo_level", "mode": "NULLABLE", "type": "STRING", "description": "'state' or 'region'", "fields": [] },
  { "name": "geo_key", "mode": "NULLABLE", "type": "STRING", "description": "Event state code or region name", "fields": [] },
  { "name": "turnout", "mode": "NULLABLE", "type": "INTEGER", "description": "Participations (COUNT id_rr)", "fields": [] },
  { "name": "events", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct events", "fields": [] },
  { "name": "races", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct races", "fields": [] },
  { "name": "adult", "mode": "NULLABLE", "type": "INTEGER", "description": "Adult participations (age bin >= 20)", "fields": [] },
  { "name": "adult_events", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct events among adults", "fields": [] },
  { "name": "adult_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct races among adults", "fields": [] },
  { "name": "female", "mode": "NULLABLE", "type": "INTEGER", "description": "Female participations", "fields": [] },
  { "name": "male", "mode": "NULLABLE", "type": "INTEGER", "description": "Male participations", "fields": [] },
  { "name": "age_4_19", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 4-19", "fields": [] },
  { "name": "age_20_29", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 20-29", "fields": [] },
  { "name": "age_30_39", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 30-39", "fields": [] },
  { "name": "age_40_49", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 40-49", "fields": [] },
  { "name": "age_50_59", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 50-59", "fields": [] },
  { "name": "age_60_plus", "mode": "NULLABLE", "type": "INTEGER", "description": "Age band 60+", "fields": [] },
  { "name": "home", "mode": "NULLABLE", "type": "INTEGER", "description": "In-state (state) / in-region (region) participations; away = turnout - home - unknown_home_count", "fields": [] },
  { "name": "unknown_home_count", "mode": "NULLABLE", "type": "INTEGER", "description": "Home state missing or not one of the 50 states (not placeable as home/away); home + away + unknown = turnout", "fields": [] },
  { "name": "ironman", "mode": "NULLABLE", "type": "INTEGER", "description": "IRONMAN participations", "fields": [] },
  { "name": "new_count", "mode": "NULLABLE", "type": "INTEGER", "description": "New athletes (created_year)", "fields": [] },
  { "name": "unique_athletes", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct athletes (id_profiles)", "fields": [] },
  { "name": "created_at_mtn", "mode": "NULLABLE", "type": "DATETIME", "description": "Source data build timestamp (Mountain), carried from the parent participation table", "fields": [] },
  { "name": "created_at_utc", "mode": "NULLABLE", "type": "DATETIME", "description": "Source data build timestamp (UTC), carried from the parent participation table", "fields": [] },
];

module.exports = {
  participation_summary_schema,
};

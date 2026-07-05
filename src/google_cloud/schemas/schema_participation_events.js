// BigQuery schema for all_participation_data_with_membership_match_events (reporting pre-aggregate).
// One row per (year, month, sanctioning event); month is NULL for the annual roll-up. Carries the event's
// name/city/state/region, ZIP5 + map-pin lat/lng, and the same metric set as the summary table.
const participation_events_schema = [
  { "name": "start_date_year_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start year", "fields": [] },
  { "name": "start_date_month_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start month (NULL = annual total)", "fields": [] },
  { "name": "event_id", "mode": "NULLABLE", "type": "INTEGER", "description": "id_sanctioning_events", "fields": [] },
  { "name": "event_name", "mode": "NULLABLE", "type": "STRING", "description": "Event name", "fields": [] },
  { "name": "event_city", "mode": "NULLABLE", "type": "STRING", "description": "Event city", "fields": [] },
  { "name": "event_state", "mode": "NULLABLE", "type": "STRING", "description": "Event state code", "fields": [] },
  { "name": "region_name", "mode": "NULLABLE", "type": "STRING", "description": "Event region", "fields": [] },
  { "name": "zip5", "mode": "NULLABLE", "type": "STRING", "description": "Event ZIP (5-digit)", "fields": [] },
  { "name": "event_date", "mode": "NULLABLE", "type": "DATE", "description": "Event start date (MAX start_date_races)", "fields": [] },
  { "name": "away", "mode": "NULLABLE", "type": "INTEGER", "description": "Participations from out-of-state athletes (member state in US, <> event state)", "fields": [] },
  { "name": "turnout", "mode": "NULLABLE", "type": "INTEGER", "description": "Participations (COUNT id_rr)", "fields": [] },
  { "name": "events", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct events (id_events)", "fields": [] },
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
  { "name": "home", "mode": "NULLABLE", "type": "INTEGER", "description": "In-state participations (member state = event state)", "fields": [] },
  { "name": "ironman", "mode": "NULLABLE", "type": "INTEGER", "description": "IRONMAN participations", "fields": [] },
  { "name": "new_count", "mode": "NULLABLE", "type": "INTEGER", "description": "New athletes (created_year)", "fields": [] },
  { "name": "unique_athletes", "mode": "NULLABLE", "type": "INTEGER", "description": "Distinct athletes (id_profiles)", "fields": [] },
  { "name": "lat", "mode": "NULLABLE", "type": "FLOAT", "description": "Event latitude (ZIP5 centroid; ZIP3 fallback)", "fields": [] },
  { "name": "lng", "mode": "NULLABLE", "type": "FLOAT", "description": "Event longitude (ZIP5 centroid; ZIP3 fallback)", "fields": [] },
];

module.exports = {
  participation_events_schema,
};

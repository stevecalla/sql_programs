// BigQuery schema for all_participation_data_with_membership_match_flows (reporting cross-state flows).
// One row per (year, month, home_state, event_state); month is NULL for the annual roll-up.
const participation_flows_schema = [
  { "name": "start_date_year_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start year", "fields": [] },
  { "name": "start_date_month_races", "mode": "NULLABLE", "type": "INTEGER", "description": "Race start month (NULL = annual total)", "fields": [] },
  { "name": "home_state", "mode": "NULLABLE", "type": "STRING", "description": "Athlete home state (member_state_code_addresses)", "fields": [] },
  { "name": "event_state", "mode": "NULLABLE", "type": "STRING", "description": "Event state (state_code_events)", "fields": [] },
  { "name": "participations", "mode": "NULLABLE", "type": "INTEGER", "description": "Cross-state participations (home != event)", "fields": [] },
];

module.exports = {
  participation_flows_schema,
};

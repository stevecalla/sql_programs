/**
 * db.js — pull event data from usat_sales_db.event_data_metrics
 *
 * Returns rows used by:
 *   - the events loader (positional arrays — see src/loader.js)
 *   - the step_5_creation_pipeline sheet ({yr,type,mo,cnt} objects)
 *
 * The events SELECT intentionally aliases two columns to id_sanctioning_events,
 * exactly like the CSV did, so we use rowsAsArray: true to read by index.
 *
 * Column positions (0-indexed) for the events query — must match src/loader.js:
 *   0  created_at_events            (YYYY-MM-DD string)
 *   1  name_events                  (quotes stripped)
 *   2  id_sanctioning_events        (real sanction ID e.g. "354767-Youth Clinic")
 *   3  starts_year_events
 *   4  status_events
 *   5  name_event_type
 *   6  starts_events                (YYYY-MM-DD string — dateStrings: true)
 *   7  registration_url
 *   8  id_sanctioning_events        (race count, ignored downstream)
 *   9  id_races
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Load .env from project root (sql_programs/.env) regardless of cwd.
// __dirname = sql_programs/src/event_analysis/src  →  3 levels up to root.
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../../utilities/config');

/**
 * Build the SELECT for a single starts_year_events value.
 */
function events_sql(year) {
  return `
    SELECT
        DATE_FORMAT(created_at_events, "%Y-%m-%d") AS created_at_events,
        REPLACE(name_events, '"', '') AS name_events,
        id_sanctioning_events,
        starts_year_events,
        status_events,
        name_event_type,
        starts_events,
        registration_url,
        COUNT(DISTINCT(id_sanctioning_events), 0) AS id_sanctioning_events,
        COUNT(DISTINCT(id_races), 0) AS id_races
    FROM event_data_metrics
    WHERE 1 = 1
        AND starts_year_events = ${Number(year)}
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
    ORDER BY created_at_events DESC
  `;
}

/**
 * Build the SELECT for the creation-pipeline sheet.
 */
function creation_sql(year) {
  return `
    SELECT
        created_at_year_events,
        name_event_type,
        created_at_month_events,
        COUNT(DISTINCT(id_sanctioning_events), 0) AS event_count
    FROM event_data_metrics
    WHERE 1 = 1
        AND starts_year_events = ${Number(year)}
    GROUP BY 1, 2, 3
    ORDER BY created_at_year_events DESC, event_count DESC, created_at_month_events
  `;
}

/**
 * Open a single connection to usat_sales_db, run the events query for every
 * requested year, and return a map { year: rows[] } where each row is a
 * positional array.
 */
async function fetch_events_for_years(years) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection({ ...cfg, dateStrings: true });
  try {
    const out = {};
    for (const y of years) {
      const [rows] = await conn.query({ sql: events_sql(y), rowsAsArray: true });
      out[y] = rows;
    }
    return out;
  } finally {
    await conn.end();
  }
}

/**
 * Open a single connection to usat_sales_db, run the creation-pipeline query
 * for every requested year, and return a map { year: rows[] } where each
 * row is already in the canonical { yr, type, mo, cnt } shape.
 */
async function fetch_creation_for_years(years) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try {
    const out = {};
    for (const y of years) {
      const [rows] = await conn.query(creation_sql(y));
      out[y] = rows.map(r => ({
        yr:   parseInt(r.created_at_year_events, 10),
        type: r.name_event_type,
        mo:   parseInt(r.created_at_month_events, 10),
        cnt:  parseInt(r.event_count, 10),
      }));
    }
    return out;
  } finally {
    await conn.end();
  }
}

/**
 * Look up event names + start month for a small set of sanction IDs in a
 * specific year. Used by /api/overrides to enrich each override row with
 * the human-readable event name(s) so the editor can show "311655-Adult
 * Race · Alpha Win Sarasota FL" instead of the bare sid.
 *
 * Returns a Map<sanction_id, { name, month }>. Sanction IDs not found in
 * the DB are simply absent from the map (the caller renders a fallback).
 *
 * Designed for the override list — typically dozens of rows, never
 * thousands — so a single IN (?) clause is fine. Skips silently when
 * `sids` is empty so callers can do `if (!sids.length) return new Map()`
 * without a special case at the call site.
 */
async function fetch_event_names_for_sids({ year, sids }) {
  const map = new Map();
  if (!year || !sids || !sids.length) return map;
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection({ ...cfg, dateStrings: true });
  try {
    const [rows] = await conn.query(
      `SELECT id_sanctioning_events AS sid,
              REPLACE(name_events, '"', '') AS name,
              MONTH(starts_events) AS m
         FROM event_data_metrics
        WHERE starts_year_events = ?
          AND id_sanctioning_events IN (?)
        GROUP BY 1, 2, 3`,
      [Number(year), sids]
    );
    for (const r of rows) {
      // First-seen wins — same sid can appear in multiple rows because of
      // the duplicated id_sanctioning_events alias in events_sql(); the
      // GROUP BY collapses most duplicates but a defensive Map.has() avoids
      // a later row clobbering an earlier one with a stale value.
      if (!map.has(r.sid)) map.set(r.sid, { name: r.name, month: r.m });
    }
    return map;
  } finally {
    await conn.end();
  }
}

module.exports = {
  fetch_events_for_years,
  fetch_creation_for_years,
  fetch_event_names_for_sids,
  events_sql,
  creation_sql,
};

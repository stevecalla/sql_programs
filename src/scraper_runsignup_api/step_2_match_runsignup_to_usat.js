/**
 * step_2_match_runsignup_to_usat.js
 *
 * Match RunSignup rows to USAT event_data_metrics using:
 * - race_name -> USAT name_events
 * - state
 * - preferred month window (month ± 1)
 * - city boost
 *
 * Notes
 * -----
 * - RunSignup race_name is treated as the primary event title for matching.
 * - RunSignup event_name is intentionally not used in the score.
 * - No USAT-number exact match path exists here because RunSignup does not provide it.
 * - Before matching, this script resets prior match-result fields on the RunSignup table.
 */

const dotenv = require("dotenv");
dotenv.config({ path: "../..//.env" });

const mysqlP = require("mysql2/promise");
const fuzzball = require("fuzzball");

const { local_usat_sales_db_config } = require("../../utilities/config");
const { runTimer, stopTimer } = require("../../utilities/timer");

// ----------------------------------------
// Config
// ----------------------------------------
const SCORE_THRESHOLD = 75;
const UPDATE_BATCH_SIZE = 500;
const RUNSIGNUP_PAGE_SIZE = 500;

const CURRENT_YEAR = new Date().getFullYear();
const MIN_EVENT_YEAR = 2000;
const MAX_EVENT_YEAR = CURRENT_YEAR + 1;

const RUNSIGNUP_TABLE = "all_runsignup_data_raw";
const USAT_TABLE = "event_data_metrics";

// ----------------------------------------
// Test controls
// ----------------------------------------
const TEST_MODE = false;
const TEST_YEAR = CURRENT_YEAR;
const TEST_ROW_LIMIT = 100;

// ----------------------------------------
// Helpers
// ----------------------------------------
function safe_string(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function strip_wrapping_quotes(value) {
  const s = safe_string(value);
  if (!s) return "";
  return s.replace(/^"(.*)"$/, "$1").trim();
}

function normalize_title(value) {
  return safe_string(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize_city(value) {
  return safe_string(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function get_score_bin(score) {
  const s = Number(score) || 0;
  if (s <= 69) return "0–69";
  if (s <= 79) return "70–79";
  if (s <= 89) return "80–89";
  if (s <= 94) return "90–94";
  return "95–100";
}

function get_state_month_key(state_code, month) {
  return `${state_code}__${month}`;
}

function to_nullable_int(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

function to_nullable_tinyint(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value) ? 1 : 0;
}

function to_nullable_mysql_date(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, 10);
}

function parse_date_only_to_epoch_days(value) {
  const s = to_nullable_mysql_date(value);
  if (!s) return null;

  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return null;

  return Math.floor(t / 86400000);
}

function date_diff_days(date_a, date_b) {
  const a = parse_date_only_to_epoch_days(date_a);
  const b = parse_date_only_to_epoch_days(date_b);

  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

async function get_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection({
    ...cfg,
    dateStrings: true,
  });
}

// ----------------------------------------
// Indexes
// ----------------------------------------
async function ensure_index(connection, table_name, index_name, create_sql) {
  const sql = `
    SELECT COUNT(*) AS index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND index_name = ?
  `;

  const [rows] = await connection.execute(sql, [table_name, index_name]);
  const exists = Number(rows[0]?.index_count || 0) > 0;

  if (!exists) {
    await connection.execute(create_sql);
    console.log(`created index ${index_name} on ${table_name}`);
  } else {
    console.log(`index already exists: ${index_name}`);
  }
}

async function ensure_indexes(connection) {
  await ensure_index(
    connection,
    RUNSIGNUP_TABLE,
    "idx_runsignup_event_year_id",
    `
      CREATE INDEX idx_runsignup_event_year_id
      ON \`${RUNSIGNUP_TABLE}\` (event_year, id)
    `
  );

  await ensure_index(
    connection,
    RUNSIGNUP_TABLE,
    "idx_runsignup_event_year_state_month",
    `
      CREATE INDEX idx_runsignup_event_year_state_month
      ON \`${RUNSIGNUP_TABLE}\` (event_year, address_state, event_month, id)
    `
  );

  await ensure_index(
    connection,
    USAT_TABLE,
    "idx_event_metrics_year_state",
    `
      CREATE INDEX idx_event_metrics_year_state
      ON \`${USAT_TABLE}\` (starts_year_events, region_state_code)
    `
  );

  await ensure_index(
    connection,
    USAT_TABLE,
    "idx_event_metrics_year_start",
    `
      CREATE INDEX idx_event_metrics_year_start
      ON \`${USAT_TABLE}\` (starts_year_events, starts_events, id_events)
    `
  );
}

async function ensure_column(connection, table_name, column_name, column_definition) {
  const sql = `
    SELECT COUNT(*) AS column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
  `;

  const [rows] = await connection.execute(sql, [table_name, column_name]);
  const exists = Number(rows[0]?.column_count || 0) > 0;

  if (!exists) {
    await connection.execute(`
      ALTER TABLE \`${table_name}\`
      ADD COLUMN ${column_name} ${column_definition}
    `);
    console.log(`created column ${column_name} on ${table_name}`);
  } else {
    console.log(`column already exists: ${column_name}`);
  }
}

async function ensure_match_columns(connection) {
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_name", "VARCHAR(255) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_state", "VARCHAR(10) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_city", "VARCHAR(255) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_date", "DATE NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_month", "INT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_match_year", "INT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_event_id_internal", "VARCHAR(50) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_sanction_id_internal", "VARCHAR(50) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_status_internal", "VARCHAR(100) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_event_type_internal", "TEXT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "usat_race_type_internal", "TEXT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "match_method", "VARCHAR(50) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "match_score_internal", "INT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "name_score_internal", "INT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "date_diff_days_internal", "INT NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "city_match_flag_internal", "TINYINT(1) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "matched_by_score", "TINYINT(1) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "matched_usat_sanctioned", "TINYINT(1) NULL");
  await ensure_column(connection, RUNSIGNUP_TABLE, "score_bin_internal", "VARCHAR(20) NULL");
}

// ----------------------------------------
// Reset prior match fields
// ----------------------------------------
async function reset_match_fields(connection) {
  const sql = `
    UPDATE \`${RUNSIGNUP_TABLE}\`
    SET
      usat_match_name = NULL,
      usat_match_state = NULL,
      usat_match_city = NULL,
      usat_match_date = NULL,
      usat_match_month = NULL,
      usat_match_year = NULL,
      usat_event_id_internal = NULL,
      usat_sanction_id_internal = NULL,
      usat_status_internal = NULL,
      usat_event_type_internal = NULL,
      usat_race_type_internal = NULL,
      match_method = NULL,
      match_score_internal = NULL,
      name_score_internal = NULL,
      date_diff_days_internal = NULL,
      city_match_flag_internal = NULL,
      matched_by_score = NULL,
      matched_usat_sanctioned = NULL,
      score_bin_internal = NULL
  `;

  const [result] = await connection.execute(sql);
  console.log(`reset prior match fields on ${RUNSIGNUP_TABLE}; affected rows: ${result.affectedRows}`);
}

// ----------------------------------------
// Load years
// ----------------------------------------
async function load_runsignup_years(connection) {
  if (TEST_MODE) {
    return [TEST_YEAR];
  }

  const sql = `
    SELECT DISTINCT event_year
    FROM \`${RUNSIGNUP_TABLE}\`
    WHERE event_year IS NOT NULL
      AND event_year >= ?
      AND event_year <= ?
    ORDER BY event_year
  `;

  const [rows] = await connection.execute(sql, [MIN_EVENT_YEAR, MAX_EVENT_YEAR]);

  return rows
    .map((row) => Number(row.event_year))
    .filter((year) => Number.isInteger(year));
}

async function count_runsignup_rows_for_year(connection, target_year) {
  let sql = `
    SELECT COUNT(*) AS row_count
    FROM \`${RUNSIGNUP_TABLE}\`
    WHERE event_year = ?
      AND COALESCE(LOWER(TRIM(event_type)), '') <> 'expo'
  `;

  const params = [target_year];

  if (TEST_MODE) {
    sql = `
      SELECT LEAST(COUNT(*), ?) AS row_count
      FROM \`${RUNSIGNUP_TABLE}\`
      WHERE event_year = ?
        AND COALESCE(LOWER(TRIM(event_type)), '') <> 'expo'
    `;
    params.splice(0, params.length, Number(TEST_ROW_LIMIT), target_year);
  }

  const [rows] = await connection.execute(sql, params);
  return Number(rows[0]?.row_count || 0);
}

// ----------------------------------------
// Load data
// ----------------------------------------
async function load_runsignup_rows_page(connection, target_year, offset, limit) {
  const safe_limit = Math.max(0, Number.parseInt(limit, 10) || 0);
  const safe_offset = Math.max(0, Number.parseInt(offset, 10) || 0);

  const sql = `
    SELECT
      id,
      race_id,
      event_id,
      race_name,
      event_name,
      distance,
      address_city,
      address_state,
      race_next_date,
      event_start_time,
      event_month,
      event_year
    FROM \`${RUNSIGNUP_TABLE}\`
    WHERE event_year = ?
      AND COALESCE(LOWER(TRIM(event_type)), '') <> 'expo'
    ORDER BY id
    LIMIT ${safe_limit}
    OFFSET ${safe_offset}
  `;

  const [rows] = await connection.execute(sql, [target_year]);

  return rows.map((row) => {
    const event_date = to_nullable_mysql_date(row.event_start_time || row.race_next_date);

    return {
      id: row.id,
      race_id: row.race_id,
      event_id: row.event_id,
      race_name: row.race_name,
      event_name: row.event_name,
      distance: row.distance,
      address_city: row.address_city,
      address_state: safe_string(row.address_state).toUpperCase(),
      event_date,
      event_month:
        row.event_month === null || row.event_month === undefined
          ? null
          : Number(row.event_month),
      event_year:
        row.event_year === null || row.event_year === undefined
          ? null
          : Number(row.event_year),
      race_name_norm: normalize_title(row.race_name),
      city_norm: normalize_city(row.address_city),
    };
  });
}

async function load_usat_event_rows(connection, target_year) {
  const min_target_year = Number(target_year) - 1;
  const max_target_year = Number(target_year) + 1;

  const sql = `
    WITH event_level AS (
      SELECT
        CAST(id_events AS CHAR) AS id_events,
        CAST(MAX(id_sanctioning_events) AS CHAR) AS id_sanctioning_events,
        MAX(name_events) AS name_events,
        MAX(starts_events) AS starts_events,
        MAX(status_events) AS status_events,
        MAX(region_state_code) AS region_state_code,
        MAX(state_code_events) AS state_code_events,
        MAX(city_events) AS city_events,
        GROUP_CONCAT(DISTINCT name_event_type ORDER BY name_event_type SEPARATOR ' | ') AS name_event_type,
        GROUP_CONCAT(DISTINCT name_race_type ORDER BY name_race_type SEPARATOR ' | ') AS name_race_type
      FROM \`${USAT_TABLE}\`
      WHERE starts_year_events BETWEEN ? AND ?
      GROUP BY id_events
    )
    SELECT
      id_events,
      id_sanctioning_events,
      name_events,
      starts_events,
      status_events,
      region_state_code,
      state_code_events,
      city_events,
      name_event_type,
      name_race_type,
      MONTH(starts_events) AS usat_month,
      YEAR(starts_events) AS usat_year
    FROM event_level
    ORDER BY starts_events, id_events
  `;

  const [rows] = await connection.execute(sql, [min_target_year, max_target_year]);

  return rows.map((row) => ({
    id_events: row.id_events,
    id_sanctioning_events: row.id_sanctioning_events,
    name_events: row.name_events,
    starts_events: row.starts_events,
    status_events: row.status_events,
    region_state_code: row.region_state_code,
    state_code_events: row.state_code_events,
    city_events: row.city_events,
    name_event_type: row.name_event_type,
    name_race_type: row.name_race_type,
    usat_month: row.usat_month,
    usat_year: row.usat_year,
    state_match_code: safe_string(
      row.region_state_code || row.state_code_events
    ).toUpperCase(),
    city_norm: normalize_city(row.city_events),
    name_norm: normalize_title(row.name_events),
  }));
}

// ----------------------------------------
// Lookup maps
// ----------------------------------------
function build_usat_lookup_maps(usat_rows) {
  const state_groups = new Map();
  const state_month_groups = new Map();

  for (const row of usat_rows) {
    if (!row.state_match_code) continue;

    if (!state_groups.has(row.state_match_code)) {
      state_groups.set(row.state_match_code, []);
    }
    state_groups.get(row.state_match_code).push(row);

    if (row.usat_month !== null && row.usat_month !== undefined) {
      const key = get_state_month_key(row.state_match_code, Number(row.usat_month));

      if (!state_month_groups.has(key)) {
        state_month_groups.set(key, []);
      }
      state_month_groups.get(key).push(row);
    }
  }

  return {
    state_groups,
    state_month_groups,
  };
}

// ----------------------------------------
// Match logic
// ----------------------------------------
function get_preferred_candidates(runsignup_row, lookup_maps) {
  const state_code = runsignup_row.address_state;
  const rs_month = runsignup_row.event_month;

  if (!state_code) {
    return { candidates: [], match_method: null };
  }

  if (rs_month !== null) {
    const month_candidates = [];

    for (const month of [rs_month - 1, rs_month, rs_month + 1]) {
      if (month < 1 || month > 12) continue;

      const key = get_state_month_key(state_code, month);
      const rows = lookup_maps.state_month_groups.get(key) || [];

      if (rows.length) {
        month_candidates.push(...rows);
      }
    }

    if (month_candidates.length) {
      return {
        candidates: month_candidates,
        match_method: "state_month_pm_1",
      };
    }
  }

  return {
    candidates: lookup_maps.state_groups.get(state_code) || [],
    match_method: "state_only",
  };
}

function score_candidate(runsignup_row, candidate) {
  let name_score = 0;

  if (runsignup_row.race_name_norm && candidate.name_norm) {
    name_score = fuzzball.ratio(runsignup_row.race_name_norm, candidate.name_norm);
  }

  let adjusted_score = name_score;

  const diff_days = date_diff_days(runsignup_row.event_date, candidate.starts_events);

  if (diff_days !== null) {
    if (diff_days === 0) adjusted_score += 8;
    else if (diff_days <= 3) adjusted_score += 5;
    else if (diff_days <= 7) adjusted_score += 3;
    else if (diff_days <= 14) adjusted_score += 1;
    else if (diff_days > 45) adjusted_score -= 8;
    else if (diff_days > 21) adjusted_score -= 4;
  }

  const city_match =
    runsignup_row.city_norm &&
    candidate.city_norm &&
    runsignup_row.city_norm === candidate.city_norm;

  if (city_match) adjusted_score += 4;

  adjusted_score = Math.max(0, Math.min(100, adjusted_score));

  return {
    score: adjusted_score,
    name_score,
    diff_days,
    city_match,
  };
}

function get_best_candidate(runsignup_row, candidates) {
  let best = null;
  let best_score = 0;
  let best_name_score = 0;
  let best_diff_days = null;
  let best_city_match = false;

  if (!runsignup_row.race_name_norm || !Array.isArray(candidates) || candidates.length === 0) {
    return {
      best,
      score: best_score,
      name_score: best_name_score,
      diff_days: best_diff_days,
      city_match: best_city_match,
    };
  }

  for (const candidate of candidates) {
    if (!candidate.name_norm) continue;

    const scored = score_candidate(runsignup_row, candidate);

    if (
      scored.score > best_score ||
      (
        scored.score === best_score &&
        (best_diff_days === null || (scored.diff_days !== null && scored.diff_days < best_diff_days))
      )
    ) {
      best = candidate;
      best_score = scored.score;
      best_name_score = scored.name_score;
      best_diff_days = scored.diff_days;
      best_city_match = scored.city_match;
    }
  }

  return {
    best,
    score: best_score,
    name_score: best_name_score,
    diff_days: best_diff_days,
    city_match: best_city_match,
  };
}

function build_match_result(runsignup_row, lookup_maps) {
  const { candidates, match_method } = get_preferred_candidates(
    runsignup_row,
    lookup_maps
  );

  let best = null;
  let score = 0;
  let name_score = 0;
  let diff_days = null;
  let city_match = false;

  if (candidates.length && runsignup_row.race_name_norm) {
    const result = get_best_candidate(runsignup_row, candidates);
    best = result.best;
    score = result.score;
    name_score = result.name_score;
    diff_days = result.diff_days;
    city_match = result.city_match;
  }

  const matched_by_score = score >= SCORE_THRESHOLD;

  return {
    id: runsignup_row.id,
    usat_match_name: best ? strip_wrapping_quotes(best.name_events) : null,
    usat_match_state: best ? best.state_match_code : null,
    usat_match_city: best ? strip_wrapping_quotes(best.city_events) : null,
    usat_match_date: best ? best.starts_events : null,
    usat_match_month: best ? best.usat_month : null,
    usat_match_year: best ? best.usat_year : null,
    usat_event_id_internal: best ? best.id_events : null,
    usat_sanction_id_internal: best ? best.id_sanctioning_events : null,
    usat_status_internal: best ? best.status_events : null,
    usat_event_type_internal: best ? best.name_event_type : null,
    usat_race_type_internal: best ? best.name_race_type : null,
    match_method,
    match_score_internal: score,
    name_score_internal: name_score,
    date_diff_days_internal: diff_days,
    city_match_flag_internal: city_match ? 1 : 0,
    matched_by_score: matched_by_score ? 1 : 0,
    matched_usat_sanctioned: matched_by_score ? 1 : 0,
    score_bin_internal: get_score_bin(score),
  };
}

// ----------------------------------------
// Update
// ----------------------------------------
async function update_batch(connection, rows) {
  if (!rows.length) return;

  const sql = `
    UPDATE \`${RUNSIGNUP_TABLE}\`
    SET
      usat_match_name = ?,
      usat_match_state = ?,
      usat_match_city = ?,
      usat_match_date = ?,
      usat_match_month = ?,
      usat_match_year = ?,
      usat_event_id_internal = ?,
      usat_sanction_id_internal = ?,
      usat_status_internal = ?,
      usat_event_type_internal = ?,
      usat_race_type_internal = ?,
      match_method = ?,
      match_score_internal = ?,
      name_score_internal = ?,
      date_diff_days_internal = ?,
      city_match_flag_internal = ?,
      matched_by_score = ?,
      matched_usat_sanctioned = ?,
      score_bin_internal = ?
    WHERE id = ?
  `;

  await connection.beginTransaction();

  try {
    for (const row of rows) {
      await connection.execute(sql, [
        safe_string(row.usat_match_name) || null,
        safe_string(row.usat_match_state) || null,
        safe_string(row.usat_match_city) || null,
        to_nullable_mysql_date(row.usat_match_date),
        to_nullable_int(row.usat_match_month),
        to_nullable_int(row.usat_match_year),
        safe_string(row.usat_event_id_internal) || null,
        safe_string(row.usat_sanction_id_internal) || null,
        safe_string(row.usat_status_internal) || null,
        safe_string(row.usat_event_type_internal) || null,
        safe_string(row.usat_race_type_internal) || null,
        safe_string(row.match_method) || null,
        to_nullable_int(row.match_score_internal),
        to_nullable_int(row.name_score_internal),
        to_nullable_int(row.date_diff_days_internal),
        to_nullable_tinyint(row.city_match_flag_internal),
        to_nullable_tinyint(row.matched_by_score),
        to_nullable_tinyint(row.matched_usat_sanctioned),
        safe_string(row.score_bin_internal) || null,
        row.id,
      ]);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

// ----------------------------------------
// Main
// ----------------------------------------
async function main() {
  const connection = await get_connection();

  connection.on("error", (err) => {
    console.error("⚠️ MySQL connection error:", err);
  });

  runTimer("timer");
  let result = "runsignup match failed";

  try {
    console.log("step_0: ensure required indexes exist");
    await ensure_indexes(connection);

    console.log("step_0a: ensure required match columns exist");
    await ensure_match_columns(connection);

    console.log("step_0b: reset prior match fields");
    await reset_match_fields(connection);

    console.log("step_1: load distinct valid runsignup years");
    const runsignup_years = await load_runsignup_years(connection);
    console.log(`distinct runsignup years: ${runsignup_years.join(", ")}`);

    let grand_total_runsignup_rows = 0;
    let grand_total_matched_rows = 0;

    console.log("step_2: loop runsignup years and process each year");

    for (const target_year of runsignup_years) {
      console.log(`\nprocessing year: ${target_year}`);

      console.log(`step_2a: count runsignup rows for ${target_year}`);
      const year_row_count = await count_runsignup_rows_for_year(connection, target_year);
      console.log(`runsignup rows to process: ${year_row_count}`);

      if (!year_row_count) {
        console.log(`no runsignup rows found for ${target_year}, skipping`);
        continue;
      }

      console.log(`step_2b: load usat event rows for ${target_year}`);
      const usat_rows = await load_usat_event_rows(connection, target_year);
      console.log(`loaded usat event rows: ${usat_rows.length}`);

      console.log(`step_2c: build lookup maps for ${target_year}`);
      const lookup_maps = build_usat_lookup_maps(usat_rows);
      console.log(
        `lookup sizes: states=${lookup_maps.state_groups.size}, state_months=${lookup_maps.state_month_groups.size}`
      );

      console.log(`step_2d: page runsignup rows, match, and update for ${target_year}`);

      let processed_count = 0;
      let year_matched_count = 0;
      let year_fuzzy_count = 0;

      while (processed_count < year_row_count) {
        const remaining_count = year_row_count - processed_count;
        const page_size = Math.min(RUNSIGNUP_PAGE_SIZE, remaining_count);

        const runsignup_rows_page = await load_runsignup_rows_page(
          connection,
          target_year,
          processed_count,
          page_size
        );

        if (!runsignup_rows_page.length) {
          break;
        }

        const pending_updates = [];

        for (const runsignup_row of runsignup_rows_page) {
          const match_result = build_match_result(runsignup_row, lookup_maps);
          pending_updates.push(match_result);

          if (match_result.matched_usat_sanctioned === 1) {
            year_matched_count += 1;
          }

          if (
            match_result.match_method === "state_month_pm_1" ||
            match_result.match_method === "state_only"
          ) {
            year_fuzzy_count += 1;
          }
        }

        for (let i = 0; i < pending_updates.length; i += UPDATE_BATCH_SIZE) {
          const update_slice = pending_updates.slice(i, i + UPDATE_BATCH_SIZE);
          await update_batch(connection, update_slice);
        }

        processed_count += runsignup_rows_page.length;
        console.log(`processed ${processed_count} / ${year_row_count} for ${target_year}`);
      }

      grand_total_runsignup_rows += year_row_count;
      grand_total_matched_rows += year_matched_count;

      console.log(`step_2e: completed year ${target_year}`);
      console.log({
        target_year,
        total_runsignup_rows: year_row_count,
        matched_usat_sanctioned_true: year_matched_count,
        fuzzy_attempt_rows: year_fuzzy_count,
        score_threshold: SCORE_THRESHOLD,
      });
    }

    console.log("step_3: build final summary");

    console.log("\nstep_4: complete");
    console.log({
      total_years_processed: runsignup_years.length,
      grand_total_runsignup_rows,
      grand_total_matched_rows,
      score_threshold: SCORE_THRESHOLD,
      min_event_year: MIN_EVENT_YEAR,
      max_event_year: MAX_EVENT_YEAR,
      test_mode: TEST_MODE,
      test_year: TEST_YEAR,
      test_row_limit: TEST_ROW_LIMIT,
      runsignup_page_size: RUNSIGNUP_PAGE_SIZE,
    });

    result = "runsignup match successful";
  } catch (error) {
    console.error("runsignup match failed:", error);
    throw error;
  } finally {
    try {
      await connection.end();
      console.log("✅ db connection closed.");
    } catch (close_error) {
      console.warn("error during cleanup:", close_error);
    }

    stopTimer("timer");
  }

  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("error during runsignup usat match:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  execute_match_runsignup_to_usat: main,
};
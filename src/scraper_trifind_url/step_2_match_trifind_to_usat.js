/**
 * step_2_match_trifind_to_usat.js
 *
 * See notes.txt for description of code
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
const SCORE_THRESHOLD = 80;
const UPDATE_BATCH_SIZE = 500;
const TRIFIND_PAGE_SIZE = 500;

const CURRENT_YEAR = new Date().getFullYear();
const MIN_EVENT_YEAR = 2000;
const MAX_EVENT_YEAR = CURRENT_YEAR + 1;

const TRIFIND_TABLE = "all_trifind_data_raw";
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
const us_state_to_abbrev = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
};

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
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truthy_yes(value) {
  const s = safe_string(value).toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1";
}

function get_state_abbrev(value) {
  const raw = safe_string(value);
  if (!raw) return "";
  if (raw.length === 2) return raw.toUpperCase();
  return us_state_to_abbrev[raw] || raw.toUpperCase();
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
    TRIFIND_TABLE,
    "idx_trifind_year_id",
    `
      CREATE INDEX idx_trifind_year_id
      ON \`${TRIFIND_TABLE}\` (event_year, id)
    `
  );

  await ensure_index(
    connection,
    USAT_TABLE,
    "idx_event_metrics_year_sanction_event",
    `
      CREATE INDEX idx_event_metrics_year_sanction_event
      ON \`${USAT_TABLE}\` (starts_year_events, id_sanctioning_events, id_events)
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
  await ensure_column(connection, TRIFIND_TABLE, "usat_match_name", "VARCHAR(255) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_match_state", "VARCHAR(10) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_match_date", "DATE NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_match_month", "INT NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_match_year", "INT NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_event_id_internal", "VARCHAR(50) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_sanction_id_internal", "VARCHAR(50) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_status_internal", "VARCHAR(100) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_event_type_internal", "TEXT NULL");
  await ensure_column(connection, TRIFIND_TABLE, "usat_race_type_internal", "TEXT NULL");
  await ensure_column(connection, TRIFIND_TABLE, "match_method", "VARCHAR(50) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "match_score_internal", "INT NULL");
  await ensure_column(connection, TRIFIND_TABLE, "matched_by_flag", "TINYINT(1) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "matched_by_score", "TINYINT(1) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "matched_usat_sanctioned", "TINYINT(1) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "sanction_discrepancy_flag", "TINYINT(1) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "reason_for_sanction", "VARCHAR(50) NULL");
  await ensure_column(connection, TRIFIND_TABLE, "score_bin_internal", "VARCHAR(20) NULL");
}

// ----------------------------------------
// Load years
// ----------------------------------------
async function load_trifind_years(connection) {
  if (TEST_MODE) {
    return [TEST_YEAR];
  }

  const sql = `
    SELECT DISTINCT event_year
    FROM \`${TRIFIND_TABLE}\`
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

async function count_trifind_rows_for_year(connection, target_year) {
  let sql = `
    SELECT COUNT(*) AS row_count
    FROM \`${TRIFIND_TABLE}\`
    WHERE event_year = ?
  `;

  const params = [target_year];

  if (TEST_MODE) {
    sql = `
      SELECT LEAST(COUNT(*), ?) AS row_count
      FROM \`${TRIFIND_TABLE}\`
      WHERE event_year = ?
    `;
    params.splice(0, params.length, Number(TEST_ROW_LIMIT), target_year);
  }

  const [rows] = await connection.execute(sql, params);
  return Number(rows[0]?.row_count || 0);
}

// ----------------------------------------
// Load data
// ----------------------------------------
async function load_trifind_rows_page(connection, target_year, offset, limit) {
  const safe_limit = Math.max(0, Number.parseInt(limit, 10) || 0);
  const safe_offset = Math.max(0, Number.parseInt(offset, 10) || 0);

  const sql = `
    SELECT
      id,
      title,
      event_date,
      event_year,
      event_month,
      state,
      is_usat_sanctioned,
      usat_event_id_number
    FROM \`${TRIFIND_TABLE}\`
    WHERE event_year = ?
    ORDER BY id
    LIMIT ${safe_limit}
    OFFSET ${safe_offset}
  `;

  const [rows] = await connection.execute(sql, [target_year]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    event_date: row.event_date,
    event_year: row.event_year,
    event_month: row.event_month,
    state: row.state,
    is_usat_sanctioned: row.is_usat_sanctioned,
    usat_event_id_number: row.usat_event_id_number,
    state_abbrev: get_state_abbrev(row.state),
    title_norm: normalize_title(row.title),
    tf_month:
      row.event_month === null || row.event_month === undefined
        ? null
        : Number(row.event_month),
    trifind_usat_event_id_raw: safe_string(row.usat_event_id_number),
  }));
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
      WHERE 1 = 1
        AND starts_year_events BETWEEN ? AND ?
        -- starts_year_events = ?
        -- AND id_sanctioning_events IS NOT NULL
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
  // const [rows] = await connection.execute(sql, [target_year]);

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
    name_norm: normalize_title(row.name_events),
    usat_event_id_raw: safe_string(row.id_events),
  }));
}

// ----------------------------------------
// Lookup maps
// ----------------------------------------
function build_usat_lookup_maps(usat_rows) {
  const usat_by_event_id = new Map();
  const state_groups = new Map();
  const state_month_groups = new Map();

  for (const row of usat_rows) {
    if (row.usat_event_id_raw && !usat_by_event_id.has(row.usat_event_id_raw)) {
      usat_by_event_id.set(row.usat_event_id_raw, row);
    }

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
    usat_by_event_id,
    state_groups,
    state_month_groups,
  };
}

// ----------------------------------------
// Match logic
// ----------------------------------------
function get_best_candidate(title_norm, candidates) {
  let best = null;
  let score = 0;

  if (!title_norm || !Array.isArray(candidates) || candidates.length === 0) {
    return { best, score };
  }

  for (const candidate of candidates) {
    if (!candidate.name_norm) continue;

    const current_score = fuzzball.ratio(title_norm, candidate.name_norm);

    if (current_score > score) {
      score = current_score;
      best = candidate;
    }
  }

  return { best, score };
}

function get_preferred_candidates(trifind_row, lookup_maps) {
  const state_code = trifind_row.state_abbrev;
  const tf_month = trifind_row.tf_month;

  if (!state_code) {
    return { candidates: [], match_method: null };
  }

  if (tf_month !== null) {
    const month_candidates = [];

    for (const month of [tf_month - 1, tf_month, tf_month + 1]) {
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

function build_match_result(trifind_row, lookup_maps) {
  let best = null;
  let score = 0;
  let match_method = null;

  if (
    trifind_row.trifind_usat_event_id_raw &&
    lookup_maps.usat_by_event_id.has(trifind_row.trifind_usat_event_id_raw)
  ) {
    best = lookup_maps.usat_by_event_id.get(trifind_row.trifind_usat_event_id_raw);
    score = 100;
    match_method = "usat_event_id_exact";
  } else {
    const { candidates, match_method: candidate_method } = get_preferred_candidates(
      trifind_row,
      lookup_maps
    );

    match_method = candidate_method;

    if (candidates.length && trifind_row.title_norm) {
      const fuzzy_match = get_best_candidate(trifind_row.title_norm, candidates);
      best = fuzzy_match.best;
      score = fuzzy_match.score;
    }
  }

  const matched_by_flag = truthy_yes(trifind_row.is_usat_sanctioned);
  const matched_by_score = score >= SCORE_THRESHOLD;
  const matched_usat_sanctioned = matched_by_flag || matched_by_score;
  const sanction_discrepancy_flag = matched_by_flag !== matched_by_score;

  let reason_for_sanction = "neither";
  if (matched_by_flag && matched_by_score) reason_for_sanction = "flag_and_score";
  else if (matched_by_flag && !matched_by_score) reason_for_sanction = "flag_only";
  else if (!matched_by_flag && matched_by_score) reason_for_sanction = "score_only";

  return {
    id: trifind_row.id,
    usat_match_name: best ? strip_wrapping_quotes(best.name_events) : null,
    usat_match_state: best ? best.state_match_code : null,
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
    matched_by_flag: matched_by_flag ? 1 : 0,
    matched_by_score: matched_by_score ? 1 : 0,
    matched_usat_sanctioned: matched_usat_sanctioned ? 1 : 0,
    sanction_discrepancy_flag: sanction_discrepancy_flag ? 1 : 0,
    reason_for_sanction,
    score_bin_internal: get_score_bin(score),
  };
}

// ----------------------------------------
// Update
// ----------------------------------------
async function update_batch(connection, rows) {
  if (!rows.length) return;

  const sql = `
    UPDATE \`${TRIFIND_TABLE}\`
    SET
      usat_match_name = ?,
      usat_match_state = ?,
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
      matched_by_flag = ?,
      matched_by_score = ?,
      matched_usat_sanctioned = ?,
      sanction_discrepancy_flag = ?,
      reason_for_sanction = ?,
      score_bin_internal = ?
    WHERE id = ?
  `;

  await connection.beginTransaction();

  try {
    for (const row of rows) {
      await connection.execute(sql, [
        safe_string(row.usat_match_name) || null,
        safe_string(row.usat_match_state) || null,
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
        to_nullable_tinyint(row.matched_by_flag),
        to_nullable_tinyint(row.matched_by_score),
        to_nullable_tinyint(row.matched_usat_sanctioned),
        to_nullable_tinyint(row.sanction_discrepancy_flag),
        safe_string(row.reason_for_sanction) || null,
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
  let result = "trifind match failed";

  try {
    console.log("step_0: ensure required indexes exist");
    await ensure_indexes(connection);

    console.log("step_0a: ensure required match columns exist");
    await ensure_match_columns(connection);

    console.log("step_1: load distinct valid trifind years");
    const trifind_years = await load_trifind_years(connection);
    console.log(`distinct trifind years: ${trifind_years.join(", ")}`);

    let grand_total_trifind_rows = 0;
    let grand_total_matched_rows = 0;

    console.log("step_2: loop trifind years and process each year");

    for (const target_year of trifind_years) {
      console.log(`\nprocessing year: ${target_year}`);

      console.log(`step_2a: count trifind rows for ${target_year}`);
      const year_row_count = await count_trifind_rows_for_year(connection, target_year);
      console.log(`trifind rows to process: ${year_row_count}`);

      if (!year_row_count) {
        console.log(`no trifind rows found for ${target_year}, skipping`);
        continue;
      }

      console.log(`step_2b: load usat sanctioned event rows for ${target_year}`);
      const usat_rows = await load_usat_event_rows(connection, target_year);
      console.log(`loaded usat event rows: ${usat_rows.length}`);

      console.log(`step_2c: build lookup maps for ${target_year}`);
      const lookup_maps = build_usat_lookup_maps(usat_rows);
      console.log(
        `lookup sizes: event_ids=${lookup_maps.usat_by_event_id.size}, states=${lookup_maps.state_groups.size}, state_months=${lookup_maps.state_month_groups.size}`
      );

      console.log(`step_2d: page trifind rows, match, and update for ${target_year}`);

      let processed_count = 0;
      let year_matched_count = 0;
      let year_exact_count = 0;
      let year_fuzzy_count = 0;

      while (processed_count < year_row_count) {
        const remaining_count = year_row_count - processed_count;
        const page_size = Math.min(TRIFIND_PAGE_SIZE, remaining_count);

        const trifind_rows_page = await load_trifind_rows_page(
          connection,
          target_year,
          processed_count,
          page_size
        );

        if (!trifind_rows_page.length) {
          break;
        }

        const pending_updates = [];

        for (const trifind_row of trifind_rows_page) {
          const match_result = build_match_result(trifind_row, lookup_maps);
          pending_updates.push(match_result);

          if (match_result.matched_usat_sanctioned === 1) {
            year_matched_count += 1;
          }

          if (match_result.match_method === "usat_event_id_exact") {
            year_exact_count += 1;
          } else if (
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

        processed_count += trifind_rows_page.length;

        console.log(`processed ${processed_count} / ${year_row_count} for ${target_year}`);
      }

      grand_total_trifind_rows += year_row_count;
      grand_total_matched_rows += year_matched_count;

      console.log(`step_2e: completed year ${target_year}`);
      console.log({
        target_year,
        total_trifind_rows: year_row_count,
        matched_usat_sanctioned_true: year_matched_count,
        exact_sanction_matches: year_exact_count,
        fuzzy_attempt_rows: year_fuzzy_count,
        score_threshold: SCORE_THRESHOLD,
      });
    }

    console.log("step_3: build final summary");

    console.log("\nstep_4: complete");
    console.log({
      total_years_processed: trifind_years.length,
      grand_total_trifind_rows,
      grand_total_matched_rows,
      score_threshold: SCORE_THRESHOLD,
      min_event_year: MIN_EVENT_YEAR,
      max_event_year: MAX_EVENT_YEAR,
      test_mode: TEST_MODE,
      test_year: TEST_YEAR,
      test_row_limit: TEST_ROW_LIMIT,
      trifind_page_size: TRIFIND_PAGE_SIZE,
    });

    result = "trifind match successful";
  } catch (error) {
    console.error("trifind match failed:", error);
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
    console.error("error during trifind usat match:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  execute_match_trifind_to_usat: main,
};
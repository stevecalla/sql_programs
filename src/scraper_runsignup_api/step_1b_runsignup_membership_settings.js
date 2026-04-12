/**
 * C:\Users\calla\development\usat\sql_programs\src\scraper_runsignup_api\step_1b_runsignup_membership_settings.js
 *
 * Purpose
 * -------
 * After step_1a populates all_runsignup_data_raw, this step:
 * 1. Adds selected membership-setting columns if they do not already exist
 * 2. Pulls distinct race_id values from all_runsignup_data_raw
 * 3. Optionally filters by one or more event_type values
 * 4. Calls RunSignup get_race API for each race_id
 * 5. Extracts the selected membership setting fields
 * 6. Updates all rows in all_runsignup_data_raw for that race_id
 *
 * Selected fields stored
 * ----------------------
 * - setting_id_member_settings
 * - setting_name_member_settings
 * - user_notice_member_settings
 * - usatf_specific_member_settings
 * - usat_specific_member_settings
 * - usat_event_id_member_settings
 * - usat_external_validation_member_settings
 * - usat_one_day_license_required_member_settings
 * - require_first_registrant_waiver_member_settings
 * - ussa_specific_member_settings
 * - usac_specific_member_settings
 *
 * Testing
 * -------
 * To test a single race only:
 *   node step_1b_runsignup_membership_settings.js
 *
 * And set:
 *   TEST_SINGLE_RACE = true
 *   TEST_RACE_ID = 137876
 */

const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const mysqlP = require("mysql2/promise");
const { local_usat_sales_db_config } = require("../../utilities/config");
const { runTimer, stopTimer } = require("../../utilities/timer");

const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../utilities/date_time_tools/get_mountain_time_offset_hours");

// ----------------------------------------
// Config
// ----------------------------------------
const TABLE_NAME = "all_runsignup_data_raw";
const API_BASE = "https://api.runsignup.com/rest/race";

const RUNSIGNUP_API_KEY = process.env.RUNSIGNUP_API_KEY || null;
const RUNSIGNUP_API_SECRET = process.env.RUNSIGNUP_API_SECRET || null;

// Test controls
const TEST_SINGLE_RACE = false;
let TEST_RACE_ID;
TEST_RACE_ID = 137876;
TEST_RACE_ID = 125531;
TEST_RACE_ID = 71789;
TEST_RACE_ID = 8255;
TEST_RACE_ID = 14439;

// Limit number of race_ids processed
const IS_TEST_LIMIT = false;
const TEST_LIMIT_RACE_IDS = IS_TEST_LIMIT ? 10 : null; // set to null to disable

// Optional narrowing by event type(s)
// Example: ['triathlon'] or ['triathlon', 'duathlon']
// Empty array means do not filter
const EVENT_TYPES_TO_INCLUDE = ['aqua_bike', 'duathlon', 'triathlon', 'Aquathlon'];

// API pacing
const THROTTLE_MS = 250;

// ----------------------------------------
// Helpers
// ----------------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function as_string(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function as_bool_flag(x) {
  if (x === true || x === "T" || x === "true" || x === "True") return 1;
  if (x === false || x === "F" || x === "false" || x === "False") return 0;
  return null;
}

async function get_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function get_modified_at_dates() {
  // Batch timestamps (UTC → MTN via offset fn)
  const now_utc = new Date();
  const mtn_offset_hours = get_mountain_time_offset_hours(now_utc);
  const now_mtn = new Date(now_utc.getTime() + mtn_offset_hours * 60 * 60 * 1000);

  // IMPORTANT: strings for MySQL DATETIME columns
  const last_modified_utc_member_settings = to_mysql_datetime(now_utc);
  const last_modified_mtn_member_settings = to_mysql_datetime(now_mtn);

  return {
    last_modified_utc_member_settings,
    last_modified_mtn_member_settings,
  };
}

function format_duration_ms_local(ms) {
  const total_seconds = Math.floor(ms / 1000);
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor((total_seconds % 3600) / 60);
  const seconds = total_seconds % 60;

  return [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ].filter(Boolean).join(' ');
}

// ----------------------------------------
// Schema setup
// ----------------------------------------
async function column_exists(connection, tableName, columnName) {
  const sql = `
    SELECT 1 AS column_exists
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE 1 = 1
      AND TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
  `;

  const [rows] = await connection.execute(sql, [tableName, columnName]);
  return rows.length > 0;
}

async function add_column_if_missing(connection, tableName, columnName, columnDefinition, afterColumn = null) {
  const exists = await column_exists(connection, tableName, columnName);

  if (exists) {
    console.log("Column already exists: " + columnName);
    return;
  }

  let sql = `
    ALTER TABLE \`${tableName}\`
    ADD COLUMN \`${columnName}\` ${columnDefinition}
  `;

  if (afterColumn) {
    const after_exists = await column_exists(connection, tableName, afterColumn);

    if (after_exists) {
      sql += ` AFTER \`${afterColumn}\``;
    }
  }

  console.log("Adding column: " + columnName + (afterColumn ? ` AFTER ${afterColumn}` : ""));
  await connection.execute(sql);
}

async function ensure_membership_columns(connection, tableName) {
  const columns = [
    ["setting_id_member_settings", "BIGINT NULL"],
    ["setting_name_member_settings", "VARCHAR(255) NULL"],
    ["user_notice_member_settings", "TEXT NULL"],

    ["usatf_specific_member_settings", "TINYINT NULL"],
    ["usat_specific_member_settings", "TINYINT NULL"],
    ["usat_event_id_member_settings", "VARCHAR(100) NULL"],
    ["usat_external_validation_member_settings", "TINYINT NULL"],
    ["usat_one_day_license_required_member_settings", "TINYINT NULL"],
    ["require_first_registrant_waiver_member_settings", "TINYINT NULL"],
    ["ussa_specific_member_settings", "TINYINT NULL"],
    ["usac_specific_member_settings", "TINYINT NULL"],

    // QA / diagnostic fields
    ["membership_settings_count_member_settings", "INT NULL"],
    ["has_multiple_membership_settings_member_settings", "TINYINT NULL"],
    ["has_conflicting_usat_event_ids_member_settings", "TINYINT NULL"],
    ["has_conflicting_usat_specific_flags_member_settings", "TINYINT NULL"],
    ["distinct_usat_event_ids_csv_member_settings", "TEXT NULL"],
    ["membership_settings_source_member_settings", "VARCHAR(50) NULL"],

    ["last_modified_utc_member_settings", "DATETIME NULL"],
    ["last_modified_mtn_member_settings", "DATETIME NULL"],
  ];

  let previousColumn = "event_registration_periods_json";

  for (const [columnName, columnDefinition] of columns) {
    await add_column_if_missing(
      connection,
      tableName,
      columnName,
      columnDefinition,
      previousColumn
    );

    previousColumn = columnName;
  }
}

// ----------------------------------------
// Race selection
// ----------------------------------------
async function get_target_race_ids(connection, tableName, event_types = [], test_race_id = null) {
  if (test_race_id !== null && test_race_id !== undefined) {
    return [Number(test_race_id)];
  }

  let sql = `
    SELECT DISTINCT race_id
    FROM \`${tableName}\`
    WHERE 1 = 1
      AND race_id IS NOT NULL
  `;
  const params = [];

  if (Array.isArray(event_types) && event_types.length > 0) {
    const placeholders = event_types.map(() => "?").join(",");
    sql += `
      AND event_type IN (${placeholders})
    `;
    params.push(...event_types);
  }

  sql += `
    ORDER BY race_id
  `;

  const [rows] = await connection.execute(sql, params);

  return rows
    .map((row) => row.race_id)
    .filter((race_id) => race_id !== null && race_id !== undefined);
}

async function get_query_counts_by_event_type(connection, tableName, event_types = []) {
  let sql = `
    SELECT
      event_type,
      COUNT(DISTINCT race_id) AS race_count
    FROM \`${tableName}\`
    WHERE 1 = 1
      AND race_id IS NOT NULL
  `;

  const params = [];

  if (Array.isArray(event_types) && event_types.length > 0) {
    const placeholders = event_types.map(() => "?").join(",");
    sql += `
      AND event_type IN (${placeholders})
    `;
    params.push(...event_types);
  }

  sql += `
    GROUP BY event_type
    ORDER BY race_count DESC
  `;

  const [rows] = await connection.execute(sql, params);

  return rows;
}

// ----------------------------------------
// API fetch
// ----------------------------------------
async function fetch_race_membership_settings({
  race_id,
  event_types = [],
  api_key,
  api_secret,
}) {
  const params = new URLSearchParams({
    format: "json",
    events: "T",
    include_membership_settings: "T",
  });

  if (Array.isArray(event_types) && event_types.length > 0) {
    for (const event_type of event_types) {
      params.append("event_type", String(event_type));
    }
  }

  if (api_key && api_secret) {
    params.set("api_key", api_key);
    params.set("api_secret", api_secret);
  }

  const url = `${API_BASE}/${race_id}?${params.toString()}`;
  console.log(`Fetching race membership settings for race_id=${race_id}`);
  console.log(`URL: ${url}`);

  const controller = new AbortController();
  const timeout_id = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
      );
      err.status = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clearTimeout(timeout_id);
  }
}

// ----------------------------------------
// Transform
// Here is the full updated extract_membership_payload() function with:
// ✅ Race-level FIRST (only if valid USAT)
// ✅ Fallback to event-level
// ✅ Event-level dedupe
// ✅ QA flags
// ✅ membership_settings_source_member_settings
// ✅ No undefined values (safe for SQL)
// ----------------------------------------
function extract_membership_payload(api_response) {
  const race = api_response?.race || null;

  let membership_settings = [];
  let membership_source = null;

  // --------------------------------------------------
  // 1) Check race-level FIRST (only if valid USAT)
  // --------------------------------------------------
  const race_level_settings = Array.isArray(race?.membership_settings)
    ? race.membership_settings
    : [];

  const valid_race_level = race_level_settings.find(
    (s) =>
      (s?.usat_specific === "T" || s?.usat_specific === true) &&
      s?.usat_event_id
  );

  if (valid_race_level) {
    membership_settings = [valid_race_level];
    membership_source = "race_level";
  }

  // --------------------------------------------------
  // 2) Otherwise fallback to event-level
  // --------------------------------------------------
  else if (Array.isArray(race?.events)) {
    const all_event_settings = race.events.flatMap((event) =>
      Array.isArray(event?.membership_settings) ? event.membership_settings : []
    );

    if (all_event_settings.length > 0) {
      // Dedupe event-level settings
      const seen = new Map();

      for (const s of all_event_settings) {
        const dedupe_key = [
          as_string(s?.membership_setting_name),
          as_string(s?.usat_event_id),
          as_bool_flag(s?.usat_specific),
          as_bool_flag(s?.usatf_specific),
          as_bool_flag(s?.ussa_specific),
          as_bool_flag(s?.usac_specific),
        ].join("|");

        if (!seen.has(dedupe_key)) {
          seen.set(dedupe_key, s);
        }
      }

      membership_settings = Array.from(seen.values());
      membership_source = "event_level";
    }
  }

  // --------------------------------------------------
  // 3) Final fallback (nothing found)
  // --------------------------------------------------
  if (membership_settings.length === 0) {
    membership_source = "none";
  }

  // --------------------------------------------------
  // 4) Select best setting
  // --------------------------------------------------
  const selected_setting =
    membership_settings.find(
      (s) => s?.usat_specific === "T" || s?.usat_specific === true
    ) ||
    membership_settings[0] ||
    null;

  // --------------------------------------------------
  // 5) QA / diagnostics
  // --------------------------------------------------
  const distinct_usat_event_ids = [
    ...new Set(
      membership_settings
        .map((s) => as_string(s?.usat_event_id))
        .filter(Boolean)
    ),
  ];

  const distinct_usat_specific_flags = [
    ...new Set(
      membership_settings
        .map((s) => as_bool_flag(s?.usat_specific))
        .filter((v) => v !== null)
    ),
  ];

  const membership_settings_count = membership_settings.length;

  const has_multiple_membership_settings =
    membership_settings.length > 1 ? 1 : 0;

  const has_conflicting_usat_event_ids =
    distinct_usat_event_ids.length > 1 ? 1 : 0;

  const has_conflicting_usat_specific_flags =
    distinct_usat_specific_flags.length > 1 ? 1 : 0;

  // --------------------------------------------------
  // 6) Return payload (NO undefined values)
  // --------------------------------------------------
  return {
    setting_id_member_settings: selected_setting?.membership_setting_id ?? null,
    setting_name_member_settings: as_string(selected_setting?.membership_setting_name),
    user_notice_member_settings: as_string(selected_setting?.user_notice),

    usatf_specific_member_settings: as_bool_flag(selected_setting?.usatf_specific),
    usat_specific_member_settings: as_bool_flag(selected_setting?.usat_specific),
    usat_event_id_member_settings: as_string(selected_setting?.usat_event_id),
    usat_external_validation_member_settings: as_bool_flag(selected_setting?.usat_external_validation),
    usat_one_day_license_required_member_settings: as_bool_flag(selected_setting?.usat_one_day_license_required),
    require_first_registrant_waiver_member_settings: as_bool_flag(selected_setting?.require_first_registrant_waiver),
    ussa_specific_member_settings: as_bool_flag(selected_setting?.ussa_specific),
    usac_specific_member_settings: as_bool_flag(selected_setting?.usac_specific),

    // QA fields
    membership_settings_count_member_settings: membership_settings_count,
    has_multiple_membership_settings_member_settings: has_multiple_membership_settings,
    has_conflicting_usat_event_ids_member_settings: has_conflicting_usat_event_ids,
    has_conflicting_usat_specific_flags_member_settings: has_conflicting_usat_specific_flags,
    distinct_usat_event_ids_csv_member_settings: distinct_usat_event_ids.join(", "),
    membership_settings_source_member_settings: membership_source || "none",
  };
}

// ----------------------------------------
// DB update
// ----------------------------------------
async function update_race_membership_fields(connection, tableName, race_id, payload) {
  const {
    last_modified_utc_member_settings,
    last_modified_mtn_member_settings,
  } = await get_modified_at_dates();

  const sql = `
    UPDATE \`${tableName}\`
    SET
      setting_id_member_settings = ?,
      setting_name_member_settings = ?,
      user_notice_member_settings = ?,

      usatf_specific_member_settings = ?,
      usat_specific_member_settings = ?,
      usat_event_id_member_settings = ?,
      usat_external_validation_member_settings = ?,
      usat_one_day_license_required_member_settings = ?,
      require_first_registrant_waiver_member_settings = ?,
      ussa_specific_member_settings = ?,
      usac_specific_member_settings = ?,

      membership_settings_count_member_settings = ?,
      has_multiple_membership_settings_member_settings = ?,
      has_conflicting_usat_event_ids_member_settings = ?,
      has_conflicting_usat_specific_flags_member_settings = ?,
      distinct_usat_event_ids_csv_member_settings = ?,
      membership_settings_source_member_settings = ?,

      last_modified_utc_member_settings = ?,
      last_modified_mtn_member_settings = ?
    WHERE race_id = ?
  `;

  const params = [
    payload.setting_id_member_settings,
    payload.setting_name_member_settings,
    payload.user_notice_member_settings,

    payload.usatf_specific_member_settings,
    payload.usat_specific_member_settings,
    payload.usat_event_id_member_settings,
    payload.usat_external_validation_member_settings,
    payload.usat_one_day_license_required_member_settings,
    payload.require_first_registrant_waiver_member_settings,
    payload.ussa_specific_member_settings,
    payload.usac_specific_member_settings,

    payload.membership_settings_count_member_settings,
    payload.has_multiple_membership_settings_member_settings,
    payload.has_conflicting_usat_event_ids_member_settings,
    payload.has_conflicting_usat_specific_flags_member_settings,
    payload.distinct_usat_event_ids_csv_member_settings,
    payload.membership_settings_source_member_settings,

    last_modified_utc_member_settings,
    last_modified_mtn_member_settings,

    race_id,
  ];

  const [result] = await connection.execute(sql, params);
  return result;
}

// ----------------------------------------
// Main
// ----------------------------------------
async function main(options = {}) {
  const {
    table_name = TABLE_NAME,
    event_types = EVENT_TYPES_TO_INCLUDE,
    test_race_id = TEST_SINGLE_RACE ? TEST_RACE_ID : null,
    throttle_ms = THROTTLE_MS,
  } = options;

  const connection = await get_connection();
  let result = "RunSignup membership enrichment failed";

  runTimer("timer");

  try {
    console.log("\nStarting step 1b - RunSignup membership enrichment.");

    // ----------------------------------------
    // PRE-FLIGHT: Query counts by event_type
    // ----------------------------------------
    const counts_by_event_type = await get_query_counts_by_event_type(
      connection,
      table_name,
      event_types
    );

    console.log("\n----------------------------------------");
    console.log("Planned API Calls (by event_type)");
    console.log("----------------------------------------");

    let total_queries = 0;

    for (const row of counts_by_event_type) {
      console.log(
        `event_type=${row.event_type} | distinct_race_ids=${row.race_count}`
      );
      total_queries += row.race_count;
    }

    console.log("----------------------------------------");
    console.log(`Total API Calls (distinct race_id): ${total_queries}`);
    const estimated_ms = total_queries * throttle_ms;
    console.log(`Estimated runtime: ${format_duration_ms_local(estimated_ms)}`);
    console.log("----------------------------------------\n");

    await ensure_membership_columns(connection, table_name);
    console.log("✅ Membership columns ensured.");

    let race_ids = await get_target_race_ids(
      connection,
      table_name,
      event_types,
      test_race_id
    );

    console.log(`Target race count (before limit): ${race_ids.length}`);

    // ----------------------------------------
    // TEST MODE: limit number of race_ids
    // ----------------------------------------
    // if (!test_race_id && TEST_LIMIT_RACE_IDS && TEST_LIMIT_RACE_IDS > 0) {
    if (IS_TEST_LIMIT && !test_race_id) {
      race_ids = race_ids
        .sort(() => Math.random() - 0.5)   // 🔥 randomize
        .slice(0, TEST_LIMIT_RACE_IDS);    // then limit

      console.log(
        `⚠️ TEST MODE ACTIVE → randomly sampling ${TEST_LIMIT_RACE_IDS} race_ids`
      );

      console.log("Sample race_ids:", race_ids.slice(0, 10));
    }

    console.log(`Final race_ids to process: ${race_ids.length}`);

    if (race_ids.length === 0) {
      console.log("No target race_ids found. Nothing to update.");
      result = "No race_ids found";
      return result;
    }

    let success_count = 0;
    let error_count = 0;
    let updated_row_total = 0;

    for (const race_id of race_ids) {
      try {
        const api_response = await fetch_race_membership_settings({
          race_id,
          event_types,
          api_key: RUNSIGNUP_API_KEY,
          api_secret: RUNSIGNUP_API_SECRET,
        });

        const payload = extract_membership_payload(api_response);

        console.log(`race_id=${race_id} setting_id_member_settings=${payload.setting_id_member_settings}`);
        console.log(`race_id=${race_id} setting_name_member_settings=${payload.setting_name_member_settings}`);
        console.log(`race_id=${race_id} usat_event_id_member_settings=${payload.usat_event_id_member_settings}`);
        console.log(`race_id=${race_id} membership_settings_count_member_settings=${payload.membership_settings_count_member_settings}`);
        console.log(`race_id=${race_id} has_multiple_membership_settings_member_settings=${payload.has_multiple_membership_settings_member_settings}`);
        console.log(`race_id=${race_id} has_conflicting_usat_event_ids_member_settings=${payload.has_conflicting_usat_event_ids_member_settings}`);
        console.log(`race_id=${race_id} has_conflicting_usat_specific_flags_member_settings=${payload.has_conflicting_usat_specific_flags_member_settings}`);
        console.log(`race_id=${race_id} distinct_usat_event_ids_csv_member_settings=${payload.distinct_usat_event_ids_csv_member_settings}`);
        console.log(`race_id=${race_id} membership_settings_source_member_settings=${payload.membership_settings_source_member_settings}`);

        const update_result = await update_race_membership_fields(
          connection,
          table_name,
          race_id,
          payload
        );

        const affected_rows = update_result?.affectedRows || 0;
        updated_row_total += affected_rows;
        success_count++;

        console.log(`✅ Updated race_id=${race_id}, affected_rows=${affected_rows}`);
      } catch (error) {
        error_count++;
        console.error(`❌ Failed for race_id=${race_id}:`, error.message);
      }

      await delay(throttle_ms);
    }

    console.log("\n----------------------------------------");
    console.log("Step 1b complete");
    console.log("----------------------------------------");
    console.log(`Success count: ${success_count}`);
    console.log(`Error count: ${error_count}`);
    console.log(`Total rows updated: ${updated_row_total}`);

    result = "RunSignup membership enrichment successful";
    return result;
  } catch (error) {
    console.error("Error in step 1b membership enrichment:", error);
    throw error;
  } finally {
    try {
      await connection.end();
      console.log("✅ DB connection closed.");
    } catch (closeErr) {
      console.warn("Error closing DB connection:", closeErr);
    }

    stopTimer("timer");
  }
}

if (require.main === module) {
  main({
    event_types: EVENT_TYPES_TO_INCLUDE,
    test_race_id: TEST_SINGLE_RACE ? TEST_RACE_ID : null,
    throttle_ms: THROTTLE_MS,
  }).catch((error) => {
    console.error("Fatal error running step_1b_runsignup_membership_settings:", error);
    process.exit(1);
  });
}

module.exports = {
  execute_step_1b_runsignup_membership_settings: main,
  ensure_membership_columns,
  get_target_race_ids,
  fetch_race_membership_settings,
  extract_membership_payload,
  update_race_membership_fields,
};
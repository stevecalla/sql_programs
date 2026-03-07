/**
 * scraper_runsignup_2026_streaming.js
 *
 * Memory-safe streaming export:
 * - Streams rows to Excel as pages are fetched (no giant arrays)
 * - Keeps only small summary maps in memory
 *
 * Run:
 *   node scraper_runsignup_2026_streaming.js
 *
 * Optional env:
 *   RUNSIGNUP_API_KEY=...
 *   RUNSIGNUP_API_SECRET=...
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const ExcelJS = require("exceljs");

const { create_directory } = require("../../utilities/createDirectory");

const API_BASE = "https://api.runsignup.com/rest/races";

const YEAR = 2026; // todo: adjust year as needed
const START_DATE = `${YEAR}-01-01`;
const END_DATE = `${YEAR}-12-31`;

// ✅ CHANGED: output directory now uses create_directory + desired structure
// - base directory: usat_runsignup_data
// - output folder:  excel_output
const output_base_directory_name = "usat_runsignup_data";
const output_subdirectory_name = "excel_output";
const output_file_name = `runsignup_ALL_${YEAR}_WIDE_STREAMING`;

const RUNSIGNUP_API_KEY = process.env.RUNSIGNUP_API_KEY || null;
const RUNSIGNUP_API_SECRET = process.env.RUNSIGNUP_API_SECRET || null;

// ✅ toggle race-only worksheet/rows
const ENABLE_RACE_ONLY = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensure_dir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function as_string(x) {
  if (x === null || x === undefined) return null;
  const s = String(x);
  return s.trim() ? s : null;
}

function as_bool_flag(x) {
  if (x === true || x === "T" || x === "true" || x === "True") return true;
  if (x === false || x === "F" || x === "false" || x === "False") return false;
  return null;
}

function parse_date_to_month_year(date_str) {
  if (!date_str) return { month: null, year: null };
  const d = new Date(date_str);
  if (Number.isNaN(d.getTime())) return { month: null, year: null };
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

function safe_json(x) {
  try {
    return JSON.stringify(x ?? null);
  } catch {
    return null;
  }
}

function normalize_address(race) {
  const addr = race?.address || null;
  return {
    address_street: as_string(addr?.street),
    address_street2: as_string(addr?.street2),
    address_city: as_string(addr?.city),
    address_state: as_string(addr?.state),
    address_zipcode: as_string(addr?.zipcode),
    address_country_code: as_string(addr?.country_code),
  };
}

function normalize_urls_and_social(race) {
  return {
    url: as_string(race?.url),
    external_race_url: as_string(race?.external_race_url),
    external_results_url: as_string(race?.external_results_url),
    fb_page_id: as_string(race?.fb_page_id),
    fb_event_id: as_string(race?.fb_event_id),
    logo_url: as_string(race?.logo_url),
  };
}

function normalize_race_dates(race) {
  const race_next_date = as_string(race?.next_date);
  const { month: race_month, year: race_year } = parse_date_to_month_year(
    race_next_date
  );

  return {
    race_last_date: as_string(race?.last_date),
    race_last_end_date: as_string(race?.last_end_date),
    race_next_date,
    race_next_end_date: as_string(race?.next_end_date),
    race_month,
    race_year,
  };
}

function normalize_event_dates(ev) {
  const event_start_time = as_string(ev?.start_time);
  const event_end_time = as_string(ev?.end_time);
  const event_registration_opens = as_string(ev?.registration_opens);

  const { month: event_month, year: event_year } = parse_date_to_month_year(
    event_start_time
  );
  const {
    month: event_registration_opens_month,
    year: event_registration_opens_year,
  } = parse_date_to_month_year(event_registration_opens);

  return {
    event_start_time,
    event_end_time,
    event_month,
    event_year,
    event_registration_opens,
    event_registration_opens_month,
    event_registration_opens_year,
  };
}

/**
 * Normalize "$" strings to numbers for Excel.
 */
function as_money_number(x) {
  if (x === null || x === undefined) return null;

  if (typeof x === "number") return Number.isFinite(x) ? x : null;

  const s = String(x).trim();
  if (!s) return null;

  const cleaned = s
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Registration periods vary by race.
 * Keep full JSON + best-effort pull of common fee/open/close fields.
 */
function extract_registration_period_summary(reg_periods) {
  const periods = Array.isArray(reg_periods) ? reg_periods : [];
  if (!periods.length) {
    return {
      event_registration_periods_json: "[]",
      event_race_fee: null,
      event_processing_fee: null,
      event_reg_opens: null,
      event_reg_closes: null,
    };
  }

  const p0 = periods[0] || {};

  const race_fee =
    p0?.race_fee ?? p0?.fee ?? p0?.base_fee ?? p0?.price ?? p0?.amount ?? null;

  const processing_fee =
    p0?.processing_fee ??
    p0?.proc_fee ??
    p0?.service_fee ??
    p0?.platform_fee ??
    null;

  const opens =
    p0?.registration_opens ??
    p0?.opens ??
    p0?.start_date ??
    p0?.start_time ??
    null;

  const closes =
    p0?.registration_closes ??
    p0?.closes ??
    p0?.end_date ??
    p0?.end_time ??
    null;

  return {
    event_registration_periods_json: safe_json(periods),
    event_race_fee: as_money_number(race_fee),
    event_processing_fee: as_money_number(processing_fee),
    event_reg_opens: as_string(opens),
    event_reg_closes: as_string(closes),
  };
}

async function fetch_races_page({ page, results_per_page }) {
  const params = new URLSearchParams({
    format: "json",
    events: "T",
    page: String(page),
    results_per_page: String(results_per_page),
    start_date: START_DATE,
    end_date: END_DATE,
  });

  if (RUNSIGNUP_API_KEY && RUNSIGNUP_API_SECRET) {
    params.set("api_key", RUNSIGNUP_API_KEY);
    params.set("api_secret", RUNSIGNUP_API_SECRET);
  }

  const url = `${API_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timeout_id = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
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

// -----------------------------
// Streaming Excel setup
// -----------------------------
const RACE_EVENT_COLUMNS = [
  "page",
  "row_index",

  "race_count_first",
  "event_count_first",

  "race_id",
  "race_name",
  "is_registration_open",
  "is_private_race",
  "is_draft_race",
  "created",
  "last_modified",
  "description",
  "timezone",

  "url",
  "external_race_url",
  "external_results_url",
  "fb_page_id",
  "fb_event_id",
  "logo_url",

  "address_street",
  "address_street2",
  "address_city",
  "address_state",
  "address_zipcode",
  "address_country_code",

  "race_last_date",
  "race_last_end_date",
  "race_next_date",
  "race_next_end_date",
  "race_month",
  "race_year",

  "event_id",
  "race_event_days_id",
  "event_name",
  "event_details",
  "event_type",
  "distance",
  "volunteer",
  "require_dob",
  "require_phone",

  "participant_cap",

  "event_start_time",
  "event_end_time",
  "event_month",
  "event_year",
  "event_registration_opens",
  "event_registration_opens_month",
  "event_registration_opens_year",

  "event_reg_opens",
  "event_reg_closes",
  "event_race_fee",
  "event_processing_fee",
  "event_registration_periods_json",
];

const RACE_ONLY_COLUMNS = [
  "page",
  "row_index",

  "race_count_first",

  "race_id",
  "race_name",
  "is_registration_open",
  "is_private_race",
  "is_draft_race",
  "created",
  "last_modified",
  "description",
  "timezone",
  "url",
  "external_race_url",
  "external_results_url",
  "fb_page_id",
  "fb_event_id",
  "logo_url",
  "address_street",
  "address_street2",
  "address_city",
  "address_state",
  "address_zipcode",
  "address_country_code",
  "race_last_date",
  "race_last_end_date",
  "race_next_date",
  "race_next_end_date",
  "race_month",
  "race_year",
];

function init_sheet_columns(ws, cols) {
  ws.columns = cols.map((k) => ({
    header: k,
    key: k,
    width: Math.min(60, Math.max(12, k.length + 2)),
  }));
}

async function main() {
  try {
    // ✅ CHANGED: use shared create_directory helper like your other scripts
    const base_directory = await create_directory(output_base_directory_name);
    const output_directory = path.join(base_directory, output_subdirectory_name);
    ensure_dir(output_directory);

    const output_path = path.join(output_directory, `${output_file_name}.xlsx`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: output_path,
      useStyles: false,
      useSharedStrings: true,
    });

    const ws_events = workbook.addWorksheet("Race_Event_Rows");
    init_sheet_columns(ws_events, RACE_EVENT_COLUMNS);

    let ws_race_only = null;
    if (ENABLE_RACE_ONLY) {
      ws_race_only = workbook.addWorksheet("Race_Only_Rows");
      init_sheet_columns(ws_race_only, RACE_ONLY_COLUMNS);
    }

    const state_year_map = new Map();
    const type_state_map = new Map();
    const type_count_map = new Map();

    const seen_race_ids = new Set();
    const seen_event_ids = new Set();

    console.log(`\n🔍 Pulling ALL RunSignup races in ${YEAR} via API (STREAMING)...`);
    console.log(`Output: ${output_path}`);

    let page = 1;
    const results_per_page = 1000;
    let keep_going = true;

    let global_event_row_index = 0;
    let global_race_row_index = 0;

    while (keep_going) {
      console.log(`Fetching API page ${page}...`);

      const data = await fetch_races_page({ page, results_per_page });
      const races = Array.isArray(data?.races) ? data.races : [];

      if (races.length === 0) {
        console.log(`↳ 0 races returned on page ${page}. stopping.`);
        break;
      }

      let event_rows_added = 0;
      let race_rows_added = 0;

      for (const item of races) {
        const race = item?.race || item;
        if (!race) continue;

        const race_id = race?.race_id ?? null;
        const race_name = as_string(race?.name);

        const addr = normalize_address(race);
        const urls = normalize_urls_and_social(race);
        const dates = normalize_race_dates(race);

        const race_base = {
          race_id,
          race_name,

          is_registration_open: as_bool_flag(race?.is_registration_open),
          is_private_race: as_bool_flag(race?.is_private_race),
          is_draft_race: as_bool_flag(race?.is_draft_race),

          created: as_string(race?.created),
          last_modified: as_string(race?.last_modified),
          description: as_string(race?.description),

          timezone: as_string(race?.timezone),

          ...urls,
          ...addr,
          ...dates,
        };

        const events = Array.isArray(race?.events)
          ? race.events
          : Array.isArray(race?.events?.event)
            ? race.events.event
            : race?.events?.event
              ? [race.events.event]
              : [];

        const race_key = `${YEAR}__${race_id ?? "null"}`;
        const race_count_first = seen_race_ids.has(race_key) ? 0 : 1;
        if (race_count_first === 1) seen_race_ids.add(race_key);

        if (!events.length) {
          if (ENABLE_RACE_ONLY) {
            global_race_row_index++;
            const row = {
              page,
              row_index: global_race_row_index,
              race_count_first,
              ...race_base,
            };

            ws_race_only.addRow(row).commit();
            race_rows_added++;

            const st = row.address_state;
            const yr = row.race_year;
            if (st && yr) {
              const key = `${st}_${yr}`;
              state_year_map.set(key, (state_year_map.get(key) || 0) + 1);
            }
          }
          continue;
        }

        for (const ev of events) {
          const ev_dates = normalize_event_dates(ev);
          const reg_periods_summary = extract_registration_period_summary(
            ev?.registration_periods
          );

          const parsed = parse_date_to_month_year(ev_dates.event_start_time);
          if (parsed.year && parsed.year !== YEAR) continue;

          global_event_row_index++;

          const event_id = ev?.event_id ?? null;
          const event_key = `${YEAR}__${event_id ?? "null"}`;
          const event_count_first = seen_event_ids.has(event_key) ? 0 : 1;
          if (event_count_first === 1) seen_event_ids.add(event_key);

          const row = {
            page,
            row_index: global_event_row_index,

            race_count_first,
            event_count_first,

            ...race_base,

            event_id,
            race_event_days_id: ev?.race_event_days_id ?? null,
            event_name: as_string(ev?.name),
            event_details: as_string(ev?.details),

            event_type: as_string(ev?.event_type),
            distance:
              ev?.distance !== undefined && ev?.distance !== null
                ? String(ev.distance)
                : null,

            volunteer: as_bool_flag(ev?.volunteer),
            require_dob: as_bool_flag(ev?.require_dob),
            require_phone: as_bool_flag(ev?.require_phone),

            participant_cap:
              ev?.participant_cap !== undefined && ev?.participant_cap !== null
                ? Number(ev.participant_cap)
                : null,

            ...ev_dates,
            ...reg_periods_summary,
          };

          ws_events.addRow(row).commit();
          event_rows_added++;

          const st = row.address_state;
          const yr = row.event_year || row.race_year;
          if (st && yr) {
            const key = `${st}_${yr}`;
            state_year_map.set(key, (state_year_map.get(key) || 0) + 1);
          }

          const t = row.event_type || "unknown";
          type_count_map.set(t, (type_count_map.get(t) || 0) + 1);

          if (st) {
            const key2 = `${t}__${st}`;
            type_state_map.set(key2, (type_state_map.get(key2) || 0) + 1);
          }
        }
      }

      console.log(
        `↳ added ${event_rows_added} event rows; ${race_rows_added} race-only rows`
      );

      if (races.length < results_per_page) {
        keep_going = false;
      } else {
        page++;
        await delay(200);
      }
    }

    ws_events.commit();
    if (ENABLE_RACE_ONLY) ws_race_only.commit();

    const ws_state_year = workbook.addWorksheet("Summary State-Year");
    ws_state_year.columns = [
      { header: "State", key: "state", width: 10 },
      { header: "Year", key: "year", width: 10 },
      { header: "Count", key: "count", width: 12 },
    ];

    const state_year_rows = Array.from(state_year_map.entries())
      .map(([key, count]) => {
        const [state, year] = key.split("_");
        return { state, year: parseInt(year, 10), count };
      })
      .sort((a, b) => a.state.localeCompare(b.state) || a.year - b.year);

    for (const r of state_year_rows) ws_state_year.addRow(r).commit();
    ws_state_year.commit();

    const ws_type_state = workbook.addWorksheet("Summary Type-State");
    ws_type_state.columns = [
      { header: "Event Type", key: "event_type", width: 20 },
      { header: "State", key: "state", width: 10 },
      { header: "Count", key: "count", width: 12 },
    ];

    const type_state_rows = Array.from(type_state_map.entries())
      .map(([key, count]) => {
        const [event_type, state] = key.split("__");
        return { event_type, state, count };
      })
      .sort(
        (a, b) =>
          a.state.localeCompare(b.state) ||
          a.event_type.localeCompare(b.event_type)
      );

    for (const r of type_state_rows) ws_type_state.addRow(r).commit();
    ws_type_state.commit();

    const ws_type = workbook.addWorksheet("Summary Event Type");
    ws_type.columns = [
      { header: "Event Type", key: "event_type", width: 20 },
      { header: "Count", key: "count", width: 12 },
    ];

    const type_rows = Array.from(type_count_map.entries())
      .map(([event_type, count]) => ({ event_type, count }))
      .sort((a, b) => a.event_type.localeCompare(b.event_type));

    for (const r of type_rows) ws_type.addRow(r).commit();
    ws_type.commit();

    await workbook.commit();

    console.log(`\n✅ DONE (STREAMING). Saved to '${output_path}'`);
    console.log(`Event rows written: ${global_event_row_index}`);
    console.log(`Race-only rows written: ${global_race_row_index}`);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("❌ Error:", msg);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  execute_get_runsignup_api_race_data: main,
};
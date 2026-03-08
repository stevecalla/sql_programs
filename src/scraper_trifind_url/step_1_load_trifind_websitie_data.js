/**
 * step_1_load_trifind_data.js
 *
 * Stream trifind website -> batch insert into local MySQL
 * (Main kept super clean, patterned after your DB transfer template)
 */

const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const mysqlP = require("mysql2/promise");
const { local_usat_sales_db_config } = require("../../utilities/config");
const { runTimer, stopTimer } = require("../../utilities/timer");
const {
  get_mountain_time_offset_hours,
  to_mysql_datetime,
} = require("../../utilities/date_time_tools/get_mountain_time_offset_hours");

const {
  query_create_trifind_custom_search_extract_table,
} = require("../queries/create_drop_db_table/query_create_trifind_table");

const {
  generate_trifind_rows_streaming,
} = require("./step_1a_trifind_website_stream");

// ----------------------------------------
// Config
// ----------------------------------------
// testing capability
const TEST_YEARS = false; // controls time period to scrape 
const TEST_MODE = false; // controls pagination cap via TEST_MAX_PAGES
const TEST_MAX_PAGES = 2;
const IS_TEST = false; // controls whether you use the small test sport_map

const CURRENT_YEAR = new Date().getFullYear();
const PRIOR_YEAR = CURRENT_YEAR - 1;
const NEXT_YEAR = CURRENT_YEAR + 1;
const YEARS_TO_LOAD = TEST_YEARS ? [NEXT_YEAR] : [CURRENT_YEAR, PRIOR_YEAR, NEXT_YEAR];

const BATCH_SIZE = 500;
const TABLE_NAME = "all_trifind_data_raw";

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function create_target_table(dst, table_name, table_structure) {
  await dst.execute(`DROP TABLE IF EXISTS \`${table_name}\``);
  await dst.execute(table_structure);
}

async function flush_batch(dst, table_name, rows) {
  const cols = Object.keys(rows[0]);
  const col_list = cols.map((c) => `\`${c}\``).join(",");
  const placeholders = rows
    .map(() => `(${cols.map(() => "?").join(",")})`)
    .join(",");

  const sql = `INSERT INTO \`${table_name}\` (${col_list}) VALUES ${placeholders}`;

  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      values.push(row[col]);
    }
  }

  await dst.execute(sql, values);
}

async function get_created_at_date() {
  const now_utc = new Date();
  const mtn_offset_hours = get_mountain_time_offset_hours(now_utc);
  const now_mtn = new Date(now_utc.getTime() + mtn_offset_hours * 60 * 60 * 1000);

  const created_at_utc = to_mysql_datetime(now_utc);
  const created_at_mtn = to_mysql_datetime(now_mtn);

  return { created_at_mtn, created_at_utc };
}

async function main() {
  const table_structure =
    await query_create_trifind_custom_search_extract_table(TABLE_NAME);

  const dst = await get_dst_connection();

  dst.on("error", (err) => {
    console.error("⚠️ MySQL destination connection error:", err);
  });

  runTimer("timer");
  let result = "Transfer Failed";

  try {
    await dst.beginTransaction();

    await create_target_table(dst, TABLE_NAME, table_structure);

    const { created_at_mtn, created_at_utc } = await get_created_at_date();

    const streamPromise = (async () => {
      let buffer = [];

      for (const year of YEARS_TO_LOAD) {
        const start_date = `${year}-01-01`;
        const end_date = `${year}-12-31`;

        const rows_stream = generate_trifind_rows_streaming({
          year,
          start_date,
          end_date,
          created_at_mtn,
          created_at_utc,
          test_mode: TEST_MODE,
          test_max_pages: TEST_MAX_PAGES,
          is_test: IS_TEST,
          throttle_ms: 200,
          detail_concurrency: 6,
        });

        for await (const row of rows_stream) {
          buffer.push(row);

          if (buffer.length >= BATCH_SIZE) {
            await flush_batch(dst, TABLE_NAME, buffer);
            buffer = [];
          }
        }
      }

      if (buffer.length) {
        await flush_batch(dst, TABLE_NAME, buffer);
      }
    })();

    await streamPromise;

    await dst.commit();

    result = "Transfer Successful";
  } catch (err) {
    await dst.rollback();
    console.error("Transfer failed, rolled back transaction:", err);
    throw err;
  } finally {
    try {
      await dst.end();
      console.log("✅ Destination DB connection closed.");
    } catch (close_err) {
      console.warn("Error during cleanup:", close_err);
    }

    stopTimer("timer");
  }

  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Error during data load:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  execute_transfer_trifind_website_to_local: main,
};
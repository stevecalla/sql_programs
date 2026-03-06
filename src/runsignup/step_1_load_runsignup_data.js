/**
 * transfer_runsignup_api_to_local_mysql_streaming.js
 *
 * Stream RunSignup API -> batch insert into local MySQL
 * (Main kept super clean, patterned after your DB transfer template)
 */

const dotenv = require("dotenv");
dotenv.config({ path: "../../.env" });

const mysqlP = require("mysql2/promise");
const { local_usat_sales_db_config } = require("../../utilities/config");
const { runTimer, stopTimer } = require("../../utilities/timer");
const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../utilities/date_time_tools/get_mountain_time_offset_hours");

const {
  query_create_runsignup_race_event_extract_table,
} = require("../queries/create_drop_db_table/query_create_runsignup_table");

const {
  generate_runsignup_rows_streaming,
} = require("./step_1a_runsignup_api_stream");

// ----------------------------------------
// Config
// ----------------------------------------
const YEAR = 2026; // todo
const START_DATE = `${YEAR}-01-01`;
const END_DATE = `${YEAR}-12-31`;

const RUNSIGNUP_API_KEY = process.env.RUNSIGNUP_API_KEY || null;
const RUNSIGNUP_API_SECRET = process.env.RUNSIGNUP_API_SECRET || null;

const RESULTS_PER_PAGE = 1000;
const ENABLE_RACE_ONLY = false;

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
  await dst.execute(TABLE_STRUCTURE);
}

async function flush_batch(dst, tableName, rows) {
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `\`${c}\``).join(",");
  const placeholders = rows
    .map(() => `(${cols.map(() => "?").join(",")})`)
    .join(",");

  const sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`;

  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      values.push(row[col]);
    }
  }

  await dst.execute(sql, values);
}

async function get_created_at_date() {
    // Batch timestamps (UTC → MTN via offset fn)
    const now_utc = new Date();
    const mtn_offset_hours = get_mountain_time_offset_hours(now_utc);
    const now_mtn = new Date(now_utc.getTime() + mtn_offset_hours * 60 * 60 * 1000);

    // IMPORTANT: strings for MySQL DATETIME columns
    const created_at_utc = to_mysql_datetime(now_utc);
    const created_at_mtn = to_mysql_datetime(now_mtn);

  return { created_at_mtn, created_at_utc };
}

async function main() {
  const BATCH_SIZE = 500;
  const TABLE_NAME = "all_runsignup_data_raw";
  const TABLE_STRUCTURE = await query_create_runsignup_race_event_extract_table(
    TABLE_NAME
  );

  const dst = await get_dst_connection();

  dst.on("error", (err) => {
    console.error("⚠️ MySQL destination connection error:", err);
  });

  runTimer("timer");
  let result = "Transfer Failed";

  try {
    await dst.beginTransaction();
    await create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE);

    const { created_at_mtn, created_at_utc } = await get_created_at_date();

    const streamPromise = (async () => {
      let buffer = [];

      const rows_stream = generate_runsignup_rows_streaming({
        year: YEAR,
        start_date: START_DATE,
        end_date: END_DATE,
        results_per_page: RESULTS_PER_PAGE,
        enable_race_only: ENABLE_RACE_ONLY,
        api_key: RUNSIGNUP_API_KEY,
        api_secret: RUNSIGNUP_API_SECRET,
        throttle_ms: 200,
        created_at_mtn,
        created_at_utc,
      });

      for await (const row of rows_stream) {
        buffer.push(row);

        if (buffer.length >= BATCH_SIZE) {
          await flush_batch(dst, TABLE_NAME, buffer);
          buffer = [];
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
    } catch (closeErr) {
      console.warn("Error during cleanup:", closeErr);
    }

    stopTimer("timer");
  }

  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  execute_transfer_runsignup_api_to_local: main,
};
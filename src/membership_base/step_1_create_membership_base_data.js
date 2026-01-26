// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// at top
const mysql = require('mysql2');            // classic API
const mysqlP = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../utilities/date_time_tools/get_mountain_time_offset_hours.js");

const { query_create_membership_base_table } = require('../queries/create_drop_db_table/query_create_membership_base_table');
const { query_create_membership_detail_table } = require('../queries/create_drop_db_table/query_create_membership_detail_table');

const { step_1_query_membership_base_data } = require('../queries/membership/step_1_get_membership_base_data');
const { step_2_query_membership_detail_data } = require('../queries/membership/step_2_get_membership_detail_data');

// connection.js
async function get_src_connection() {
  const cfg = await local_usat_sales_db_config();
  return mysql.createConnection(cfg);
}

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

// schema.js
async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
  await dst.execute(TABLE_STRUCTURE);
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

// Flushes one batch of rows into the target table via a single multi-row INSERT
async function flush_batch(dst, tableName, rows) {
  // ✅ GUARD: nothing to insert (prevents rows[0] crash)
  if (!rows || rows.length === 0) return;

  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `\`${c}\``).join(',');

  // Build "(?,?,?),(?,?,?),…" with rows.length tuples
  const placeholders = rows
    .map(() => `(${cols.map(_ => '?').join(',')})`)
    .join(',');

  const sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`;

  // Flatten all row values into one big array
  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      values.push(row[col]);
    }
  }

  await dst.execute(sql, values);
}

// ✅ NEW: reusable "stream query -> batch insert" helper
async function stream_query_into_table({ src, dst, sql, tableName, batchSize }) {
  const stream = src.query(sql).stream();

  let buffer = [];
  for await (const row of stream) {
    buffer.push(row);

    if (buffer.length >= batchSize) {
      await flush_batch(dst, tableName, buffer);
      buffer = [];
    }
  }

  // Flush any leftover rows
  if (buffer.length) {
    await flush_batch(dst, tableName, buffer);
  }
}

async function main() {
  const BATCH_SIZE = 500;
  const BASE_TABLE_NAME = 'membership_base_data';
  const DETAIL_TABLE_NAME = 'membership_detail_data';

  const BASE_TABLE_STRUCTURE = await query_create_membership_base_table(BASE_TABLE_NAME);
  const DETAIL_TABLE_STRUCTURE = await query_create_membership_detail_table(DETAIL_TABLE_NAME);

  const src = await get_src_connection();  // non-promise, for .stream()
  const dst = await get_dst_connection();  // promise API, for transaction + execute()

  runTimer('timer');

  let result = 'Transfer Failed';        // default if something blows up

  try {
    // 1) Start a transaction so DDL + data load is atomic
    await dst.beginTransaction();
    
    const is_test = false; // todo: set test = limits queries results

    // 2) Create the base table
    console.log(`Create ${BASE_TABLE_NAME}`);
    await create_target_table(dst, BASE_TABLE_NAME, BASE_TABLE_STRUCTURE);
    console.log(`Successfully created ${BASE_TABLE_NAME}`);

    // 3) Load base query
    let created_at_dates = await get_created_at_date();
    const query_base_data = step_1_query_membership_base_data(is_test, created_at_dates);

    // 4) Load/ stream base data
    await stream_query_into_table({
      src,
      dst,
      sql: query_base_data,
      tableName: BASE_TABLE_NAME,
      batchSize: BATCH_SIZE,
    });

    // 5) Create the detail table
    console.log(`Create ${DETAIL_TABLE_NAME}`);
    await create_target_table(dst, DETAIL_TABLE_NAME, DETAIL_TABLE_STRUCTURE);
    console.log(`Successfully created ${DETAIL_TABLE_NAME}`);

    // 6) Load detail query
    created_at_dates = await get_created_at_date();
    const query_detail_data = step_2_query_membership_detail_data(is_test, created_at_dates);

    // 7) Load detail data
    await stream_query_into_table({
      src,
      dst,
      sql: query_detail_data,
      tableName: DETAIL_TABLE_NAME,
      batchSize: BATCH_SIZE,
    });

    // 8) Commit everything (DDL + both data loads) in one go
    await dst.commit();

    result = 'Tranfer Successful'; // (keeping your original spelling)

  } catch (err) {
    // If anything goes wrong, undo the CREATE/DROP and any partial inserts
    await dst.rollback();
    console.error('Transfer failed, rolled back transaction:', err);
    throw err;

  } finally {
    // Always clean up connections and timer
    src.end();
    await dst.end();
    stopTimer('timer');
  }

  return result;
}

// if (require.main === module) {
//   main().catch(err => {
//     console.error('Stream failed');
//     console.error(err);
//     process.exit(1);
//   });
// }

module.exports = {
  execute_create_membership_base_data: main,
};

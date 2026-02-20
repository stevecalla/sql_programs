// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// at top
const mysql = require('mysql2');            // classic API
const mysqlP = require('mysql2/promise');   // only for dst.execute
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { get_mountain_time_offset_hours, to_mysql_datetime } = require("../../utilities/date_time_tools/get_mountain_time_offset_hours.js");

const { query_create_auto_renew_conversion_table } = require('../queries/create_drop_db_table/query_create_auto_renew_conversion_table.js');
const { query_create_sales_renewal_table } = require('../queries/create_drop_db_table/query_create_sales_renewal_table.js');

const { step_4_query_auto_renew_conversion_data } = require('../queries/auto_renew/step_4_get_auto_renew_conversion_data.js');
const { step_4a_get_generic_sales_renewal_data } = require('../queries/auto_renew/step_4a_get_generic_sales_renewal_data.js');

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

// Flushes one batch of rows into the target table via a single multi-row INSERT
// async function flush_batch(dst, tableName, rows) {
//   // ✅ GUARD: nothing to insert (prevents rows[0] crash)
//   if (!rows || rows.length === 0) return;

//   const cols = Object.keys(rows[0]);
//   const colList = cols.map(c => `\`${c}\``).join(',');

//   // Build "(?,?,?),(?,?,?),…" with rows.length tuples
//   const placeholders = rows
//     .map(() => `(${cols.map(() => '?').join(',')})`)
//     .join(',');

//   const sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`;

//   // Flatten all row values into one big array
//   const values = [];
//   for (const row of rows) {
//     for (const col of cols) {
//       values.push(row[col]);
//     }
//   }

//   // DEBUG + SANITIZE: mysql2 does NOT allow undefined bind params (use null for SQL NULL)
//   const width = cols.length;
//   for (let k = 0; k < values.length; k++) {
//     if (values[k] === undefined) {
//       const rowIndex = Math.floor(k / width);
//       const colIndex = k % width;

//       console.error("Undefined bind param (sanitizing to null)", {
//         tableName,
//         rowIndex,
//         colIndex,
//         colName: cols[colIndex],
//         // Helpful context to pinpoint mapping/alias problems:
//         row: rows[rowIndex],
//       });

//       // Convert undefined -> null so mysql2 can bind it
//       values[k] = null;
//     }
//   }

//   await dst.execute(sql, values);
// }


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
  const TABLE_NAME_AUTO_RENEW_CONVERSION = 'auto_renew_conversion_data';
  const TABLE_NAME_SALES_RENEWAL_DATA = 'sales_renewal_data';

  const TABLE_STRUCTURE_AUTO_RENEW_CONVERSION = await query_create_auto_renew_conversion_table(TABLE_NAME_AUTO_RENEW_CONVERSION);
  const TABLE_STRUCTURE_SALES_RENEWAL_DATA = await query_create_sales_renewal_table(TABLE_NAME_SALES_RENEWAL_DATA);

  const src = await get_src_connection();  // non-promise, for .stream()
  const dst = await get_dst_connection();  // promise API, for transaction + execute()

  runTimer('timer');

  let result = 'Transfer Failed';        // default if something blows up

  try {
    // 1) Start a transaction so DDL + data load is atomic
    await dst.beginTransaction();
    
    const is_test = false; // todo: set test = limits queries results

    // 2) Create the auto renew table
    console.log(`Create ${TABLE_NAME_AUTO_RENEW_CONVERSION}`);
    await create_target_table(dst, TABLE_NAME_AUTO_RENEW_CONVERSION, TABLE_STRUCTURE_AUTO_RENEW_CONVERSION);
    console.log(`Successfully created ${TABLE_NAME_AUTO_RENEW_CONVERSION}`);

    // 3) Load auto renew query
    let created_at_dates = await get_created_at_date();
    const query_auto_renew_data = step_4_query_auto_renew_conversion_data(is_test, created_at_dates);

    // 4) Load/ stream autu renew data
    await stream_query_into_table({
      src,
      dst,
      sql: query_auto_renew_data,
      tableName: TABLE_NAME_AUTO_RENEW_CONVERSION,
      batchSize: BATCH_SIZE,
    });

    // 5) Create the sales renewal table
    console.log(`Create ${TABLE_NAME_SALES_RENEWAL_DATA}`);
    await create_target_table(dst, TABLE_NAME_SALES_RENEWAL_DATA, TABLE_STRUCTURE_SALES_RENEWAL_DATA);
    console.log(`Successfully created ${TABLE_NAME_SALES_RENEWAL_DATA}`);

    // 6) Load sales renewal query
    created_at_dates = await get_created_at_date();
    const query_sales_renewal_data = step_4a_get_generic_sales_renewal_data(is_test, created_at_dates);

    // 7) Load sales renewal data
    await stream_query_into_table({
      src,
      dst,
      sql: query_sales_renewal_data,
      tableName: TABLE_NAME_SALES_RENEWAL_DATA,
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
  execute_create_auto_renew_and_sales_renewal_data: main,
};

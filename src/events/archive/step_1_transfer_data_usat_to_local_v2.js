// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP                                  = require('mysql2/promise');   // only for dst.execute
const { create_usat_membership_connection }   = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

const { query_create_event_table } = require('../queries/create_drop_db_table/query_create_event_table');
const { step_1_query_event_data } = require('../queries/events/step_1_get_event_data_042125');

// connection.js
async function get_src_connection() {
  return await create_usat_membership_connection();
}

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}j
  
// schema.js
async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
  await dst.execute(TABLE_STRUCTURE);
}

// Flushes one batch of rows into the target table via a single multi-row INSERT
async function flush_batch(dst, tableName, rows) {
  const cols    = Object.keys(rows[0]);
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

async function execute_transfer_usat_to_local() {
  const BATCH_SIZE   = 500;
  const TABLE_NAME   = 'all_event_data_raw';
  const TABLE_STRUCTURE  = await query_create_event_table(TABLE_NAME);

  const src = await get_src_connection();  // non‑promise, for .stream()
  const dst = await get_dst_connection();  // promise API, for transaction + execute()

  runTimer('timer');
  
  let result = 'Transfer Failed';        // default if something blows up

  try {
    // 1) Start a transaction so DDL + data load is atomic
    await dst.beginTransaction();

    // 2) Create the target TABLE_NAME
    await create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE);
    
    // 3) Stream rows from src.events into an internal buffer
      // console.log(step_1_query_event_data());
    const stream = src
      // .query(`SELECT id AS id_event, sanctioning_event_id FROM events`)
      .query(step_1_query_event_data())
      .stream()
    ;

    stream.on('error', (err) => {
      console.error('❌ Stream error occurred:', err);
      throw err;
    });

    // console.log(stream);

    let buffer = [];

    for await (const row of stream) {
      buffer.push(row);

      if (buffer.length >= BATCH_SIZE) {
        // flush one batch of rows
        await flush_batch(dst, TABLE_NAME, buffer);
        buffer = [];
      }
    }

    // 4) Flush any leftover rows
    if (buffer.length) {
      await flush_batch(dst, TABLE_NAME, buffer);
    }

    // 5) Commit everything (DDL + data) in one go
    await dst.commit();

    result = 'Tranfer Successful';          // only set this if we got all the way through

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

// execute_transfer_usat_to_local().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
  execute_transfer_usat_to_local,
};

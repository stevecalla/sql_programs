// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise'); // only for dst.execute
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_create_all_membership_sales_table } = require('../queries/create_drop_db_table/query_create_sales_table');
const { query_get_sales_data } = require('../queries/sales_data/0_get_sales_data_master_logic_v2');
const { generate_membership_category_logic } = require('../../utilities/data_query_criteria/generate_membership_category_logic');

// UTILITY FUNCTIONS
async function get_total_rows_count(src, start_date_mtn) {
  const [count_result] = await src.promise().query(`SELECT COUNT(DISTINCT(id)) AS total FROM membership_periods WHERE starts >= '${start_date_mtn}';`);
  
  if (count_result && count_result.length > 0) {
    return count_result[0].total;  // Access the total count value
  } else {
    console.error('Unexpected result format from COUNT query:', count_result);
    throw new Error('Failed to get total row count.');
  }
}

function log_duration(startTime, file_name) {
  const endTime = Date.now();  // End time tracking
  const durationInSeconds = (endTime - startTime) / 1000;  // Duration in seconds

  // Calculate hours, minutes, and seconds
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = Math.floor(durationInSeconds % 60);

  // Format the duration as HH:MM:SS
  const formattedDuration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  console.log(`Duration: ${formattedDuration} for ${file_name}`);
}

async function get_yesterdays_date() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1); // Move back one day

  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const day = String(yesterday.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function get_todays_date() {
  const today = new Date(); // Get the current date

  const year = today.getFullYear(); // Get the current year
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Get the current month (0-indexed, so we add 1)
  const day = String(today.getDate()).padStart(2, '0'); // Get the current day
  
  // Return the formatted date in 'YYYY-MM-DD' format
  return `${year}-${month}-${day}`;
}

async function get_last_day_of_year() {
  const current_date_mtn = new Date(); // Get the current date
  let end_date_mtn = new Date(current_date_mtn.getFullYear(), 11, 31); // Set the date to December 31st (Month is 0-indexed)

  // Format the date in YYYY-MM-DD format
  return `${end_date_mtn.getFullYear()}-${String(end_date_mtn.getMonth() + 1).padStart(2, '0')}-${String(end_date_mtn.getDate()).padStart(2, '0')}`;
}

// DATABASE CONNECTIONS
// usat vapor connection
async function get_src_connection_and_ssh() {
  const { connection, sshClient } = await create_usat_membership_connection();
  return { src: connection, sshClient };
}

// local mysql connection
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

// PROCESSING FUNCTIONS
// Create (or replace) the destination table
async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE, update_mode) {
  if (update_mode === 'full')
    await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);

  await dst.execute(TABLE_STRUCTURE);
}

// Replace batch processing
async function flush_batch_replace(dst, tableName, rows) {
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `\`${c}\``).join(',');
  const placeholders = rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',');

  // Use REPLACE INTO to replace existing records
  const sql = `
    REPLACE INTO \`${tableName}\` (${colList}) 
    VALUES ${placeholders}
  `;

  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      values.push(row[col]);
    }
  }

  const [result] = await dst.execute(sql, values);         // <= use driver result

  // Get the number of affected rows (inserted or replaced) immediately after the REPLACE INTO
  // console.log(`Rows affected by REPLACE INTO: ${result.affectedRows}`);
}

// Parallel batch processing with logging and progress monitoring
class Semaphore {
  constructor(max) { this.max = max; this.inUse = 0; this.queue = []; }
  async acquire() {
    if (this.inUse < this.max) { this.inUse++; return; }
    await new Promise(res => this.queue.push(res));
    this.inUse++;
  }
  release() {
    this.inUse--;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function process_stream_parallel(
  src, query, start_year_mtn, start_date_mtn, end_date_mtn,
  membership_period_ends, update_mode, updated_at_date_mtn,
  offset, BATCH_SIZE, dst, TABLE_NAME
) {
  const MAX_PARALLEL_BATCHES = 3;                 // your limit
  const sem = new Semaphore(MAX_PARALLEL_BATCHES);
  const inFlight = new Set();                     // so we can await all at the end
  let buffer = [];
  let rows_processed = 0;

  const stream = src
    .query(
      query_get_sales_data(
        query, start_year_mtn, start_date_mtn, end_date_mtn,
        membership_period_ends, update_mode, updated_at_date_mtn
      )
    )
    .stream();

  console.log('Starting to stream rows...');

  for await (const row of stream) {
    buffer.push(row);
    rows_processed++;

    if (buffer.length >= BATCH_SIZE) {
      const batch = buffer;        // DETACH
      buffer = [];                 // NEW buffer for next rows

      await sem.acquire();         // wait if we hit concurrency limit

      const p = (async () => {
        try {
          await flush_batch_replace(dst, TABLE_NAME, batch);
          console.log(`Flushed batch. Rows processed so far: ${rows_processed}`);
        } finally {
          sem.release();
          inFlight.delete(p);      // prevent memory growth
        }
      })();

      inFlight.add(p);
    }
  }

  // final partial batch
  if (buffer.length) {
    await sem.acquire();
    const batch = buffer; buffer = [];
    const p = (async () => {
      try {
        console.log(`Flushing remaining ${batch.length} rows...`);
        await flush_batch_replace(dst, TABLE_NAME, batch);
      } finally {
        sem.release();
        inFlight.delete(p);
      }
    })();
    inFlight.add(p);
  }

  // wait for all batches to finish
  await Promise.all(inFlight);

  console.log(`Processed a total of ${rows_processed} rows.`);
}

// Updated execute_transfer_usat_to_local function to use process_stream_parallel
async function execute_transfer_usat_to_local_parallel(update_mode) {
  const BATCH_SIZE = 100;
  const TABLE_NAME = `all_membership_sales_data_2015_left`;
  const TABLE_STRUCTURE = await query_create_all_membership_sales_table(TABLE_NAME);
  let result = 'Transfer Failed';
  let offset = 0;

  const membership_period_ends = '2008-01-01';
  const start_year_mtn = 2010; // Default = 2010
  const start_date_mtn = '2010-01-01';
  let end_date_mtn = await get_last_day_of_year();
  let updated_at_date_mtn = await get_yesterdays_date(); // Return yesterday in 'YYYY-MM-DD' format

  // updated_at_date_mtn = '2025-07-11';
  // console.log(end_date_mtn);  // Logs the last day of the current year in YYYY-MM-DD format TODO: eliminate
  // updated_at_date_mtn = await get_todays_date(); // Return today in 'YYYY-MM-DD' format
  // end_date_mtn = '2025-08-08'; // testing comment out TODO: eliminate

  const { src, sshClient } = await get_src_connection_and_ssh();
  const dst = await get_dst_connection();

  try {
    await dst.beginTransaction();
    await create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE, update_mode);

    let membership_category_logic = generate_membership_category_logic;

    // for (let j = 0; j < 1; j++) { // test
    for (let j = 0; j < membership_category_logic.length; j++) {
      runTimer('timer');
      const startTime = Date.now();  // Start time tracking

      const { query, file_name } = membership_category_logic[j];
      console.log(`\nStarting transfer for: ${file_name}`);

      // Get total rows count for progress tracking
      const total_rows = await get_total_rows_count(src, start_date_mtn);
      console.log(`\nTotal distinct rows to process: ${total_rows}`);

      // Process the stream in parallel batches
      await process_stream_parallel(src, query, start_year_mtn, start_date_mtn, end_date_mtn, membership_period_ends, update_mode, updated_at_date_mtn, offset, BATCH_SIZE, dst, TABLE_NAME);

      // Commit the transaction after processing each category
      await dst.commit();
      console.log('Transaction committed successfully.');
      result = 'Transfer Successful';

      log_duration(startTime, file_name); // Log the duration of the operation
      stopTimer('timer');
    }
  } catch (err) {
    await dst.rollback();
    console.error('Transfer failed, rolled back transaction:', err);
    throw err;
  } finally {
    // Cleanup
    try {
      await src.end();
      console.log('✅ Source DB connection closed.');

      await dst.end();
      console.log('✅ Destination DB connection closed.');

      await new Promise((resolve) => {
        sshClient.on('close', resolve);
        sshClient.end();
      });
      console.log('✅ SSH tunnel closed.');
    } catch (closeErr) {
      console.warn('Error during cleanup:', closeErr);
    }
  }

  return result;
}

// if (require.main === module) {
//   // const update_mode = 'full';  // Update the full dataset
//   // const update_mode = 'partial';  // Update based on the 'updated_at' date

//   execute_transfer_usat_to_local_parallel(update_mode);
// }

module.exports = {
  execute_transfer_usat_to_local_parallel,
};

// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise'); // only for dstConn.execute
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { upsert_batch } = require('../../utilities/data_query_criteria/upsert_batch_logic');

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

// Console.log the mysql thread id when writing results to db
async function getThreadId(conn) {
  return conn.threadId ?? conn.connection?.threadId
    ?? (await conn.query('SELECT CONNECTION_ID() AS id'))[0][0].id;
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

// local mysql pool
async function get_dst_pool() {
  const cfg = await local_usat_sales_db_config();
  return mysqlP.createPool({
    ...cfg,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0
  });
}

// PROCESSING FUNCTIONS
// Create (or replace) the destination table
async function create_target_table(dstConn, TABLE_NAME, TABLE_STRUCTURE, update_mode) {
  if (update_mode === 'full')
    await dstConn.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);

  // else "partial" or "updated at" so don't drop table / replace rows
  await dstConn.execute(TABLE_STRUCTURE);
}

// Upsert batch processing with full column list
async function flush_batch_upsert(dstPool, tableName, rows) {
  if (!rows?.length) return { affectedRows: 0 };

  const res = await upsert_batch(dstPool, tableName, rows, {
    // 'intersection' = only columns present in both the table and the row objects
    // Great when streaming partial columns or when schema evolves.
    schemaColumnsMode: 'intersection',
    // Or 'all' to use every table column (missing values become NULL on insert)
    // schemaColumnsMode: 'all',
    transaction: false,
  });

  return { affectedRows: res.affectedRows };
}

// Replace batch processing
async function flush_batch_replace(dstPool, tableName, rows) {
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

  const [result] = await dstPool.execute(sql, values);         // <= use driver result
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
  offset, BATCH_SIZE, dstPool, TABLE_NAME
) {
  const MAX_PARALLEL_BATCHES = 3; // keep ≤ connectionLimit in dstPool
  const sem = new Semaphore(MAX_PARALLEL_BATCHES);
  const inFlight = new Set();
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
      const batch = buffer.splice(0);  // <-- this safely detaches and empties the array
      // const batch = buffer;        // detach
      // buffer = [];

      await sem.acquire();

      let task; // define first so it's visible inside finally
      task = (async () => {
        const conn = await dstPool.getConnection();   // <-- real connection
        try {
          // const tid = await getThreadId(conn);
          // console.log(`batch using threadId=${tid}`);

          if (update_mode === 'full' || update_mode === 'partial') 
            await flush_batch_upsert(conn, TABLE_NAME, batch);
          else /* updated_at */     
            await flush_batch_replace(conn, TABLE_NAME, batch);

          console.log(`Flushed batch. Rows processed so far: ${rows_processed}`);

        } finally {
          conn.release();            // return to pool
          sem.release();
          inFlight.delete(task); // <-- safe now
        }
      })();

      inFlight.add(task);
    }
  }

  // final partial batch
  if (buffer.length) {
    await sem.acquire();

    const batch = buffer.splice(0);  // <-- this safely detaches and empties the array
    // const batch = buffer; 
    // buffer = [];

    let task;
    task = (async () => {
      const conn = await dstPool.getConnection();   // <-- real connection
      try {
        // const tid = await getThreadId(conn);
        // console.log(`batch using threadId=${tid}`);

        if (update_mode === 'full' || update_mode === 'partial') await flush_batch_upsert(conn, TABLE_NAME, batch);
        else /* updated_at */     await flush_batch_replace(conn, TABLE_NAME, batch);

        console.log(`\nFlushing remaining ${batch.length} rows...`);

      } finally {
        conn.release();            // return to pool
        sem.release();
        inFlight.delete(task);
      }
    })();

    inFlight.add(task);
  }

  await Promise.all(inFlight);
  console.log(`Processed a total of ${rows_processed} rows.`);
}

async function execute_transfer_usat_to_local_parallel(update_mode = 'updated_at', options) {
  const BATCH_SIZE = 100;
  let result = 'Transfer Failed';
  let offset = 0;

  let { TABLE_NAME, membership_period_ends, start_year_mtn, start_date_mtn, end_date_mtn, updated_at_date_mtn } = options;

  const TABLE_STRUCTURE = await query_create_all_membership_sales_table(TABLE_NAME);

  const { src, sshClient } = await get_src_connection_and_ssh();

  // One connection for DDL/setup/create_table and similar queries
  const dstConn = await get_dst_connection();

  // Pool for parallel batch writes
  const dstPool = await get_dst_pool();

  try {
    await create_target_table(dstConn, TABLE_NAME, TABLE_STRUCTURE, update_mode);

    let membership_category_logic = generate_membership_category_logic;
    console.log('TABLE NAME:', TABLE_NAME);
    console.log('UPDATE MODE:', update_mode + '; START DATE:', start_date_mtn + '; END DATE:', end_date_mtn + '; UPDATED AT:', updated_at_date_mtn)

    // Get total rows count for progress tracking
    // console.log('\nQuerying for count of total distinct rows.')
    // const total_rows = await get_total_rows_count(src, start_date_mtn);
    // console.log(`Total distinct rows to process: ${total_rows}`); 

    // for (let j = 0; j < 1; j++) { // test
    for (let j = 0; j < membership_category_logic.length; j++) {
      const { query, file_name } = membership_category_logic[j];
      const startTime = Date.now();

      runTimer('timer');                   // start for this iteration
      try {
        console.log(`\nStarting transfer for: ${file_name}`);
        // Process the stream in parallel batches
        await process_stream_parallel(src, query, start_year_mtn, start_date_mtn, end_date_mtn, membership_period_ends, update_mode, updated_at_date_mtn, offset, BATCH_SIZE, dstPool, TABLE_NAME);
        console.log('Transfer successful.');
        result = 'Transfer Successful';
      } finally {
        log_duration(startTime, file_name);
        stopTimer('timer');                // make sure it always stops
      }
    }
  } catch (err) {
    console.error('Transfer failed:', err);
    throw err;
  } finally {
    // Cleanup
    try {
      await src.end();
      console.log('✅ Source DB connection closed.');

      await dstConn.end();
      console.log('✅ Destination DB connection closed.');

      await dstPool.end();
      console.log('✅ Destination DB pool closed.');

      await new Promise((resolve) => {
        sshClient.on('close', resolve);
        sshClient.end();
      });
      console.log('✅ SSH tunnel closed.');

      stopTimer('timer');
    } catch (closeErr) {
      console.warn('Error during cleanup:', closeErr);
    }
  }

  return result;
}

// if (require.main === module) {
//   // const update_mode = 'full';        // Update 2010 forward, drop table
//   // const update_mode = 'partial';        // Update using current & prior year, dont drop
//   const update_mode = 'updated_at';   // Update based on the 'updated_at' date, dont drop

//   execute_run_sales_data_jobs_v2(update_mode);
// }

module.exports = {
  execute_transfer_usat_to_local_parallel,
};

// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise'); // only for dstConn.execute
const mysql = require('mysql2');          // <— non-promise API (supports .stream())

const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');
const { upsert_batch } = require('../../utilities/data_query_criteria/upsert_batch_logic');

const { step_7_prior_purchase_query } = require('../queries/sales_data_key_metrics/step_7_get_sales_data_010425');

// UTILITY FUNCTIONS
function log_duration(startTime) {
  const endTime = Date.now();  // End time tracking
  const durationInSeconds = (endTime - startTime) / 1000;  // Duration in seconds

  // Calculate hours, minutes, and seconds
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = Math.floor(durationInSeconds % 60);

  // Format the duration as HH:MM:SS
  const formattedDuration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  console.log(`\nDuration: ${formattedDuration}`);
}

// Console.log the mysql thread id when writing results to db
async function getThreadId(conn) {
  return conn.threadId ?? conn.connection?.threadId
    ?? (await conn.query('SELECT CONNECTION_ID() AS id'))[0][0].id;
}

// local mysql connection supports streams
async function get_dst_stream_conn() {
  const cfg = await local_usat_sales_db_config();
  return mysql.createConnection(cfg);     // not mysqlP
}

// local mysql connection
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

// local mysql pool supports pools
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
async function create_target_table(dstConn, update_mode, options, where_statement, FROM_STATEMENT, ORDER_BY_STATEMENT, TARGET_TABLE_NAME) {

  console.log('DROPPED TABLE:', TARGET_TABLE_NAME);
  await dstConn.execute(`DROP TABLE IF EXISTS \`${TARGET_TABLE_NAME}\``);

  await dstConn.execute(`
      -- Create table structure by selecting 0 rows (captures all columns & types)
      -- NOTE: TABLE DOESN'T NEED TO EXIST; IT USES THE SELECT QUERY IN THE AWAIT TO INFER FIELD NAMES & TYPES
      -- NOTE: if "partial" or "updated at" so don't drop table & table won't be create since it should exist per the sql query

      CREATE TABLE IF NOT EXISTS \`${TARGET_TABLE_NAME}\`
          ENGINE=InnoDB
          AS
          -- SELECT
          ${await step_7_prior_purchase_query(FROM_STATEMENT, where_statement, ORDER_BY_STATEMENT)}
          -- WHERE 1=0
      ;
  `);

  await dstConn.execute(`
      -- Add NOT NULL + PK (cheap now because the table is empty)
      ALTER TABLE \`${TARGET_TABLE_NAME}\`
          MODIFY id_profiles BIGINT NOT NULL,
          MODIFY id_membership_periods_sa BIGINT NOT NULL,
          ADD PRIMARY KEY (id_profiles, id_membership_periods_sa)
      ;
  `);
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

// ✱ Added new parameter testMode (default false)
async function process_stream_parallel_with_test_mode(QUERY, TARGET_TABLE_NAME, update_mode, offset, BATCH_SIZE, dstPool, dstConnStream, TEST_MODE_ONLY = false, TEST_BATCHES = 1) {
  const MAX_PARALLEL_BATCHES = 3;
  const sem = new Semaphore(MAX_PARALLEL_BATCHES);
  const inFlight = new Set();
  let buffer = [];
  let rows_processed = 0;
  let batch_runs = 0;   // count how many times you flushed

  const stream = dstConnStream
    .query(QUERY)
    .stream();

  console.log('Starting to stream rows...');

  for await (const row of stream) {
    buffer.push(row);
    rows_processed++;

    if (buffer.length >= BATCH_SIZE) {
      const batch = buffer.splice(0);

      batch_runs++;                // ✱ moved increment here (when scheduling)

      await sem.acquire();

      let task;
      task = (async () => {
        const conn = await dstPool.getConnection();
        try {
          if (update_mode === 'full' || update_mode === 'partial')
            await flush_batch_upsert(conn, TARGET_TABLE_NAME, batch);
          else
            await flush_batch_replace(conn, TARGET_TABLE_NAME, batch);

          console.log(`Flushed batch #${batch_runs}. Batches processed so far: ${batch_runs}. Rows processed so far: ${rows_processed}`);

        } finally {
          conn.release();
          sem.release();
          inFlight.delete(task);
        }
      })();

      inFlight.add(task);

      // ✱ New: bail out after 2 batches if testMode is ON
      if (TEST_MODE_ONLY && batch_runs >= TEST_BATCHES) {
        console.log(`Hit test limit of ${TEST_BATCHES} batches. Stopping stream early.`);
        stream.destroy();
        break;
      }
    }
  }

  // ✱ Changed: skip final partial flush if testMode already hit 2
  if (buffer.length && !(TEST_MODE_ONLY && batch_runs >= TEST_BATCHES)) {
    await sem.acquire();

    const batch = buffer.splice(0);

    let task;
    task = (async () => {
      const conn = await dstPool.getConnection();
      try {
        // const tid = await getThreadId(conn);
        // console.log(`batch using threadId=${tid}`);

        if (update_mode === 'full' || update_mode === 'partial')
          await flush_batch_upsert(conn, TARGET_TABLE_NAME, batch);
        else /* updated_at */
          await flush_batch_replace(conn, TARGET_TABLE_NAME, batch);

        console.log(`\nFlushing remaining ${batch.length} rows...`);

      } finally {
        conn.release();        // return to pool
        sem.release();
        inFlight.delete(task);
      }
    })();

    inFlight.add(task);
  }

  await Promise.all(inFlight);
  console.log(`Processed a total of ${rows_processed} rows.`);
}

async function step_3a_create_prior_purchase_table_parallel(FROM_STATEMENT, pool, update_mode = 'updated_at', options) {
  const TEST_MODE_ONLY = false;
  const TEST_BATCHES = 2;

  const BATCH_SIZE = 500;
  let result = 'Transfer Failed';
  let offset = 0;

  let { TABLE_NAME, TARGET_TABLE_NAME, membership_period_ends, start_year_mtn, start_date_mtn, end_date_mtn, updated_at_date_mtn } = options;

  // Connection for streaming requires npm mysql2 package
  const dstConnStream = await get_dst_stream_conn();

  // One connection for DDL/setup/create_table and similar queries
  const dstConn = await get_dst_connection();

  // Pool for parallel batch writes
  const dstPool = await get_dst_pool();

  try {
    runTimer('timer'); // start for this iteration

    TARGET_TABLE_NAME = `step_7_prior_purchase`;
    console.log('\nTABLE NAME:', TARGET_TABLE_NAME);
    console.log('UPDATE MODE:', update_mode + '; START DATE:', start_date_mtn + '; END DATE:', end_date_mtn + '; UPDATED AT:', updated_at_date_mtn);

    const startTime = Date.now();

    try {
      let where_statement = `WHERE 1 = 0`;
      const ORDER_BY_STATEMENT = '';
      const FROM_STATEMENT = update_mode === 'full' ? `FROM \`${TABLE_NAME}\`` : `FROM step_0a_create_updated_at_data`;

      // STEP #1: CREATE TABLE IF IT DOESN'T EXIST
      await create_target_table(dstConn, update_mode, options, where_statement, FROM_STATEMENT, ORDER_BY_STATEMENT, TARGET_TABLE_NAME);

      // STEP #2 GET QUERY
      where_statement = `WHERE 1 = 1  `;
      const QUERY = await step_7_prior_purchase_query(FROM_STATEMENT, where_statement, ORDER_BY_STATEMENT);

      // console.log(QUERY);

      // Process the stream in parallel batches
      await process_stream_parallel_with_test_mode(QUERY, TARGET_TABLE_NAME, update_mode, offset, BATCH_SIZE, dstPool, dstConnStream, TEST_MODE_ONLY, TEST_BATCHES);

      console.log('Transfer successful.');
      result = `DO 0`;

    } finally {
      log_duration(startTime);
      stopTimer('timer');
    }

  } catch (err) {
    console.error('Transfer failed:', err);
    throw err;
  } finally {
    // Cleanup
    try {
      await dstConnStream.end();
      console.log('✅ Destination DB stream closed.');

      await dstConn.end();
      console.log('✅ Destination DB connection closed.');

      await dstPool.end();
      console.log('✅ Destination DB pool closed.');

      stopTimer('timer');

    } catch (closeErr) {
      console.warn('Error during cleanup:', closeErr);
    }
  }

  return result;
}

// if (require.main === module) {
//   let FROM_STATEMENT = '';
//   let pool = '';
//   const options = {
//     TABLE_NAME: `all_membership_sales_data_2015_left`,
//     TARGET_TABLE_NAME: `sales_key_stats_2015_test`,
//     // membership_period_ends: '2008-01-01',
//     // start_year_mtn: 2010, // Default = 2010
//     // start_date_mtn: update_mode === 'partial' ? await get_first_day_of_prior_year() : '2010-01-01',
//     // end_date_mtn: await get_last_day_of_year(),
//     // updated_at_date_mtn: await get_yesterdays_date(),
//   };
// 
//   // const update_mode = 'full';        // Update 2010 forward, drop table
//   const update_mode = 'partial';     // Update using current & prior year, dont drop
//   // const update_mode = 'updated_at';     // Update based on the 'updated_at' date, dont drop

//   step_3a_create_prior_purchase_table_parallel(FROM_STATEMENT, pool, update_mode, options);
// }

module.exports = {
  step_3a_create_prior_purchase_table_parallel,
};

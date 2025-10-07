// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise'); // only for dstConn.execute
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');

const { runTimer, stopTimer } = require('../../utilities/timer');
const { upsert_batch } = require('../../utilities/data_query_criteria/upsert_batch_logic');

const { query_create_deleted_profiles_table } = require('../queries/create_drop_db_table/query_create_deleted_profiles_table');

// UTILITY FUNCTIONS
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

async function get_first_day_current_month() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1); // Move back one day

  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const day = String(yesterday.getDate()).padStart(2, '0');

  return `${year}-${month}-01`;
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
async function create_target_table(dstConn, TABLE_NAME, TABLE_STRUCTURE) {

  await dstConn.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
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

async function process_stream_parallel(src, querySpec, updated_at_date_mtn, offset, BATCH_SIZE, dstPool, TABLE_NAME) {
  
  const { sql, params = [] } = typeof querySpec === 'string' ? { sql: querySpec, params: [] } : querySpec;

  console.log('query = ', sql);

  const MAX_PARALLEL_BATCHES = 3; // keep ≤ connectionLimit in dstPool
  const sem = new Semaphore(MAX_PARALLEL_BATCHES);
  const inFlight = new Set();
  let buffer = [];
  let rows_processed = 0;

  console.log('Starting to stream rows...');
  const stream = src
    .query(sql, params)
    .stream();

  for await (const row of stream) {
    buffer.push(row);
    rows_processed++;

    if (buffer.length >= BATCH_SIZE) {
      const batch = buffer.splice(0);  // <-- this safely detaches and empties the array

      await sem.acquire();

      let task; // define first so it's visible inside finally
      task = (async () => {
        const conn = await dstPool.getConnection();   // <-- real connection
        try {
          // const tid = await getThreadId(conn);
          // console.log(`batch using threadId=${tid}`);

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

        await flush_batch_replace(conn, TABLE_NAME, batch);

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

async function execute_transfer_deleted_profiles_to_local_parallel() {
  const BATCH_SIZE = 100;
  let result = 'Transfer Failed';
  let offset = 0;

  const test = false;
  let updated_at_date_mtn = test ? '2025-10-01' : await get_first_day_current_month();

  let TABLE_NAME = `all_membership_sales_data_deleted_profiles`;
  const TABLE_STRUCTURE = await query_create_deleted_profiles_table(TABLE_NAME);

  // Connections
  const { src, sshClient } = await get_src_connection_and_ssh();
  const dstConn = await get_dst_connection();
  const dstPool = await get_dst_pool();

  try {
    runTimer('timer');

    console.log(`Create ${TABLE_NAME}`)
    await create_target_table(dstConn, TABLE_NAME, TABLE_STRUCTURE);
    
    console.log(`UPDATED AT: ${updated_at_date_mtn}`)

    const select_query = `
      SELECT 
        p.id         AS id_profiles,
        p.deleted_at AS deleted_at_profile
      FROM profiles AS p
      WHERE 1 = 1
        AND p.deleted_at IS NOT NULL
        AND p.deleted_at >= ?
      ORDER BY p.deleted_at
    `;

    // Process the stream in parallel batches
    await process_stream_parallel(src, { sql: select_query, params: [updated_at_date_mtn] }, updated_at_date_mtn, offset, BATCH_SIZE, dstPool, TABLE_NAME);

    console.log('Transfer successful.');

    result = 'Transfer Successful';

  } catch (err) {
    console.error('Transfer failed:', err);
    throw err;
  } finally {
    
    // log_duration(startTime, file_name);
    stopTimer('timer');                // make sure it always stops
    
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
//   execute_transfer_deleted_profiles_to_local_parallel();
// }

module.exports = {
  execute_transfer_deleted_profiles_to_local_parallel,
};

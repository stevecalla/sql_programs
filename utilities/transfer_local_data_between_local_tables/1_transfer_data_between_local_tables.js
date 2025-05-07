// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });
const mysql   = require('mysql2');          // classic API
const mysqlP                                  = require('mysql2/promise');   // only for dst.execute

const { local_usat_sales_db_config }          = require('../../utilities/config');
const { runTimer, stopTimer }                 = require('../../utilities/timer');

// connection.js
async function get_src_connection() {
  const cfg = await local_usat_sales_db_config();
  return mysql.createConnection(cfg);
}

async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

function get_created_at_mtn() {
  return `
    SELECT 
      CASE 
        WHEN UTC_TIMESTAMP() >= DATE_ADD(
                DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01'),
                    INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-03-01')) + 1) % 7 + 7) DAY),
                INTERVAL 2 HOUR)
        AND UTC_TIMESTAMP() < DATE_ADD(
                DATE_ADD(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01'),
                    INTERVAL ((7 - DAYOFWEEK(CONCAT(YEAR(UTC_TIMESTAMP()), '-11-01')) + 1) % 7) DAY),
                INTERVAL 2 HOUR)
        THEN DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -6 HOUR), '%Y-%m-%d %H:%i:%s')
        ELSE DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL -7 HOUR), '%Y-%m-%d %H:%i:%s')
        END AS created_at_mtn
    ;
  `;
}

function get_created_at_utc() {
  return `
    SELECT 
      DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') AS created_at_utc
    ;
  `;
}
  
// schema.js
async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
  await dst.execute(TABLE_STRUCTURE);
}

// Flushes one batch of rows into the target table via a single multi-row INSERT
async function flush_batch(dst, TABLE_NAME, rows) {
  const cols    = Object.keys(rows[0]);
  const colList = cols.map(c => `\`${c}\``).join(',');
  // Build "(?,?,?),(?,?,?),…" with rows.length tuples
  const placeholders = rows
    .map(() => `(${cols.map(_ => '?').join(',')})`)
    .join(',');

  const sql = `INSERT INTO \`${TABLE_NAME}\` (${colList}) VALUES ${placeholders}`;

  // Flatten all row values into one big array
  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      const value = row[col];
      if (value === undefined) {
        console.error(`[ERROR] Undefined value found in column "${col}" for row:`, row);
        throw new Error(`Undefined value detected in column "${col}"`);
      }
      values.push(value);
    }
  }

  await dst.execute(sql, values);
}

async function execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS) {
  const src = await get_src_connection();  // non‑promise, for .stream()
  const dst = await get_dst_connection();  // promise API, for transaction + execute()

  runTimer('timer');
  let result = 'Transfer Failed'; // default unless successful

  // GET CREATED AT MTN TO PASS ALONG
  let [rows] = await src.promise().query(get_created_at_mtn());
  const created_at_mtn = rows[0]?.created_at_mtn;

  // GET CREATED AT UTC TO PASS ALONG
  [rows] = await src.promise().query(get_created_at_utc());
  const created_at_utc = rows[0]?.created_at_utc;

  try {
    await dst.beginTransaction(); // 1) Start transaction

    if (QUERY_OPTIONS?.is_create_table) // Only drop / create table the first time the function runs
      await create_target_table(dst, TABLE_NAME, CREATE_TABLE_QUERY); // 2) Create target table

    const stream = src
      .query(GET_DATA_QUERY(created_at_mtn, created_at_utc, QUERY_OPTIONS))
      .stream(); // 3) Stream from source

    let buffer = [];
    let totalRows = 0;
    let batchCount = 0;

    for await (const row of stream) {
      buffer.push(row);
      totalRows++;

      // Check for undefined values
      for (const [key, value] of Object.entries(row)) {
        if (value === undefined) {
          console.warn(`[Warning] Undefined value detected in field "${key}"`, row);
        }
      }

      if (buffer.length >= BATCH_SIZE) {
        await flush_batch(dst, TABLE_NAME, buffer);
        batchCount++;
        console.log(`[INFO] Flushed batch #${batchCount} (${batchCount * BATCH_SIZE} rows)...`);
        buffer = [];
      }
    }

    // 4) Flush leftover rows
    if (buffer.length) {
      await flush_batch(dst, TABLE_NAME, buffer);
      batchCount++;
      console.log(`[INFO] Flushed final batch #${batchCount} (${totalRows} total rows).`);
    }

    if (QUERY_OPTIONS?.is_create_table) {
      // Log a small sample from the temp table (e.g., first 5 rows)
      const [sampleRows] = await src.promise().query(`
        SELECT 
          * 
        FROM ${TABLE_NAME}
        ORDER BY 1
        LIMIT 5
      `);

      const sampleRowsLimited = sampleRows.map(row => {
        const limited = {};
        const keys = Object.keys(row).slice(0, 5); // get first 5 column names
        keys.forEach(key => limited[key] = row[key]);
        return limited;
      });
      
      console.log('SAMPLE OF FIRST FIVE ROWS & FIRST FIVE COLUMNS ONLY')
      console.table(sampleRowsLimited);

    }

    await dst.commit(); // 5) Commit transaction
    result = 'Transfer Successful';
    console.log(`[SUCCESS] Transfer complete: ${totalRows} total rows in ${batchCount} batches.`);

  } catch (err) {
    await dst.rollback(); // Roll back if failure
    console.error('[ERROR] Transfer failed, rolled back transaction:', err);
    throw err;

  } finally {

    // await src.promise().query(`DROP TABLE IF EXISTS rev_recognition_base_profile_ids_data`);

    src.end();
    await dst.end();
    stopTimer('timer');
  }

  return result;
}


// execute_transfer_data_between_tables().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
  execute_transfer_data_between_tables,
};

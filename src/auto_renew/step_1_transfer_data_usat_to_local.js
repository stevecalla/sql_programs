// Load environment variables
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysqlP = require('mysql2/promise'); // only for dst.execute
const { create_usat_membership_connection } = require('../../utilities/connectionUSATMembershipDB');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_create_auto_renew_extract_table } = require('../queries/create_drop_db_table/query_create_auto_renew_table');
const { step_1_query_auto_renew_data } = require('../queries/auto_renew/step_1_get_auto_renew_data_021326');

async function get_src_connection_and_ssh() {
  const { connection, sshClient } = await create_usat_membership_connection();
  return { src: connection, sshClient };
}

// Get local MySQL connection
async function get_dst_connection() {
  const cfg = await local_usat_sales_db_config();
  return await mysqlP.createConnection(cfg);
}

// Create (or replace) the destination table
async function create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE) {
  await dst.execute(`DROP TABLE IF EXISTS \`${TABLE_NAME}\``);
  await dst.execute(TABLE_STRUCTURE);
}

// Insert one batch of rows
async function flush_batch(dst, tableName, rows) {
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `\`${c}\``).join(',');
  const placeholders = rows.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
  const sql = `INSERT INTO \`${tableName}\` (${colList}) VALUES ${placeholders}`;

  const values = [];
  for (const row of rows) {
    for (const col of cols) {
      values.push(row[col]);
    }
  }

  await dst.execute(sql, values);
}

async function main() {
  const BATCH_SIZE = 500;
  const TABLE_NAME = 'all_auto_renew_data_raw';
  const TABLE_STRUCTURE = await query_create_auto_renew_extract_table(TABLE_NAME);

  const { src, sshClient } = await get_src_connection_and_ssh();
  const dst = await get_dst_connection();

  src.on('error', (err) => {
    console.error('⚠️ MySQL source connection error:', err);
  });
  
  dst.on('error', (err) => {
    console.error('⚠️ MySQL destination connection error:', err);
  });  

  runTimer('timer');
  let result = 'Transfer Failed';

  try {
    await dst.beginTransaction();
    await create_target_table(dst, TABLE_NAME, TABLE_STRUCTURE);

    const stream = src.query(step_1_query_auto_renew_data()).stream();

    const streamPromise = (async () => {
      let buffer = [];

      for await (const row of stream) {
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

    await streamPromise; // This will catch stream errors

    await dst.commit();
    result = 'Transfer Successful';

  } catch (err) {
    await dst.rollback();
    console.error('Transfer failed, rolled back transaction:', err);
    throw err;

  } finally {
    // ✅ Proper cleanup
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

    stopTimer('timer');
  }
  
  return result;
}

module.exports = {
  execute_transfer_usat_to_local: main,
};

// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const mysql   = require('mysql2');          // classic API
const { local_usat_sales_db_config }          = require('../../utilities/config');

// QUERIES
const { query_create_rev_recognition_base_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_base_table');
const { step_1_query_rev_recognition_data } = require('../queries/rev_recognition/step_1_get_rev_recognition_base_data_050325');

const { query_create_rev_recognition_profile_ids_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_profile_ids_table');
const { step_1a_query_rev_recognition_profile_ids_data } = require('../queries/rev_recognition/step_1a_get_rev_recognition_profile_ids_data_050325');

// TRANSFER FUNCTION
const { execute_transfer_data_between_tables } = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables');

// connection.js
async function get_src_connection() {
  const cfg = await local_usat_sales_db_config();
  return mysql.createConnection(cfg);
}

async function execute_create_recognition_base_data() {
  let BATCH_SIZE   = 500;

  // VARIABLES
  let QUERY_OPTIONS = {
    ends_mp: '2024-01-01',
    is_create_table: true,
  };
  
  // Step 1: Create and populate the profile IDs table
  BATCH_SIZE = 2000;
  let TABLE_NAME = 'rev_recognition_base_profile_ids_data';
  let CREATE_TABLE_QUERY = await query_create_rev_recognition_profile_ids_table(TABLE_NAME);
  let GET_DATA_QUERY = step_1a_query_rev_recognition_profile_ids_data;

  // CREATE TABLE & GET / TRANSFER DATA
  await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);

  // Step 2: Count number of rows in rev_recognition_base_profile_ids_data
  const src = await get_src_connection();
  let [[{ count }]]  = await src.promise().query(`SELECT COUNT(*) AS count FROM ${TABLE_NAME}`);

  console.log('*********************************');
  console.log('profile id table length = ', count);
  src.end();

  // Step 3: Loop in batches and insert into the base table
  BATCH_SIZE = 500;
  TABLE_NAME   = 'rev_recognition_base_data';
  CREATE_TABLE_QUERY = await query_create_rev_recognition_base_table(TABLE_NAME);
  GET_DATA_QUERY = step_1_query_rev_recognition_data;

  const LIMIT_SIZE = 1000;
  let result = "";

  for (let offset = 0; offset < count; offset += LIMIT_SIZE) {

    is_create_table = offset === 0 ? true : false;
    
    QUERY_OPTIONS = {
      ...QUERY_OPTIONS,
      limit_size: LIMIT_SIZE,
      offset_size: offset,
      is_create_table: is_create_table,
    };

    result = await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);
  }

  return result;  
}

// execute_create_recognition_base_data().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
  execute_create_recognition_base_data,
};

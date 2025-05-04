// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// QUERIES
const { query_create_rev_recognition_base_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_base_table');
const { step_1_query_rev_recognition_data } = require('../queries/rev_recognition/step_1_get_rev_recognition_base_data_050325');

// TRANSFER FUNCTION
const { execute_transfer_data_between_tables} = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables')

async function execute_create_recognition_base_data() {
  const BATCH_SIZE   = 500;
  const TABLE_NAME   = 'rev_recognition_base_data';

  // GET QUERIES
  const CREATE_TABLE_QUERY = await query_create_rev_recognition_base_table(TABLE_NAME);
  const GET_DATA_QUERY = step_1_query_rev_recognition_data;

  // CREATE TABLE & GET / TRANSFER DATA
  const result = await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY);

  return result;  
}

// execute_create_recognition_base_data().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
  execute_create_recognition_base_data,
};

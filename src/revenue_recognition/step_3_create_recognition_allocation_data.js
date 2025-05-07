// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// QUERIES
const { query_create_rev_recognition_allocation_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_allocation_table');
const { step_3_query_rev_recognition_allocation_data } = require('../queries/rev_recognition/step_3_get_rev_recognition_allocation_data_050325');

// TRANSFER FUNCTION
const { execute_transfer_data_between_tables} = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables')

async function execute_create_recognition_allocation_data() {
  const BATCH_SIZE   = 500;
  const TABLE_NAME   = 'rev_recognition_allocation_data';

  // GET QUERIES
  const CREATE_TABLE_QUERY = await query_create_rev_recognition_allocation_table(TABLE_NAME);
  const GET_DATA_QUERY = step_3_query_rev_recognition_allocation_data;

  // VARIABLES
  const QUERY_OPTIONS = {
    ends_mp: '2024-01-01'
  };

  // CREATE TABLE & GET / TRANSFER DATA
  const result = await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);

  return result;  
}

// execute_create_recognition_allocation_data().catch(err => {
//     console.error('Stream failed:', err);
//     process.exit(1);
// });

module.exports = {
  execute_create_recognition_allocation_data,
};

// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// QUERIES
const { query_create_rev_recognition_allocation_history_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_allocation_history_table');
const { step_5_query_rev_rec_2025_history_snapshot, step_5_test_query, step_5_query_insert_rev_rec_monthly_history_snapshot } = require('../queries/rev_recognition/step_5_get_rev_recognition_allocation_data_history_040226');

// TRANSFER FUNCTION
const { execute_transfer_data_between_tables } = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables');

async function main(QUERY_OPTIONS) {
  const BATCH_SIZE = 500;
  const TABLE_NAME = 'rev_recognition_allocation_data_history';
  const IS_TEST = false;

  // GET QUERIES
  const CREATE_TABLE_QUERY = await query_create_rev_recognition_allocation_history_table(TABLE_NAME);
  console.log(CREATE_TABLE_QUERY);

  // USED TO LOAD THE INITIAL DATA FOR 2025 ONCE
  const GET_DATA_QUERY = IS_TEST ? step_5_test_query : step_5_query_rev_rec_2025_history_snapshot;

  // USED TO LOAD DATA MONTHLY
  // const GET_DATA_QUERY = IS_TEST ? step_5_test_query : step_5_query_insert_rev_rec_monthly_history_snapshot;

  // CREATE TABLE & GET / TRANSFER DATA
  const result = await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);

  // return result;  
  return;
}

if (require.main === module) {
  try {
    console.log('\nStarting data load.');
    main();
  } catch (error) {
    console.error("Error during data load:", error);
    process.exit(1);
  }
}

module.exports = {
  execute_create_recognition_allocation_data_history: main,
};

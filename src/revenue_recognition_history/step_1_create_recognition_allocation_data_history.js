// at top
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// QUERIES
const { query_create_rev_recognition_allocation_history_table } = require('../queries/create_drop_db_table/query_create_rev_recognition_allocation_history_table');
const { step_1_query_rev_rec_2025_history_snapshot, step_1_test_query, step_1_query_insert_rev_rec_monthly_history_snapshot_v2 } = require('../queries/rev_recognition_history/step_1_get_rev_recognition_allocation_data_history_040226');

// TRANSFER FUNCTION
const { execute_transfer_data_between_tables } = require('../../utilities/transfer_local_data_between_local_tables/1_transfer_data_between_local_tables');

async function main(QUERY_OPTIONS) {
  const BATCH_SIZE = 500;
  const TABLE_NAME = 'rev_recognition_allocation_data_history';
  const IS_TEST = false;

  // GET QUERIES
  const CREATE_TABLE_QUERY = await query_create_rev_recognition_allocation_history_table(TABLE_NAME);
  // console.log(CREATE_TABLE_QUERY);

  // USED TO LOAD THE INITIAL DATA FOR 2025 ONCE; DOESN'T CHECK IF IT EXISTS ALREADY
  // const GET_DATA_QUERY = step_1_query_rev_rec_2025_history_snapshot;

  // USED TO LOAD HISTORICAL DATA; DEFAULT IS TO LOAD BY YEAR AND MONTH; HAS OPTION TO RUN FOR 2025 USING use_year_where_statement: true IN STEP 0
  const GET_DATA_QUERY = IS_TEST ? step_1_test_query : step_1_query_insert_rev_rec_monthly_history_snapshot_v2;

  // CREATE TABLE & GET / TRANSFER DATA
  const result = await execute_transfer_data_between_tables(BATCH_SIZE, TABLE_NAME, CREATE_TABLE_QUERY, GET_DATA_QUERY, QUERY_OPTIONS);

  return result;  
  // return;
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

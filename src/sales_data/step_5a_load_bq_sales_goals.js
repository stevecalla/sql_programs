const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { query_sales_goals_data } = require('../google_cloud/queries/query_sales_goals_data');
const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');
const { members_sales_goals_schema } = require('../google_cloud/schemas/schema_sales_goals_data');


// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_sales_goals() {
    const options = [
        {
            fileName: 'sales_goals', // append to csv file name
            query: (retrieval_batch_size, offset) => query_sales_goals_data(retrieval_batch_size, offset),
            tableId: "sales_goals", // table name
        }
    ];

    // originally issue loading the table but fixed 4/18/25 (I believe)
    // the google load process for sales goals does not query the local goals DB because it produces bad results
    // thus the code passes a directoryName which contains the original / source csv for the sales goals which loads in step 2
    // then is used in step 4
    // const directoryName = `usat_sales_goal_data`;

    const directoryName = `usat_google_bigquery_data`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting'; // google cloud bucket
    const schema = members_sales_goals_schema; // leave blank so Step #4 in Google Load process will use auto schema

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    return true;
}

// execute_load_big_query_sales_goals();

module.exports = {
    execute_load_big_query_sales_goals,
}
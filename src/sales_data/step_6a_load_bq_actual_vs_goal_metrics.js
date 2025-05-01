const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { query_sales_actual_vs_goal_data } = require('../google_cloud/queries/query_sales_actual_vs_goal_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

const { members_sales_actual_vs_goal_schema } = require('../google_cloud/schemas/schema_sales_actual_vs_goal_data');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_actual_vs_goal_metrics() {
    const options = [
        {
            fileName: 'sales_actual_vs_goal_data',
            query: (retrieval_batch_size, offset) => query_sales_actual_vs_goal_data(retrieval_batch_size, offset),
            tableId: "sales_actual_vs_goal_data", // table name

            // tableId: "sales_actual_vs_goal_data_test", // table name
        }
    ];

    const directoryName = `usat_google_bigquery_data`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = members_sales_actual_vs_goal_schema;

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    return true;
}

// execute_load_big_query_actual_vs_goal_metrics();

module.exports = {
    execute_load_big_query_actual_vs_goal_metrics,
}
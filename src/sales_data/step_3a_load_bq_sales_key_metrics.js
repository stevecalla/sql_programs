const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_member_data } = require('../google_cloud/queries/query_member_data');
const { execute_load_data_to_bigquery } = require('../google_cloud/step_0a_load_main_job_last_id');
const { members_schema } = require('../google_cloud/schemas/schema_member_data');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_sales_key_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            // query: (retrieval_batch_size, offset) => query_member_data(retrieval_batch_size, offset),
            query: (retrieval_batch_size, last_seen_id) => query_member_data(retrieval_batch_size, last_seen_id),
            fileName: 'member_data',
            tableId: "membership_data", // table name
            
            // fileName: 'member_data_test',
            // tableId: "membership_data_test", // table name
        }
    ];
    
    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = members_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_sales_key_metrics();
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_big_query_sales_key_metrics();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_sales_key_metrics,
}

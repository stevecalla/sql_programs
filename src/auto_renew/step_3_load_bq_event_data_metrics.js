const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_event_metrics} = require('../google_cloud/queries/query_event_metrics');
const { event_metrics_schema } = require('../google_cloud/schemas/schema_event_metrics');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_event_data_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'event_metrics_data',
            query: (retrieval_batch_size, offset) => query_event_metrics(retrieval_batch_size, offset),
            // tableId: 'participation_profile_data', // table name
            tableId: 'event_metrics_data', // table name
            
            // fileName: 'event_metrics_data_v2',
            // tableId: "event_metrics_data_v2",
        }
    ];

    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = event_metrics_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_event_data_metrics();
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_big_query_event_data_metrics();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_event_data_metrics,
}

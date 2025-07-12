const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_event_match_data } = require('../google_cloud/queries/query_event_match_data');
const { event_data_metrics_yoy_match_schema } = require('../google_cloud/schemas/schema_event_match_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_event_match_data() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'event_data_metrics_yoy_match',
            query: (retrieval_batch_size, offset) => query_event_match_data(retrieval_batch_size, offset),
            tableId: 'event_data_metrics_yoy_match', // table name
            
            // fileName: 'event_data_metrics_yoy_matcha_v2',
            // tableId: "event_data_metrics_yoy_match_v2",
        }
    ];
    
    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = event_data_metrics_yoy_match_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_event_match_data();
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_data_to_bigquery();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_event_match_data,
}

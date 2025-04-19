const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_participation_profile} = require('../google_cloud/queries/query_participation_profile');
const { participation_profile_schema } = require('../google_cloud/schemas/schema_participation_profile');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_participation_profile_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'participation_profile_data',
            query: (retrieval_batch_size, offset) => query_participation_profile(retrieval_batch_size, offset),
            tableId: 'participation_profile_data', // table name
            
            // fileName: 'participation_profile_data_v2',
            // tableId: "participation_profile_data_v2",
        }
    ];

    const directoryName = `usat_google_bigquery_data`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = participation_profile_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_participation_race_profile_metrics();
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_data_to_bigquery();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_participation_profile_metrics,
}

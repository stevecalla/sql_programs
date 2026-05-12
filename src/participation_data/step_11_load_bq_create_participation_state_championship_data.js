const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_participation_state_rankings_results } = require('../google_cloud/queries/query_participation_state_rankings_results');

const { participation_state_rankings_schema } = require('../google_cloud/schemas/schema_participation_state_rankings_results');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function main() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'all_participation_state_rankings_results',
            query: (retrieval_batch_size, offset) => query_participation_state_rankings_results(retrieval_batch_size, offset),
            tableId: 'all_participation_state_rankings_results', // table name
            
            // fileName: 'all_participation_state_rankings_results_v2',
            // tableId: "all_participation_state_rankings_results_v2",
        }
    ];
    
    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = participation_state_rankings_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

if (require.main === module) {
  main().catch((error) => {
    console.error("error during event load:", error);
    process.exitCode = 1;
  });
}

module.exports = {
    execute_load_big_query_all_participation_state_rankings_results: main,
}

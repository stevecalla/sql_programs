const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_ironman_profile } = require('../google_cloud/queries/query_ironman_profile');
const { ironman_profile_schema } = require('../google_cloud/schemas/schema_ironman_profile');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIG QUERY — IRONMAN PROFILE (#3)
async function execute_load_big_query_ironman_profile_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'ironman_profile_data',
            query: (retrieval_batch_size, offset) => query_ironman_profile(retrieval_batch_size, offset),
            tableId: 'ironman_profile_data', // table name
        }
    ];

    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = ironman_profile_schema;

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_ironman_profile_metrics();

module.exports = {
    execute_load_big_query_ironman_profile_metrics,
};

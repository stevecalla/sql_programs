const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_ironman_timeseries_cohort } = require('../google_cloud/queries/query_ironman_timeseries_cohort');
const { ironman_timeseries_cohort_schema } = require('../google_cloud/schemas/schema_ironman_timeseries_cohort');

const { query_ironman_timeseries_activity } = require('../google_cloud/queries/query_ironman_timeseries_activity');
const { ironman_timeseries_activity_schema } = require('../google_cloud/schemas/schema_ironman_timeseries_activity');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIG QUERY — IRONMAN TIME-SERIES (#4 cohort, #5 activity)
async function execute_load_big_query_ironman_timeseries_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'ironman_timeseries_cohort_data',
            query: (retrieval_batch_size, offset) => query_ironman_timeseries_cohort(retrieval_batch_size, offset),
            tableId: 'ironman_timeseries_cohort_data',
            schema: ironman_timeseries_cohort_schema,
        },
        {
            fileName: 'ironman_timeseries_activity_data',
            query: (retrieval_batch_size, offset) => query_ironman_timeseries_activity(retrieval_batch_size, offset),
            tableId: 'ironman_timeseries_activity_data',
            schema: ironman_timeseries_activity_schema,
        }
    ];

    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';

    // Load each dataset in the options array (each gets its own schema + directory)
    for (const opt of options) {
        const directoryName = `usat_bigquery_${opt.fileName}`;
        const schema = opt.schema;
        await execute_load_data_to_bigquery([opt], datasetId, bucketName, schema, directoryName);
    }

    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_ironman_timeseries_metrics();

module.exports = {
    execute_load_big_query_ironman_timeseries_metrics,
};

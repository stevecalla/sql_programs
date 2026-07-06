const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_participation_summary } = require('../google_cloud/queries/query_participation_summary');
const { participation_summary_schema } = require('../google_cloud/schemas/schema_participation_summary');

const { query_participation_flows } = require('../google_cloud/queries/query_participation_flows');
const { participation_flows_schema } = require('../google_cloud/schemas/schema_participation_flows');

const { query_participation_events } = require('../google_cloud/queries/query_participation_events');
const { participation_events_schema } = require('../google_cloud/schemas/schema_participation_events');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY — loads the reporting summary + flows tables to BigQuery (mirrors step_3b).
async function execute_load_big_query_participation_summary_metrics() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';

    // 1) Summary table
    const summary_options = [
        {
            fileName: 'all_participation_data_with_membership_match_summary',
            query: (retrieval_batch_size, offset) => query_participation_summary(retrieval_batch_size, offset),
            tableId: 'all_participation_data_with_membership_match_summary',
        }
    ];
    await execute_load_data_to_bigquery(
        summary_options, datasetId, bucketName, participation_summary_schema,
        `usat_bigquery_${summary_options[0].fileName}`
    );

    // 2) Flows table
    const flows_options = [
        {
            fileName: 'all_participation_data_with_membership_match_flows',
            query: (retrieval_batch_size, offset) => query_participation_flows(retrieval_batch_size, offset),
            tableId: 'all_participation_data_with_membership_match_flows',
        }
    ];
    await execute_load_data_to_bigquery(
        flows_options, datasetId, bucketName, participation_flows_schema,
        `usat_bigquery_${flows_options[0].fileName}`
    );

    // 3) Events table
    const events_options = [
        {
            fileName: 'all_participation_data_with_membership_match_events',
            query: (retrieval_batch_size, offset) => query_participation_events(retrieval_batch_size, offset),
            tableId: 'all_participation_data_with_membership_match_events',
        }
    ];
    await execute_load_data_to_bigquery(
        events_options, datasetId, bucketName, participation_events_schema,
        `usat_bigquery_${events_options[0].fileName}`
    );

    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

if (require.main === module) {
  execute_load_big_query_participation_summary_metrics().catch((error) => {
    console.error("error loading BigQuery participation summary metrics:", error);
    process.exitCode = 1;
  });
}

module.exports = {
    execute_load_big_query_participation_summary_metrics,
}

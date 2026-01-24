const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_membership_base_data } = require('../google_cloud/queries/query_membership_base_data');
const { membership_base_metrics_schema } = require('../google_cloud/schemas/schema_membership_base_data');

const { query_membership_detail_data } = require('../google_cloud/queries/query_membership_detail_data');
const { membership_detail_metrics_schema } = require('../google_cloud/schemas/schema_membership_detail_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function main() {
  runTimer(`load_bigquery`);

  const app_name = "usat_sales";
  await logPM2MemoryUsage(app_name);

  const options = [
    {
      fileName: 'membership_base_data',
      query: (retrieval_batch_size, offset) => query_membership_base_data(retrieval_batch_size, offset),
      tableId: 'membership_base_data',
      schema: membership_base_metrics_schema,

      // fileName: 'membership_base_datav2',
      // tableId: "membership_base_data_v2",
    },
    {
      fileName: 'membership_detail_data',
      query: (retrieval_batch_size, offset) => query_membership_detail_data(retrieval_batch_size, offset),
      tableId: 'membership_detail_data',
      schema: membership_detail_metrics_schema,

      // fileName: 'membership_detail_datav2',
      // tableId: "membership_detail_data_v2",
    }
  ];

  const datasetId = "membership_reporting"; // database name
  const bucketName = 'membership-reporting';

  // ✅ Load each dataset in the options array (each gets its own schema + directory)
  for (const opt of options) {
    const directoryName = `usat_bigquery_${opt.fileName}`;
    const schema = opt.schema;

    // keep the same function signature, but call it per dataset
    await execute_load_data_to_bigquery([opt], datasetId, bucketName, schema, directoryName);
  }

  // the process to get data for bigquery loads a lot of data in step 1 results
  // within that process, results are assigned to null then garbage collection is run
  // to clear memory
  await logPM2MemoryUsage(app_name);

  stopTimer(`load_bigquery`);

  return true; // placeholder to return to ensure success msg
}

module.exports = {
  execute_load_big_query_membership_data: main,
};

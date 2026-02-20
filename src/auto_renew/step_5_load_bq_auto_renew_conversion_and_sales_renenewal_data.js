const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_auto_renew_conversion_data } = require('../google_cloud/queries/query_auto_renew_conversion_data');
const { auto_renew_conversion_schema } = require('../google_cloud/schemas/schema_auto_renew_conversion_data');

const { query_sales_renewal_data } = require('../google_cloud/queries/query_sales_renewal_data');
const { sales_renewal_schema } = require('../google_cloud/schemas/schema_sales_renewal_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function main() {
  runTimer(`load_bigquery`);

  const app_name = "usat_sales";
  await logPM2MemoryUsage(app_name);

  const options = [
    {
      fileName: 'auto_renew_conversion_data',
      query: (retrieval_batch_size, offset) => query_auto_renew_conversion_data(retrieval_batch_size, offset),
      tableId: 'auto_renew_conversion_data',
      schema: auto_renew_conversion_schema,

      // fileName: 'auto_renew_conversion_data_v2',
      // tableId: "auto_renew_conversion_data_v2",
    },
    {
      fileName: 'sales_renewal_data',
      query: (retrieval_batch_size, offset) => query_sales_renewal_data(retrieval_batch_size, offset),
      tableId: 'sales_renewal_data',
      schema: sales_renewal_schema,

      // fileName: 'sales_renewal_data_v2',
      // tableId: "sales_renewal_data_v2",
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
  execute_load_biq_query_auto_renew_and_sales_renewal_data: main,
};

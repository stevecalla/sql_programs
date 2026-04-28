const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_runsignup_affiliate_data } = require('../google_cloud/queries/query_runsignup_affiliate_data');
const { all_runsignup_affiliate_match_schema } = require('../google_cloud/schemas/schema_runsignup_affiliate_data');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');


// EXECUTE LOAD BIQ QUERY
async function main() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'runsignup_data_raw_missing_id',
            query: (retrieval_batch_size, offset) => query_runsignup_affiliate_data(retrieval_batch_size, offset, 'all_runsignup_data_raw_missing_id'),
            tableId: 'runsignup_data_raw_missing_id', // table name

            // fileName: 'runsignup_data_raw_missing_id_v2',
            // tableId: "runsignup_data_raw_missing_id_v2",
        }
    ];

    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = all_runsignup_affiliate_match_schema;

    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

if (require.main === module) {
    try {
        console.log('\nStarting data load.');
        main();
    } catch (error) {
        console.error("Error during data load:", error);
    }
}

module.exports = {
    execute_load_big_query_runsignup_fuzzy_match_missing_id: main,
}

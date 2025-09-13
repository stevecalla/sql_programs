const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { query_participation_with_membership_sales_match } = require('../google_cloud/queries/query_participation_with_membership_match');
const { participation_with_membership_sales_match_schema } = require('../google_cloud/schemas/schema_participation_with_membership_match');

const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');

// EXECUTE LOAD BIQ QUERY
async function execute_load_big_query_participation_membership_sales_match() {
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    await logPM2MemoryUsage(app_name);

    const options = [
        {
            fileName: 'all_participation_data_with_membership_match',
            query: (retrieval_batch_size, offset) => query_participation_with_membership_sales_match(retrieval_batch_size, offset),
            tableId: 'all_participation_data_with_membership_match', // table name
            
            // fileName: 'all_participation_data_with_membership_match_v2',
            // tableId: "all_participation_data_with_membership_match_v2",
        }
    ];
    
    const directoryName = `usat_bigquery_${options[0].fileName}`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = participation_with_membership_sales_match_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_bigquery`);

    return true; // placeholder to return to ensure success msg
}

// execute_load_big_query_participation_membership_sales_match();
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_data_to_bigquery();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_participation_membership_sales_match,
}

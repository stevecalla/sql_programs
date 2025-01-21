const pm2 = require('pm2');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { triggerGarbageCollection } = require('../../utilities/garbage_collection/trigger_garbage_collection');
const { restartPM2Process } = require('../../utilities/pm2_scripts/pm2_restart_process');

const { query_member_data } = require('../google_cloud/queries/query_member_data');
const { execute_load_data_to_bigquery } = require('../google_cloud/step_0_load_main_job');
const { members_schema } = require('../google_cloud/schemas/schema_member_data');

// Function to log memory usage and optionally restart
async function logMemoryUsage(trigger, restartPM2 = false, app_name) {

    if (trigger === 'Before') {
        console.log(`\n\nLogging memory usage ${trigger} execution:`);
        await logPM2MemoryUsage(app_name);
    }
    
    await triggerGarbageCollection();

    if (trigger === 'After' && restartPM2) {

        await restartPM2Process(app_name); // Restart the process via PM2
        console.log('Process restarted');

        // pm2 restarts thus these logs don't register
        console.log('help log');
        console.log(`\n\nLogging memory usage ${trigger} execution:`);
        await logPM2MemoryUsage(app_name);
    }

    console.log('***************** testing ****************');
    return;
}

// Simulated main execution function
async function execute_load_big_query_sales_key_metrics() {
    const { runTimer, stopTimer } = require('../../utilities/timer');
    runTimer(`load_bigquery`);

    const app_name = "usat_sales";
    let restart_pm2 = false;
    await logMemoryUsage("Before", restart_pm2, app_name);

    //***************** MAIN FUNCTION - START ******************/
    const options = [
        {
            fileName: 'member_data',
            query: query_member_data,
            tableId: "membership_data", // table name
        }
    ];

    const directoryName = `usat_google_bigquery_data`;
    const datasetId = "membership_reporting"; // database name
    const bucketName = 'membership-reporting';
    const schema = members_schema;
    
    await execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName);

    //***************** MAIN FUNCTION - END ******************/

    // RESTART PM2 TO RESET PM2 MEMORY ALLOCATION SINCE THE QUERY RESULTS ARE LARGE & RETAINED BY PM2
    await logMemoryUsage("Before", restart_pm2, app_name); // Check memory before restart but after execution
    restart_pm2 = true;
    await logMemoryUsage("After", restart_pm2, app_name); // Restart after execution

    stopTimer(`load_bigquery`);
    return true;
}

// Execute the function
// (async () => {
//     try {
//         console.log('\nStarting data load.');
//         await execute_load_big_query_sales_key_metrics();
//     } catch (error) {
//         console.error("Error during data load:", error);
//     }
// })();

module.exports = {
    execute_load_big_query_sales_key_metrics,
};
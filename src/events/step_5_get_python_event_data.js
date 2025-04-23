const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { logPM2MemoryUsage } = require('../../utilities/pm2_scripts/pm2_log_memory_usage');
const { runTimer, stopTimer } = require('../../utilities/timer');

const { step_5_query_python_event_data } = require('../queries/events/step_5_get_python_event_data');
const { execute_save_data_to_csv } = require('../../utilities/save_data_to_csv');

// EXECUTE GET PYTHON EVENT DATA
async function execute_get_python_event_data() {
    runTimer(`load_python_event_data`);

    const app_name = "usat_events";
    await logPM2MemoryUsage(app_name);

    const options = [
        {    
            directory_name: `usat_python_data`,
            directory_name_archive: `usat_python_data_archive`,
            fileName: 'python_event_data',
            query: (retrieval_batch_size, offset) => step_5_query_python_event_data(retrieval_batch_size, offset),
            retrieval_batch_size: 100000,
        }
    ];
    
    console.log(options);
    await execute_save_data_to_csv(options);

    // the process to get data for biqquery loads a lot data in step 1 results
    // within that process, results are assigned to null then garbage collection is run 
    // to clear memory
    await logPM2MemoryUsage(app_name);

    stopTimer(`load_python_event_data`);

    return true; // placeholder to return to ensure success msg
}

// execute_get_python_event_data();
// (async () => {
//     try {
//         console.log('\nStarting data save to csv.');
//         await execute_get_python_event_data();
//     } catch (error) {
//         console.error("Error during data save to csv:", error);
//     }
// })();

module.exports = {
    execute_get_python_event_data,
}

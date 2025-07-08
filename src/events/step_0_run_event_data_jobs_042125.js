const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

// GET & LOAD EVENT DATA
const { execute_transfer_usat_to_local } = require('./step_1_transfer_data_usat_to_local'); // Step #1: tranfer USAT event data to Local DB
const { execute_create_event_data_metrics } = require('./step_2_create_event_data_metrics'); // Step #2: execute_create_event_data_metrics
const { execute_load_big_query_event_data_metrics } = require("./step_3_load_bq_event_data_metrics"); // Step #3: load event metrics to bigquery

const { execute_get_python_event_data } = require('./step_5_get_python_event_data'); // Step #5: execute_get_python_event_data
const { execute_run_python_event_reports } = require('../../utilities/python_events/index'); // Step #6: run python event reports
const { execute_load_big_query_event_match_data } = require("./step_7_load_bq_event_match_data"); // Step #7: load event match data to bigquery


const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

async function executeSteps(stepFunctions, stepName) {
  for (let i = 0; i < stepFunctions.length; i++) {
    
    const start_local_time = new Date().toLocaleString(); // Get the current local date and time as a string
    const startTime = performance.now();

    const stepFunction = stepFunctions[i];
    
    console.log(`\n*************** STARTING ${stepName[i]} ***************\n`);
    try {
      if (stepFunction) {
        const results = await stepFunction();

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const message = results ? 
          `${stepName[i]} ${results}. START: ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. END: = ${end_local_time} MTN.` : 
          `$${stepName[i]} ERROR: ${results}. START: ${start_local_time} MTN. Time now = ${end_local_time} MTN. Elapsed Time: ${elapsedTime} sec. `;

        console.log(message);
        await slack_message_api(message, "steve_calla_slack_channel");

      } else {
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const skip_message = `$${stepName[i]} SKIPPED: Toggle set to false. START: ${start_local_time} MTN. END: = ${end_local_time} MTN. Elapsed Time: ${elapsedTime} sec. `;

        console.log(skip_message);
        await slack_message_api(skip_message, "steve_calla_slack_channel");
      }

    } catch (error) {
      const endTime = performance.now();
      const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
      const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

      const error_message = `${stepName[i]} ERROR: ${error}. START: ${start_local_time} MTN. END: = ${end_local_time} MTN. Elapsed Time: ${elapsedTime} sec. `;

      console.error(error_message);
      await slack_message_api(error_message, "steve_calla_slack_channel");

      // Decide whether to continue or break the loop here.
      // For example, to stop on the first error:
      break;
      // To continue despite errors in individual steps:
      // continue;
    } finally {
      console.log(`\n*************** ENDING ${stepName[i]} ***************\n`);
    }
  }
}

async function execute_run_event_data_jobs() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  const run_step_1 = false; // tranfer USAT event data to Local DB
  const run_step_2 = false; // execute_create_event_data_metrics
  const run_step_3 = false; // load event metrics to bigquery

  const run_step_5 = false; // execute_get_python_event_data
  const run_step_6 = false; // run python event reports
  const run_step_7 = true; // load event_data_metrics_yoy_match to bigquery

  try {
    const stepFunctions = [
      run_step_1 ? execute_transfer_usat_to_local : null,
      run_step_2 ? execute_create_event_data_metrics : null,
      run_step_3 ? execute_load_big_query_event_data_metrics : null,

      run_step_5 ? execute_get_python_event_data : null,
      run_step_6 ? execute_run_python_event_reports : null,
      run_step_7 ? execute_load_big_query_event_match_data : null,

    ];

    const stepName = [
      `Step #1 - Transfer data from USAT to Local db:`, 
      `Step #2 - Create event data metrics: `, 
      `Step #3 - Load event metrics to BQ: `,

      `Step #5 - Get python event data`,
      `Step_#6 - Run python event reports`,

      `Step_#7 - Load event match data to BQ: `,
      
    ];

    await executeSteps(stepFunctions, stepName); // Call the new function

  } catch (error) {
    console.error('Error in main process:', error); // More specific message
    return;
  }

  const endTime = performance.now();
  const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // converts to seconds

  console.log(`\nPROGRAM END TIME: ${getCurrentDateTime()}; ELASPED TIME: ${elapsedTime} sec\n`);

  return elapsedTime;
}

if (require.main === module) {
  execute_run_event_data_jobs();
}

module.exports = {
  execute_run_event_data_jobs,
};
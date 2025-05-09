const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');
const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

// GET & LOAD EVENT DATA
const { execute_create_recognition_base_data } = require('./step_1_create_recognition_base_data');
const { execute_load_big_query_recognition_base_data } = require("./step_2_load_bq_recognition_base_data");

const { execute_create_recognition_allocation_data } = require("./step_3_create_recognition_allocation_data");
const { execute_load_big_query_recognition_allocation_data } = require("./step_4_load_bq_recognition_allocation_data");

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

async function execute_run_recognition_data_jobs() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);
  console.log('hello 1');

  const run_step_1  = true; // execute_create_recognition_base_data
  const run_step_2  = true; // load recognition_base_data to BQ

  const run_step_3  = true; // execute_load_big_query_recognition_base_data
  const run_step_4  = true; // load recognition_allocation_data to BQ

  try {
    const stepFunctions = [
      run_step_1 ? execute_create_recognition_base_data : null,
      run_step_2 ? execute_load_big_query_recognition_base_data : null,

      run_step_3 ? execute_create_recognition_allocation_data : null,
      run_step_4 ? execute_load_big_query_recognition_allocation_data : null,
    ];

    const stepName = [
      `Step #1 - Create revenue recognition base data:`, 
      `Step #2 - Load recognition_base_data to BQ: `,
      
      `Step #3 - Create revenue recognition allocation data:`, 
      `Step #4 - Load recognition_allocation_data to BQ: `,
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

execute_run_recognition_data_jobs();

module.exports = {
  execute_run_recognition_data_jobs,
};
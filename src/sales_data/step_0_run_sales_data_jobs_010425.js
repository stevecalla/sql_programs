const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_get_sales_data } = require('./step_1_get_sales_data');
const { execute_load_sales_data } = require('./step_2_load_sales_data');
const { execute_create_sales_key_metrics } = require('./step_3_create_sales_key_metrics_010425');

const { slack_message_api } = require('../../utilities/slack_message_api');

const run_step_1 = true; // get sales data
const run_step_2 = true; // load sales data
const run_step_3 = true; // create sales stats summary

async function executeSteps(stepFunctions) {
  for (let i = 0; i < stepFunctions.length; i++) {
    const start_local_time = new Date().toLocaleString(); // Get the current local date and time as a string
    const startTime = performance.now();

    const stepFunction = stepFunctions[i];
    const stepName = `STEP #${i + 1}:`;
    
    console.log(`\n*************** STARTING ${stepName} ***************\n`);
    try {
      if (stepFunction) {
        const results = await stepFunction();

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const message = results ? `SUCCESS All Sales Data: ${stepName} executed successfully. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.` : `ERROR: ${stepName} NOT executed successfully. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime}. Time now = ${end_local_time} MTN.`;

        console.log(message);
        await slack_message_api(message, "steve_calla_slack_channel");

      } else {
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const skip_message = `Skipped ${stepName} All sales data due to toggle set to false. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.`;

        console.log(skip_message);
        await slack_message_api(skip_message, "steve_calla_slack_channel");
      }

    } catch (error) {
      const endTime = performance.now();
      const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
      const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

      const error_message = `ERROR All Sales DAta: Executing ${stepName}: ${error}. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.`;

      console.error(error_message);
      await slack_message_api(error_message, "steve_calla_slack_channel");

      // Decide whether to continue or break the loop here.
      // For example, to stop on the first error:
      break;
      // To continue despite errors in individual steps:
      // continue;
    } finally {
      console.log('\n*************** END OF', stepName, '**************\n');
    }
  }
}

async function execute_run_sales_data_jobs() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  try {
    const stepFunctions = [
      run_step_1 ? execute_get_sales_data : null,
      run_step_2 ? execute_load_sales_data : null,
      run_step_3 ? execute_create_sales_key_metrics : null,
    ];

    await executeSteps(stepFunctions); // Call the new function

  } catch (error) {
    console.error('Error in main process:', error); // More specific message
    return;
  }

  const endTime = performance.now();
  const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // converts to seconds

  console.log(`\nPROGRAM END TIME: ${getCurrentDateTime()}; ELASPED TIME: ${elapsedTime} sec\n`);

  return elapsedTime;
}

// execute_run_sales_data_jobs();

module.exports = {
  execute_run_sales_data_jobs,
};
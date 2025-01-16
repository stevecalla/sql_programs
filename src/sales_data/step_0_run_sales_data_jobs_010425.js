const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_get_sales_data } = require('./step_1_get_sales_data');
const { execute_load_sales_data } = require('./step_2_load_sales_data');
const { execute_create_sales_key_metrics } = require('./step_3_create_sales_key_metrics_010425');
const { execute_load_big_query_sales_key_metrics } = require('./step_3a_load_bq_sales_key_metrics');
const { execute_create_year_over_year_key_metrics } = require('./step_4_create_sales_year_over_year_metrics_011425');
const { execute_load_sales_goal_data } = require('./step_5_load_sales_goals');

const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

const run_step_1 = false; // get sales data
const run_step_2 = false; // load sales data
const run_step_3 = false; // create sales key metrics stats table
const run_step_3a = false; // load sales key metrics stats to biqquery
const run_step_4 = true; // create year-over-year common date table
const run_step_5 = false; // load sales goal data

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
          `${stepName[i]} SUCCESS. START: ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. END: = ${end_local_time} MTN.` : 
          `$${stepName[i]} ERROR: NOT executed successfully. START: ${start_local_time} MTN. Time now = ${end_local_time} MTN. Elapsed Time: ${elapsedTime} sec. `;

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

async function execute_run_sales_data_jobs() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  try {
    const stepFunctions = [
      run_step_1 ? execute_get_sales_data : null,
      run_step_2 ? execute_load_sales_data : null,
      run_step_3 ? execute_create_sales_key_metrics : null,
      run_step_3a ? execute_load_big_query_sales_key_metrics : null,
      run_step_4 ? execute_create_year_over_year_key_metrics : null,
      run_step_5 ? execute_load_sales_goal_data : null,
    ];

    const stepName = [
      `Step #1 - Get Sales Data:`, 
      `Step #2 = Load Sales Data: `, 
      `Step #3 - Create Sales Key Metrics: `, 
      `Step #3a - Load Sales Key Metrics to BQ: `, 
      `Step #4 - Create Year-over-Year Data: `, 
      `Step #5 - Create Sales Data:`
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

execute_run_sales_data_jobs();

module.exports = {
  execute_run_sales_data_jobs,
};
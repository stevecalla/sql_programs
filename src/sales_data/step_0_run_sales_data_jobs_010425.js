const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_get_sales_data } = require('./step_1_get_sales_data');
const { execute_load_sales_data } = require('./step_2_load_sales_data');
const { execute_load_region_data } = require('./step_2a_load_region_table');

const { execute_create_sales_key_metrics } = require('./step_3_create_sales_key_metrics_010425');
const { execute_load_big_query_sales_key_metrics } = require('./step_3a_load_bq_sales_key_metrics');

const { execute_create_year_over_year_key_metrics } = require('./step_4_create_sales_year_over_year_metrics_011425');
const { execute_load_big_query_sales_year_over_year_metrics } = require('./step_4a_load_bq_year_over_year_metrics');

const { execute_load_sales_goal_data } = require('./step_5_load_sales_goals');
const { execute_load_big_query_sales_goals } = require('./step_5a_load_bq_sales_goals');

const { execute_create_actual_vs_goal_metrics } = require('./step_6_create_actual_vs_goal_metrics_042925');
const { execute_load_big_query_actual_vs_goal_metrics} = require('./step_6a_load_bq_actual_vs_goal_metrics');

const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

const run_step_1  = true; // get sales data
const run_step_2  = true; // load sales data
const run_step_2a = true; // load region table

const run_step_3  = true; // create sales key metrics stats table
const run_step_3a = true; // load sales key metrics stats to biqquery

const run_step_4  = true; // create year-over-year common date table
const run_step_4a = true; // load sales key metrics stats to biqquery

const run_step_5  = true; // load sales goal data
const run_step_5a = true; // load sales goals to bigquery

const run_step_6  = true; // create actual vs goal data table
const run_step_6a = true; // load actual vs goal to bigquery

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
      run_step_1  ? execute_get_sales_data : null,
      run_step_2  ? execute_load_sales_data : null,
      run_step_2a ? execute_load_region_data : null,
      run_step_3  ? execute_create_sales_key_metrics : null,
      run_step_3a ? execute_load_big_query_sales_key_metrics : null,
      run_step_4  ? execute_create_year_over_year_key_metrics : null,
      run_step_4a ? execute_load_big_query_sales_year_over_year_metrics : null,
      run_step_5  ? execute_load_sales_goal_data : null,
      run_step_5a ? execute_load_big_query_sales_goals : null,
      run_step_6  ? execute_create_actual_vs_goal_metrics : null,
      run_step_6a ? execute_load_big_query_actual_vs_goal_metrics : null,
    ];

    const stepName = [
      `Step #1 - Get Sales Data:`, 
      `Step #2 - Load Sales Data: `, 
      `Step #2a - Load Region Data: `, 
      `Step #3 - Create Sales Key Metrics: `, 
      `Step #3a - Load Sales Key Metrics to BQ: `, 
      `Step #4 - Create Year-over-Year Data: `, 
      `Step #4a - Load Sales YoY Metris to BQ: `,
      `Step #5 - Create Sales Data:`,
      `Step #5a - Load Sales Goals to BQ`,
      `Step 6 - Create Actual vs Goal Metrics Table`,
      `Step #6a - Load Actual vs Goal to BQ`,
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

// execute_run_sales_data_jobs();

module.exports = {
  execute_run_sales_data_jobs,
};
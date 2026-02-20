const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

// GET & LOAD EVENT DATA
const { execute_transfer_usat_to_local } = require('./step_1_transfer_data_usat_to_local'); // Step #1: tranfer USAT event data to Local DB

// const { execute_create_auto_renew_data_metrics } = require('./step_2_create_auto_renew_data_metrics'); // Step #2: execute_create_auto_renew_daa

const { execute_load_big_query_auto_renew_data_metrics } = require('./step_3_load_bq_auto_renew_data_metrics');

const { execute_create_auto_renew_and_sales_renewal_data } = require('./step_4_create_auto_renew_conversion_and_sales_renewal_data');

const { execute_load_biq_query_auto_renew_and_sales_renewal_data } = require('./step_5_load_bq_auto_renew_conversion_and_sales_renenewal_data');

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

async function main() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  const run_step_1 = true; // tranfer USAT event data to Local DB
  // const run_step_2 = false; // execute_create_auto_renew_data_metrics; commented out until needed
  const run_step_3 = true; // load event metrics to bigquery

  const run_step_4 = true; // get / create auto renew & generic sales renewal data
  const run_step_5 = true; // load event auto renew & generic sales renewal data to bigquery

  try {
    const stepFunctions = [
      run_step_1 ? execute_transfer_usat_to_local : null,
      // run_step_2 ? execute_create_event_data_metrics : null,
      run_step_3 ? execute_load_big_query_auto_renew_data_metrics : null,

      run_step_4 ? execute_create_auto_renew_and_sales_renewal_data : null,
      run_step_5 ? execute_load_biq_query_auto_renew_and_sales_renewal_data : null,
    ];

    const stepName = [
      `Step #1 - Transfer data from USAT to Local db: `, 
      // `Step #2 - Create auto_renew data metrics: `, 
      `Step #3 - Load auto_renew metrics to BQ: `,

      `Step #4 - Create auto renew conversion & sales renewal data: `, 
      `Step #5 - Load auto_renew_and_sales_renewal_data to BQ: `,
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
  main();
}

module.exports = {
  execute_run_auto_renew_data_jobs: main
};
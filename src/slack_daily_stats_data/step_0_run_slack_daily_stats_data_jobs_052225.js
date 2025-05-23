const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_step_1_get_slack_daily_stats } = require('./step_1_get_slack_daily_stats_data');
const { execute_create_send_slack_sales_data } = require('./step_3_create_send_slack_sales_data');

const { slack_message_api } = require('../../utilities/slack_messaging/slack_message_api');

const run_step_1 = true; // get daily stats for revenue, events, participation
const run_step_2 = false; // create slack messaage; default = false

async function executeSteps(stepFunctions, is_cron_job, channel_id, channel_name, user_id) {
  for (let i = 0; i < stepFunctions.length; i++) {
    const start_local_time = new Date().toLocaleString(); // Get the current local date and time as a string
    const startTime = performance.now();

    const stepFunction = stepFunctions[i];
    const stepName = `STEP #${i + 1}:`;
    
    console.log(`\n*************** STARTING ${stepName} ***************\n`);
    try {
      if (stepFunction) {
        const results = await stepFunction(is_cron_job, channel_id, channel_name, user_id);

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const message = results ? `${stepName} SUCCESS: All SLACK sales data executed successfully. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.` : `${stepName} ERROR: NOT executed successfully. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime}. Time now = ${end_local_time} MTN.`;

        console.log(message);
        await slack_message_api(message, "steve_calla_slack_channel");

      } else {
        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
        const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

        const skip_message = `${stepName} SKIPPED: All SLACK sales data skipped due to toggle set to false. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.`;

        console.log(skip_message);
        await slack_message_api(skip_message, "steve_calla_slack_channel");
      }

    } catch (error) {
      const endTime = performance.now();
      const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);
      const end_local_time = new Date().toLocaleString(); // Get the current local date and time as a string

      const error_message = `{stepName} ERROR: All SLACK sales Data: ${error}. Start time ${start_local_time} MTN. Elapsed Time: ${elapsedTime} sec. End time = ${end_local_time} MTN.`;

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

async function execute_run_slack_sales_data_jobs(is_cron_job, channel_id, channel_name, user_id) {

  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  try {
    const stepFunctions = [
      run_step_1 ? execute_step_1_get_slack_daily_stats : null,
      run_step_2 ? execute_create_send_slack_daily_stats : null,
    ];

    await executeSteps(stepFunctions, is_cron_job, channel_id, channel_name, user_id);

  } catch (error) {
    console.error('Error in main process:', error);
    return;
  }

  const endTime = performance.now();
  const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); // converts to seconds

  console.log(`\nPROGRAM END TIME: ${getCurrentDateTime()}; ELASPED TIME: ${elapsedTime} sec\n`);

  return elapsedTime;
}

// execute_run_slack_sales_data_jobs();

module.exports = {
  execute_run_slack_sales_data_jobs,
};
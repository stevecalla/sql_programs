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

  const run_step_1 = true; // execute_create_recognition_base_data
  const run_step_2 = true; // load recognition_base_data to BQ

  const run_step_3 = true; // execute_create_recognition_allocation_data
  const run_step_4 = true; // load recognition_allocation_data to BQ

  // =============================
  // Resolve Mountain Time year + month reliably (works even if server is UTC)
  const mtn_parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const mtn_year = Number(mtn_parts.find((p) => p.type === "year")?.value);
  const mtn_month = Number(mtn_parts.find((p) => p.type === "month")?.value); // 1-12

  // If it's December (12) in MTN, shift to current year forward; otherwise use prior year
  const ends_year =
    mtn_month === 12
      ? mtn_year          // December: current year forward
      : mtn_year - 1;     // Jan–Nov: include full prior year

  // Quick examples (MTN)
  // 2025-11-15 → ends_mp = 2024-01-01
  // 2025-12-10 → ends_mp = 2025-01-01

  let QUERY_OPTIONS = {
    ends_mp: `${ends_year}-01-01`,
    // ends_mp: '2025-01-01', // originally 2024-01-01 but changed to 2025-01-01 12/27/25 due to BigQuery costs
    is_create_table: true,
  };

  console.log(
    `📅 QUERY_OPTIONS.ends_mp resolved as ${QUERY_OPTIONS.ends_mp} (MTN-based)`
  );
  // =============================

  try {
    const stepFunctions = [
      run_step_1 ? () => execute_create_recognition_base_data(QUERY_OPTIONS) : null,
      run_step_2 ? () => execute_load_big_query_recognition_base_data(QUERY_OPTIONS) : null,
      run_step_3 ? () => execute_create_recognition_allocation_data(QUERY_OPTIONS) : null,
      run_step_4 ? () => execute_load_big_query_recognition_allocation_data(QUERY_OPTIONS) : null,
    ];

    // const stepFunctions = [
    //   run_step_1 ? execute_create_recognition_base_data : null,
    //   run_step_2 ? execute_load_big_query_recognition_base_data : null,

    //   run_step_3 ? execute_create_recognition_allocation_data : null,
    //   run_step_4 ? execute_load_big_query_recognition_allocation_data : null,
    // ];

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

// execute_run_recognition_data_jobs();

module.exports = {
  execute_run_recognition_data_jobs,
};
const dotenv = require('dotenv');
dotenv.config({ path: "./.env" });

const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

// GET & LOAD PARTICIPATION DATA
const { execute_get_participation_data } = require('./step_1_get_participation_data');
const { execute_load_participation_data } = require('./step_2_load_participation_data');
// const { execute_load_region_data } = require('./step_2a_load_region_table');

// MATCH PARTICIPATION & MEMBERSHIP DATA; 
const { execute_create_participation_with_membership_match } = require("./step_3_create_participation_with_membership_match");
// TODO: LOAD ALL PARTICIPATION DATA TO BQ / CREATE AGE BUCKETS & BREAKOUT
const { execute_load_big_query_participation_membership_sales_match } = require('./step_3a_1_load_bq_participation_match_profiles_metrics');

// CREATE & LOAD PARTICIPATION USER PROFILE
const { execute_create_participation_profile_table } = require("./step_3a_create_participation_match_profile");
const { execute_load_big_query_participation_profile_metrics } = require('./step_3b_load_bq_participation_match_profiles_metrics');

// CREATE & LOAD PARTICIPATION RACE PROFILE
const { execute_create_participation_race_profile_tables } = require("./step_3c_create_participation_match_race_profile");
const { execute_load_big_query_participation_race_profile_metrics } = require('./step_3d_load_bq_participation_match_race_profile_metrics');

// CREATE & LOAD IRONMAN BEHAVIOR PROFILE
const { execute_create_ironman_profile_tables } = require("./step_3e_create_ironman_profile");
const { execute_load_big_query_ironman_profile_metrics } = require('./step_3f_load_bq_ironman_profile_metrics');

// CREATE & LOAD IRONMAN BEHAVIOR TIME-SERIES
const { execute_create_ironman_timeseries_tables } = require("./step_3g_create_ironman_timeseries");
const { execute_load_big_query_ironman_timeseries_metrics } = require('./step_3h_load_bq_ironman_timeseries_metrics');

// MATCH MEMBERSHIP & PARTICIPATION DATA
const { execute_create_membership_with_participation_match } = require("./step_4_create_membership_with_participation_match");

// STATE CHAMPIIONSHIP DATA
const { execute_create_participation_state_championship_data } = require('./step_10_create_participation_state_championship_data');
const { execute_load_big_query_all_participation_state_rankings_results } = require('./step_11_load_bq_create_participation_state_championship_data');

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

async function main() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  const run_step_1  = true; // get all participation data
  const run_step_2  = true; // load participation data
  // const run_step_2a = true; // load region table

  const run_step_3  = true; // create table participation with membership sales match
  const run_step_3a_1 = true; // load participation with membership sales match to bigquery

  const run_step_3a = true; // create participation profile (profile_id) table
  const run_step_3b = true; // load membership participation match profile to bigquery
  const run_step_3c = true; // create membership participation race (race_id) profile table
  const run_step_3d = true; // load membership participation match race to bigquery

  const run_step_3e = true; // create ironman behavior profile tables (#1-#3) + CSV export
  const run_step_3f = true; // load ironman behavior profile (#3) to bigquery
  const run_step_3g = true; // create ironman behavior time-series (#4-#5)
  const run_step_3h = true; // load ironman behavior time-series to bigquery

  // const run_step_4 = true; // create table membership with participation match

  const run_step_10 = true; // create all_participation_state_rankings_results
  const run_step_11 = true; // load all_participation_state_rankings_results to bigquery

  try {
    const stepFunctions = [
      run_step_1  ? execute_get_participation_data : null,
      run_step_2  ? execute_load_participation_data : null,
      // run_step_2a ? execute_load_region_data : null,

      run_step_3 ? execute_create_participation_with_membership_match : null,
      run_step_3a_1 ? execute_load_big_query_participation_membership_sales_match : null,

      run_step_3a ? execute_create_participation_profile_table : null,
      run_step_3b ? execute_load_big_query_participation_profile_metrics : null,

      run_step_3c ? execute_create_participation_race_profile_tables : null,
      run_step_3d ? execute_load_big_query_participation_race_profile_metrics : null,

      run_step_3e ? execute_create_ironman_profile_tables : null,
      run_step_3f ? execute_load_big_query_ironman_profile_metrics : null,
      run_step_3g ? execute_create_ironman_timeseries_tables : null,
      run_step_3h ? execute_load_big_query_ironman_timeseries_metrics : null,

      // run_step_4 ? execute_create_membership_with_participation_match : null,

      run_step_10 ? execute_create_participation_state_championship_data : null,
      run_step_11 ? execute_load_big_query_all_participation_state_rankings_results : null,

    ];

    const stepName = [
      `Step #1 - Get participation Data:`, 
      `Step #2 - Load participation Data: `, 
      // `Step #2a - Load Region Data: `, 

      `Step #3 - Created participation data with membership match`,
      `Step #3a_1 - Load participation membership sales match to BQ: `,

      `Step #3a - Created participation profile table`, // takes about 10 minutes
      `Step #3b - Load participation profile to BQ: `,

      `Step #3c - Created participation race profile table`, // takes about 3 minutes
      `Step #3d - Load participation race profile to BQ: `,

      `Step #3e - Created ironman behavior profile table (#1-#3) + CSV`,
      `Step #3f - Load ironman behavior profile to BQ: `,
      `Step #3g - Created ironman behavior time-series (#4-#5)`,
      `Step #3h - Load ironman behavior time-series to BQ: `,

      // `Step #4 - Created membership data with participation match`,

      `Step #10 - create all_participation_state_rankings_results`,
      `Step #11 = load all_participation_state_rankings_results to bigquery`

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
  main().catch((error) => {
    console.error("error during event load:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  execute_run_participation_data_jobs: main,
};
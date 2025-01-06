const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_get_sales_data } = require('./step_1_get_sales_data');
const { execute_load_sales_data } = require('./step_2_load_sales_data');
const { execute_create_sales_key_metrics } = require('./step_3_create_sales_key_metrics_010425');

const run_step_1 = true; // get sales data
const run_step_2 = true; // load sales data
const run_step_3 = true; // create sales stats summary

async function executeSteps(stepFunctions) {
  for (let i = 0; i < stepFunctions.length; i++) {

    const stepFunction = stepFunctions[i];

    if (stepFunction) {
      const stepName = `STEP #${i + 1}`;
      console.log(`\n*************** STARTING ${stepName} ***************\n`);

      try { // Add try/catch within the loop for individual step error handling
        const getResults = await stepFunction();
        const message = getResults ? `${stepName} executed successfully. Elapsed Time: ${getResults}` : `${stepName} executed successfully.`; // Modified message
        console.log(message);

      } catch (error) {
        console.error(`Error executing ${stepName}:`, error);
        // Decide whether to continue or break the loop here.
        // For example, to stop on the first error:
        break;
        // To continue despite errors in individual steps:
        // continue;
      }

      console.log('\n*************** END OF', stepName, '**************\n');
    } else {
      console.log(`Skipped STEP #${i + 1} due to toggle set to false.`);
    }
  }
}

async function execute_run_sales_data_jobs() {
  const startTime = performance.now();

  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);

  try {
    const stepFunctions = [
      run_step_1 ? execute_get_sales_data: null,
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

execute_run_sales_data_jobs();

module.exports = {
  execute_run_sales_data_jobs,
};
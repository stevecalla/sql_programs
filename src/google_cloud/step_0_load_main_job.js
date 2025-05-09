const { getCurrentDateTime } = require('../../utilities/getCurrentDate');

const { execute_retrieve_data } = require('./step_1_retrieve_data_process');
const { execute_upload_csv_to_cloud } = require('./step_2_upload_csv_to_cloud');
const { execute_create_bigquery_dataset } = require('./step_3_create_bigquery_dataset');
const { execute_load_big_query_database } = require('./step_4_load_biq_query_database');

const run_step_1 = true;
const run_step_2 = true;
const run_step_3 = true;
const run_step_4 = true;

async function executeSteps(stepFunctions, options, datasetId, bucketName, schema, directoryName) {

  for (let i = 0; i < stepFunctions.length; i++) {

    const stepFunction = stepFunctions[i];

    if (stepFunction) {
      const stepName = `STEP #${i + 1}`;
      console.log(`\n*************** STARTING ${stepName} ***************\n`);

      try { // Add try/catch within the loop for individual step error handling
        const getResults = await stepFunction(options, datasetId, bucketName, schema, directoryName);

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

async function execute_load_data_to_bigquery(options, datasetId, bucketName, schema, directoryName) {
  const startTime = performance.now();
  console.log(`\n\nPROGRAM START TIME = ${getCurrentDateTime()}`);
  
  try {
    const stepFunctions = [
      run_step_1 ? execute_retrieve_data : null,
      run_step_2 ? execute_upload_csv_to_cloud : null,
      run_step_3 ? execute_create_bigquery_dataset : null,
      run_step_4 ? execute_load_big_query_database : null,
    ];

    await executeSteps(stepFunctions, options, datasetId, bucketName, schema, directoryName); // Call the new function

  } catch (error) {
    console.error('Error in main process:', error); // More specific message
    return;
  }

  const endTime = performance.now();
  const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2);

  console.log(`\nPROGRAM END TIME: ${getCurrentDateTime()}; ELASPED TIME: ${elapsedTime} sec\n`);

  return elapsedTime;
}

// execute_load_data_to_bigquery();

module.exports = {
  execute_load_data_to_bigquery,
};
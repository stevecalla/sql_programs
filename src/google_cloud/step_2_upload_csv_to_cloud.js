const fs = require('fs').promises;
const { exec } = require('child_process');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { determineOSPath } = require('../../utilities/determineOSPath');
const { execute_google_cloud_command } = require('./google_cloud_execute_command');

// ASYNC FUNCTION TO UPLOAD CSV FILES TO GOOGLE CLOUD STORAGE
async function execute_upload_csv_to_cloud(options, datasetId, bucketName, schema) {
  
  const destinationPath = `gs://${bucketName}/`;

  try {
    const startTime = performance.now();

    const os_path = await determineOSPath();
    let directoryName = `usat_google_bigquery_data`;
    const directory = `${os_path}${directoryName}`;

    // GOOGLE CLOUD = LOGIN AND SET PROPERTY ID
    await execute_google_cloud_command("login", "Login successful");
    await execute_google_cloud_command("set_property_id", "Project Id set successfully.");
    
    const files = await fs.readdir(directory); // LIST ALL FILES IN THE DIRECTORY
    console.log(files);
    let numberOfFiles = 0;

    // ITERATE THROUGH EACH FILE USING A FOR...OF LOOP
    for (const file of files) {
      if (file.endsWith('.csv')) {
        numberOfFiles++;
        const localFilePath = `${directory}/${file}`;
        const command = `gsutil cp "${localFilePath}" ${destinationPath}`;

        // AWAIT EXECUTION OF GSUTIL CP COMMAND
        await new Promise((resolve, reject) => {
          exec(command, (error, stdout, stderr) => {
            if (error) {
              console.error('Error:', error);
              reject(error); // REJECT THE PROMISE IF THERE'S AN ERROR
              return;
            }

            console.log('File uploaded successfully.');
            console.log('stdout:', stdout);
            console.error('stderr:', stderr);

            resolve(); // RESOLVE THE PROMISE AFTER UPLOAD COMPLETES
          });
        });
      }
    }

    const endTime = performance.now();
    const elapsedTime = ((endTime - startTime) / 1000).toFixed(2); // CONVERT MS TO SEC
    return elapsedTime; // RETURN ELAPSED TIME AFTER ALL UPLOADS COMPLETE
  } catch (error) {
    console.error('Error:', error);
    throw error; // THROW ERROR IF AN ERROR OCCURS DURING UPLOAD PROCESS
  }
}

// execute_upload_csv_to_cloud();

module.exports = {
  execute_upload_csv_to_cloud,
};

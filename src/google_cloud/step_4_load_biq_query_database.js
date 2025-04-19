'use strict';
const fs = require('fs').promises;
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { determineOSPath } = require('../../utilities/determineOSPath');

const { execute_google_cloud_command } = require('./google_cloud_execute_command');

// membership-reporting-447700.membership_reporting.membership_data

// Import a GCS file into a table with manually defined schema.
async function execute_load_big_query_database(options, datasetId, bucketName, schema, directoryName) {
    const startTime = performance.now();
    let elapsedTime;
        
    // GOOGLE CLOUD = LOGIN AND SET PROPERTY ID
    await execute_google_cloud_command("login", "Login successful", "login_to_google_cloud");
    await execute_google_cloud_command("set_property_id", "Project Id set successfully.", "set_project_id_for_google_cloud");
    
    // Instantiate clients
    const bigqueryClient = new BigQuery({ credentials: JSON.parse(process.env.USAT_GOOGLE_SERVICE_ACCOUNT) });
    const storageClient = new Storage();
    
    /**
     * This sample loads the CSV file at
     * https://storage.googleapis.com/cloud-samples-data/bigquery/us-states/us-states.csv
    *
    * TODO(developer): Replace the following lines with the path to your file.
    */

    const os_path = await determineOSPath();
    const directory = `${os_path}${directoryName}`;

    const files = await fs.readdir(directory); // LIST ALL FILES IN THE DIRECTORY
    console.log('files length = ', files.length)
    console.log(files);
    let numberOfFiles = 0;

    // Loop through files and load them into the same BigQuery table
    for (const filePath of files) {
        let metadata = "";

        if (schema) {
            metadata =  {
                sourceFormat: 'CSV',
                skipLeadingRows: 1,
                schema: { fields: schema },
                location: 'US',
                writeDisposition: 'WRITE_APPEND', // Append data to the table
                // writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
            };
        } else {
            metadata =  {
                sourceFormat: 'CSV',
                skipLeadingRows: 1,
                autodetect: true,
                location: 'US',
                writeDisposition: 'WRITE_APPEND', // Append data to the table
                // writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
            };
        }
        // Configure the load job metadata
        // const metadata =  {
        //     sourceFormat: 'CSV',
        //     skipLeadingRows: 1,
        //     schema: { fields: schema },
        //     location: 'US',
        //     // writeDisposition: 'WRITE_APPEND', // Append data to the table
        //     writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
        // };

        // const metadata = options[0].tableId === "membership_data" ? {
        //     sourceFormat: 'CSV',
        //     skipLeadingRows: 1,
        //     schema: { fields: schema },
        //     location: 'US',
        //     // writeDisposition: 'WRITE_APPEND', // Append data to the table
        //     writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
        // } : {
            // sourceFormat: 'CSV',
            // skipLeadingRows: 1,
            // autodetect: true,
            // location: 'US',
            // // writeDisposition: 'WRITE_APPEND', // Append data to the table
            // writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
        // };

        // Load data from the file into the BigQuery table
        const [job] = await bigqueryClient // without await this does error
            .dataset(datasetId) // Replace with your dataset ID
            .table(options[0].tableId) // Replace with the single target table name
            .load(storageClient.bucket(bucketName).file(filePath), metadata);

        console.log(`File ${++numberOfFiles} of ${files.length}, File name: ${filePath}`);
        console.log(`Job ${job.id} completed.`);

        // Check the job's status for errors
        const errors = job.status.errors;
        if (errors && errors.length > 0) {
            throw errors;
        }
    }
    const endTime = performance.now();
    elapsedTime = ((endTime - startTime) / 1000).toFixed(2); // CONVERT MS TO SEC
    console.log(`STEP #4: Elapsed time: ${elapsedTime}\n`);
    return elapsedTime;
}

// execute_load_big_query_database();

module.exports = {
    execute_load_big_query_database,
}
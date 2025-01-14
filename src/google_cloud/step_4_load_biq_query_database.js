'use strict';
const fs = require('fs').promises;
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { determineOSPath } = require('../../utilities/determineOSPath');

const { execute_google_cloud_command } = require('./google_cloud_execute_command');

const { members_schema } = require('./schemas/schema_member_data');

const bucketName = 'membership-reporting';
const datasetId = "membership_reporting";
const tableIds = ["membership_data"];
const tableName = "membership_data";

// membership-reporting-447700.membership_reporting.membership_data

// Import a GCS file into a table with manually defined schema.
async function execute_load_big_query_database() {
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
    let directoryName = `google_cloud_member_data`;
    const directory = `${os_path}${directoryName}`;

    const files = await fs.readdir(directory); // LIST ALL FILES IN THE DIRECTORY
    console.log('files length = ', files.length)
    console.log(files);
    let numberOfFiles = 0;

    // Merge arrays into an object using map
    // const merged_table_details = tableIds.map((table_name, index) => {
    //     return {
    //         tableName: table_name,
    //         tablePath: files[index],
    //     }
    // });
    // const filesLength = merged_table_details.length;

    // Imports a GCS file into a table with auto detect defined schema.

    // for (const file of merged_table_details) {

    //     // Configure the load job. For full list of options, see:
    //     // https://cloud.google.com/bigquery/docs/reference/rest/v2/Job#JobConfigurationLoad
    //     // source: https://cloud.google.com/bigquery/docs/samples/bigquery-load-table-gcs-csv-truncate
    //     const metadata = file.tableName === "booking_data" ? {
    //         sourceFormat: 'CSV',
    //         skipLeadingRows: 1,
    //         schema: { fields: member_schema },
    //         // autodetect: true,
    //         location: 'US',
    //         // Set the write disposition to overwrite existing table data.
    //         writeDisposition: 'WRITE_TRUNCATE',
    //     } : {
    //         sourceFormat: 'CSV',
    //         skipLeadingRows: 1,
    //         autodetect: true,
    //         location: 'US',
    //         // Set the write disposition to overwrite existing table data.
    //         writeDisposition: 'WRITE_TRUNCATE',
    //     };
    
    //     // Load data from a Google Cloud Storage file into the table
    //     const [job] = await bigqueryClient
    //         .dataset(datasetId)
    //         .table(file.tableName)
    //         .load(storageClient.bucket(bucketName).file(file.tablePath), metadata);
            
    //     const endTime = performance.now();
    //     elapsedTime = ((endTime - startTime) / 1000).toFixed(2); // CONVERT MS TO SEC
        
    //     // load() waits for the job to finish
    //     console.log(`File ${++numberOfFiles} of ${filesLength}, File name: ${file.tableName}`);
    //     console.log(`Job ${job.id} completed. Elapsed time: ${elapsedTime}\n`);
    
    //     // Check the job's status for errors
    //     const errors = job.status.errors;
    //     if (errors && errors.length > 0) {
    //         throw errors;
    //     }
    // }

    // Loop through files and load them into the same BigQuery table
    for (const filePath of files) {
        // Configure the load job metadataj
        const metadata = tableName === "membership_data" ? {
            sourceFormat: 'CSV',
            skipLeadingRows: 1,
            schema: { fields: members_schema },
            location: 'US',
            writeDisposition: 'WRITE_APPEND', // Append data to the table
            // writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
        } : {
            sourceFormat: 'CSV',
            skipLeadingRows: 1,
            autodetect: true,
            location: 'US',
            writeDisposition: 'WRITE_APPEND', // Append data to the table
            // writeDisposition: 'WRITE_TRUNCATE', // overwrite the current table
        };

        // Load data from the file into the BigQuery table
        const [job] = await bigqueryClient // without await this does error
            .dataset(datasetId) // Replace with your dataset ID
            .table(tableName) // Replace with the single target table name
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
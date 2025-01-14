'use strict';
const { BigQuery } = require('@google-cloud/bigquery');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { execute_google_cloud_command } = require('./google_cloud_execute_command');

const datasetId = "membership_reporting";
const tableIds = ["membership_data"];

async function execute_create_bigquery_dataset() {
    try {
        const startTime = performance.now();
        
        // GOOGLE CLOUD = LOGIN AND SET PROPERTY ID
        await execute_google_cloud_command("login", "Login successful", "login_to_google_cloud");
        await execute_google_cloud_command("set_property_id", "Project Id set successfully.", "set_project_id_for_google_cloud");

        // Create a client with custom credentials
        const bigqueryClient = new BigQuery({ credentials: JSON.parse(process.env.USAT_GOOGLE_SERVICE_ACCOUNT) });

        // Create the dataset if it doesn't exist
        const [dataset] = await bigqueryClient.dataset(datasetId).get({ autoCreate: true });
        console.log(`Dataset ${dataset.id} created or already exists.`);

        const options = {
            location: 'US',
        };

        for (const tableId of tableIds) {
            // Check if the table already exists
            const [tableExists] = await bigqueryClient
                .dataset(datasetId)
                .table(tableId)
                .exists();
    
            if (tableExists) {
                // Replace the existing table if it exists
                await bigqueryClient
                    .dataset(datasetId)
                    .table(tableId)
                    .delete({ force: true }); // Delete the table with force option
            }
    
            // Create a new table in the dataset or replace the existing one
            const [table] = await bigqueryClient
                .dataset(datasetId)
                .createTable(tableId, {
                    ...options,
                    replace: true, // Replace the table if it already exists
                });
    
            console.log(`Table ${table.id} created.`);
        }

        const endTime = performance.now();
        const elapsedTime = ((endTime - startTime) / 1_000).toFixed(2); //convert ms to sec
        return (elapsedTime); // Resolve the promise with the elapsed time

    } catch (error) {
        console.error('Error:', error);
        // reject(error); // Reject the promise if there's an error
    }
}

// execute_create_bigquery_dataset();

module.exports = {
    execute_create_bigquery_dataset,
}

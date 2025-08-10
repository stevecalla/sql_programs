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
  // const storageClient = new Storage(); // not needed when using URIs array

  // Build list of GCS URIs from local filenames
  const os_path = await determineOSPath();
  const directory = `${os_path}${directoryName}`;
  const files = (await fs.readdir(directory)).filter(f => f.endsWith('.csv'));
  console.log('files length = ', files.length);
  console.log(files);

  if (!files.length) {
    console.log('No CSV files found. Skipping load.');
    return '0.00';
  }

  const uris = files.map(f => `gs://${bucketName}/${f}`);

  // One metadata object for the single load job
  const metadata = schema ? {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    schema: { fields: schema },
    location: 'US',
    compression: 'GZIP',              // files were uploaded with gsutil -Z
    writeDisposition: 'WRITE_APPEND', // Append data to the table
    // writeDisposition: 'WRITE_TRUNCATE',
  } : {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    autodetect: true,
    location: 'US',
    compression: 'GZIP',              // files were uploaded with gsutil -Z
    writeDisposition: 'WRITE_APPEND',
    // writeDisposition: 'WRITE_TRUNCATE',
  };

  // Single load job for all files
  const [job] = await bigqueryClient
    .dataset(datasetId)
    .table(options[0].tableId)
    .load(uris, metadata);

  console.log(`Job ${job.id} started for ${uris.length} files...`);
  // Optional: wait for completion + check for errors
  const [metadataResp] = await job.getMetadata();
  const errors = metadataResp.status?.errors;
  if (errors && errors.length > 0) {
    console.error('Load job errors:', errors);
    throw errors;
  }
  console.log(`Job ${job.id} completed.`);

  const endTime = performance.now();
  elapsedTime = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`STEP #4: Elapsed time: ${elapsedTime}\n`);
  return elapsedTime;
}

// execute_load_big_query_database();

module.exports = {
  execute_load_big_query_database,
};

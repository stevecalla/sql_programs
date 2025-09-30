'use strict';

const fs = require('fs').promises;
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { determineOSPath } = require('../../utilities/determineOSPath');
const { execute_google_cloud_command } = require('./google_cloud_execute_command');

const sleep = ms => new Promise(res => setTimeout(res, ms));

// membership-reporting-447700.membership_reporting.membership_data
async function execute_load_big_query_database(options, datasetId, bucketName, schema, directoryName) {
  const startTime = performance.now();

  await execute_google_cloud_command("login", "Login successful", "login_to_google_cloud");
  await execute_google_cloud_command("set_property_id", "Project Id set successfully.", "set_project_id_for_google_cloud");

  const bigquery = new BigQuery({
    credentials: JSON.parse(process.env.USAT_GOOGLE_SERVICE_ACCOUNT),
  });
  const storage = new Storage();

  // Discover local filenames (we assume you uploaded them to the bucket root)
  const os_path = await determineOSPath();
  const directory = `${os_path}${directoryName}`;
  const files = (await fs.readdir(directory)).filter(f => f.endsWith('.csv'));

  console.log('files length =', files.length);
  console.log(files);
  if (!files.length) {
    console.log('No CSV files found. Skipping load.');
    return '0.00';
  }

  // Build Storage File objects
  const fileObjs = files.map(name => storage.bucket(bucketName).file(name));
  const uris = files.map(f => `gs://${bucketName}/${f}`);
  console.log('URIs being passed to BQ:', uris);

  // Load job metadata
  const metadata = schema ? {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    schema: { fields: schema },
    location: 'US',
    compression: 'GZIP',          // because you used gsutil -Z
    writeDisposition: 'WRITE_APPEND',
    allowQuotedNewlines: true,    // let BigQuery accept quoted embedded \n
    quote: '"',                   // explicitly set quote char
    // maxBadRecords: 10,            // tolerate a few malform

  } : {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    autodetect: true,
    location: 'US',
    compression: 'GZIP',
    writeDisposition: 'WRITE_APPEND',
    allowQuotedNewlines: true,    // let BigQuery accept quoted embedded \n
    quote: '"',                   // explicitly set quote char
    // maxBadRecords: 10,            // tolerate a few malform
  };

  try {
    // Kick off a single load job for all files
    const [job] = await bigquery
      .dataset(datasetId)
      .table(options[0].tableId)
      .load(fileObjs, metadata);

    console.log(`Job ${job.id} started for ${fileObjs.length} files...`);

    // Parse job.id which looks like "<project>:<location>.<jobId>"
    let projectId, location, jobId;
    const m = typeof job.id === 'string' && job.id.match(/^([^:]+):([^.]+)\.(.+)$/);
    if (m) {
      [, projectId, location, jobId] = m;
    } else {
      // Fallback: if format differs, assume US and use whole id as jobId
      jobId = job.id;
      location = metadata.location || 'US';
    }

    // Create a fresh job handle and poll until DONE
    const pollJob = bigquery.job(jobId, { location });
    let meta;
    while (true) {
      [meta] = await pollJob.getMetadata();
      const state = meta?.status?.state;
      if (state === 'DONE') break;
      await sleep(2000);
    }

    const errors = meta?.status?.errors;
    const errorResult = meta?.status?.errorResult;
    if (errors?.length || errorResult) {
      console.error('Load job errors:', errors || errorResult);
      throw new Error('BigQuery load job failed');
    }

    console.log('Load status:', meta?.status?.state);
    console.log('Input files:', meta?.statistics?.load?.inputFiles);
    console.log('Output rows:', meta?.statistics?.load?.outputRows);
    console.log('Output bytes:', meta?.statistics?.load?.outputBytes);
    console.log(`Job ${jobId} completed.`);

    const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`STEP #4: Elapsed time: ${elapsedTime}\n`);
    return elapsedTime;
  } catch (err) {
    console.error('Error in BigQuery load:', err);
    throw err;
  }
}

module.exports = {
  execute_load_big_query_database,
};

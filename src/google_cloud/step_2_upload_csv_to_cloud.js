const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const { determineOSPath } = require('../../utilities/determineOSPath');
const { execute_google_cloud_command } = require('./google_cloud_execute_command');

async function execute_upload_csv_to_cloud(options, datasetId, bucketName, schema, directoryName) {
  const destinationPath = `gs://${bucketName}/`;

  // If you already authenticate at process start, you can skip login.
  await execute_google_cloud_command("set_property_id", "Project Id set successfully.");

  const os_path = await determineOSPath();
  const directory = `${os_path}${directoryName}`;

  // 📌 List CSV files in the directory before upload
  const files = (await fs.readdir(directory)).filter(f => f.endsWith('.csv'));
  console.log("Files to be uploaded:");
  files.forEach(file => console.log(path.join(directory, file)));

  const start = performance.now();

  const cmd = [
    `gsutil -m`,
    `-o "GSUtil:parallel_thread_count=24"`,
    ...(os.platform() !== 'win32' ? [`-o "GSUtil:parallel_process_count=4"`] : []),
    // `-o "GSUtil:parallel_composite_upload_threshold=150M"`, // optional: for very large files
    `cp`,
    `-Z`, // or use `-z csv` for broader compatibility
    `*.csv`,
    destinationPath
  ].join(' ');

  await new Promise((resolve, reject) => {
    exec(cmd, { cwd: directory }, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      resolve();
    });
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  return elapsed;
}

module.exports = { execute_upload_csv_to_cloud };

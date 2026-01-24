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
  await execute_google_cloud_command("login", "Login successful", "login_to_google_cloud");
  await execute_google_cloud_command("set_property_id", "Project Id set successfully.");

  const os_path = await determineOSPath();
  const directory = `${os_path}${directoryName}`;

  console.log("UPLOAD CWD DIRECTORY =", directory);
  console.log("PROCESS CWD =", process.cwd());

  // 📌 List CSV files in the directory before upload
  const files = (await fs.readdir(directory)).filter(f => f.endsWith('.csv'));
  console.log("Files to be uploaded:");
  files.forEach(file => console.log(path.join(directory, file)));

  const start = performance.now();

  // --- STRIP UTF-8 BOM + DELETE EMPTY CSVs (NO CHANGE TO gsutil cmd) ---
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const buf = await fs.readFile(fullPath);

    // If file is empty or only whitespace/newlines, DELETE it so *.csv won't match
    const asText = buf.toString('utf8');
    if (!asText.trim()) {
      console.log(`🟡 SKIP EMPTY CSV (DELETING BEFORE UPLOAD): ${file}`);
      await fs.unlink(fullPath);
      continue;
    }

    // Strip UTF-8 BOM if present
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      await fs.writeFile(fullPath, buf.slice(3));
      console.log(`✅ STRIPPED BOM: ${file}`);
    }
  };

  const cmd = [
    `gsutil -m`,
    `-o "GSUtil:parallel_thread_count=24"`,
    ...(os.platform() !== 'win32' ? [`-o "GSUtil:parallel_process_count=4"`] : []),
    // `-o "GSUtil:parallel_composite_upload_threshold=150M"`, // optional: for very large files
    `cp`,
    `-Z`, // or use `-z csv` for broader compatibility
    // `-z csv`, // or use `-z csv` for broader compatibility
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
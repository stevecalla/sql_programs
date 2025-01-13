const { exec } = require("child_process");

// Function to execute a curl command with a delay
const runCurlWithDelay = async (url, delay) => {
  console.log(`Starting curl for URL: ${url}`);
  
  return new Promise((resolve) => {
    // Execute the curl command
    exec(`curl ${url}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
      }
      if (stderr) {
        console.error(`Stderr: ${stderr}`);
      }
      console.log(`Output: ${stdout}`);

      // Wait for the specified delay before resolving
      setTimeout(resolve, delay);
    });
  });
};

// Main function to run the curl command
const main = async () => {
  const url = "https://usat-sales.kidderwise.org/scheduled-all-sales";
  const delayBetweenInstances = 5000; // 5 seconds in milliseconds

  console.log("Starting delayed curl script...");
  await runCurlWithDelay(url, delayBetweenInstances);
  console.log("Curl completed.");
};

main().catch((err) => {
  console.error(`Error in script: ${err.message}`);
});


// pm2 start /home/usat-server/development/usat/sql_programs/utilities/pm2_scripts/pm2_delayed_curl_fork.js -i 2 --name "delayed-curl-cluster"  && pm2 delete delayed-curl-cluster

// pm2 start /home/usat-server/development/usat/sql_programs/utilities/pm2_scripts/pm2_delayed_curl_fork.js -i 2 --name "delayed-curl-cluster" \
// && pm2 wait delayed-curl-cluster \
// && pm2 delete delayed-curl-cluster


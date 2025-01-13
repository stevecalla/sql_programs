const cluster = require("cluster");
const { exec } = require("child_process");

if (cluster.isMaster) {
  // Fork workers (number of CPUs or as required)
  const numCPUs = 4; // Adjust as needed
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  // Worker logic
  const url = "https://usat-sales.kidderwise.org/scheduled-all-sales";
  const delayBetweenInstances = 5000;

  const runCurlWithDelay = async (url, delay) => {
    console.log(`Worker ${cluster.worker.id} starting curl for URL: ${url}`);
    
    return new Promise((resolve) => {
      exec(`curl ${url}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Worker ${cluster.worker.id} Error: ${error.message}`);
        }
        if (stderr) {
          console.error(`Worker ${cluster.worker.id} Stderr: ${stderr}`);
        }
        console.log(`Worker ${cluster.worker.id} Output: ${stdout}`);

        setTimeout(resolve, delay);
      });
    });
  };

  const main = async () => {
    console.log(`Worker ${cluster.worker.id} running`);
    await runCurlWithDelay(url, delayBetweenInstances);
    console.log(`Worker ${cluster.worker.id} completed.`);
  };

  main().catch((err) => {
    console.error(`Worker ${cluster.worker.id} Error in script: ${err.message}`);
  });
}

// pm2 start /home/usat-server/development/usat/sql_programs/utilities/pm2_scripts/pm2_delayed_curl_cluster.js --name "curl-cluster" -i max


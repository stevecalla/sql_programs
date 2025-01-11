const pm2 = require('pm2');

pm2.connect((err) => {
  if (err) {
    console.error('Error connecting to PM2:', err);
    process.exit(2);
  }

  function startInstance(name, delay) {
    setTimeout(() => {
      pm2.start(
        {
          script: 'bash',
          // args: ['-c', `curl -X GET http://localhost:8001/scheduled-all-sales && pm2 delete ${name}`],
          args: ['-c', `curl -X GET http://localhost:8001/scheduled-all-sales`],
          name: name,
          autorestart: false,
        },
        (err, apps) => {
          if (err) {
            console.error(`Error starting ${name}:`, err);
            return;
          }
          console.log(`${name} started.`);
        }
      );
    }, delay);
  }

  // Start the first instance immediately
  startInstance('curl_runner_1', 0);

  // Start the second instance after 5 seconds
  startInstance('curl_runner_2', 5000);

  // Start the second instance after 5 seconds
  startInstance('curl_runner_3', 10000);

  // Start the second instance after 5 seconds
  startInstance('curl_runner_4', 15000);

  pm2.disconnect();
});

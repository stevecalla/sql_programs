const pm2 = require('pm2');

pm2.connect((err) => {
  if (err) {
    console.error('Error connecting to PM2:', err);
    process.exit(2);
  }

  pm2.start(
    {
      script: 'bash', // Specify the script to run (bash in this case)
      args: ['-c', 'curl -X GET http://localhost:8001/scheduled-all-sales && pm2 delete curl_runner'], // Arguments for bash
      name: 'curl_runner', // Process name
      autorestart: false, // Equivalent to --no-autorestart
      instances: 2, // Equivalent to -i 1
    },
    (err, apps) => {
      if (err) {
        console.error('Error starting process:', err);
        pm2.disconnect(); // Ensure PM2 is disconnected on error
        return;
      }

    //   console.log('Process started:', apps);

      // Optionally list running processes
      pm2.list((err, list) => {
        if (err) {
          console.error('Error listing processes:', err);
        } else {
        //   console.log('PM2 process list:', list);
        }

        pm2.disconnect(); // Disconnect from PM2
      });
    }
  );
});

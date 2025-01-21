const pm2 = require('pm2');
const { logPM2MemoryUsage } = require('./pm2_log_memory_usage');

// Function to restart the PM2 process
async function restartPM2Process(app_name) {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error("Error connecting to PM2:", err);
                return reject(err);
            }

            pm2.restart({
                    name: app_name,
                    scriptArgs: ['--post-restart']
                }, (err) => {
                if (err) {
                    console.error(`Error restarting PM2 process '${app_name}':`, err);
                    pm2.disconnect();
                    return reject(err);
                } else {
                    console.log(`PM2 process '${app_name}' restarted successfully.`);
                    pm2.disconnect();
                    resolve();
                }
            });
        });
    });
}

module.exports = {
    restartPM2Process,
}
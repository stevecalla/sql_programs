const pm2 = require('pm2');

// Function to log PM2 memory usage
async function logPM2MemoryUsage(app_name = null) {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error("Error connecting to PM2:", err);
                return reject(err);
            }

            pm2.list((err, processList) => {
                if (err) {
                    console.error("Error fetching PM2 process list:", err);
                    pm2.disconnect();
                    return reject(err);
                }

                console.log("\n[PM2 Memory Usage]");
                let foundApp = false;
                processList.forEach((proc) => {
                    if (!app_name || proc.name === app_name) {
                        foundApp = true;
                        const rss = (proc.monit.memory / 1024 / 1024).toFixed(2);
                        console.log(`  App: ${proc.name}`);
                        console.log(`    RSS: ${rss} MB`);
                        console.log(`    CPU: ${proc.monit.cpu}%`);
                    }
                });

                if (!foundApp) {
                    console.warn(`No PM2 process found with name: ${app_name}`);
                }

                pm2.disconnect();
                resolve();
            });
        });
    });
}

module.exports = {
    logPM2MemoryUsage,
}
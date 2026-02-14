const express = require('express');
const bodyParser = require('body-parser');

// ALL - Auto Renew DATA
const { execute_run_auto_renew_data_jobs } = require('./src/auto_renew/step_0_run_auto_renew_data_jobs_021326');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8014;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
// curl http://localhost:8014/auto-renew-test
// curl https://usat-auto-renew.kidderwise.org/auto-renew-test
app.get('/auto-renew-test', async (req, res) => {
    console.log('/auto-renew-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'auto-renew server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending auto-renew data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending auto-renew data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat auto-renew data job
// curl http://localhost:8014/scheduled-auto-renew
// curl https://usat-auto-renew.kidderwise.org/scheduled-auto-renew
app.get('/scheduled-auto-renew', async (req, res) => {
    console.log('/scheduled-auto-renew route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Auto Renew Data = get, load and create data succesful.',
        });

        // GETS ALL auto-renew DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA);
        await execute_run_auto_renew_data_jobs();

    } catch (error) {
        console.error('Error quering or sending auto-renew data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending auto-renew data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Clean up on exit
async function cleanup() {
    console.log('\nGracefully shutting down...');

    process.exit();
}

// Handle termination signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    console.log(`Tunnel using cloudflare https://usat-auto-renew.kidderwise.org/scheduled-auto-renew`)
    // 192.168.187:8014
});




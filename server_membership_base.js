const express = require('express');
const bodyParser = require('body-parser');

// ALL - MEMBERSHIP BASE DATA
const { execute_run_membership_data_jobs } = require('./src/membership_base/step_0_run_membership_data_jobs_012226');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8012;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/membership-test', async (req, res) => {
    console.log('/membership-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Membership base server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending membership base data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership base data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat membership base data job
app.get('/scheduled-membership-base', async (req, res) => {
    console.log('/scheduled-membership_base route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Membership Base Data = get, load and create data succesful.',
        });

        // GETS ALL Membership Base DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA);
        await execute_run_membership_data_jobs();

    } catch (error) {
        console.error('Error quering or sending membership base data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership base data.',
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

    console.log(`Tunnel using cloudflare https://usat-races.kidderwise.org/scheduled-membership`)
    // 192.168.187:8004
});




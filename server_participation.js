const express = require('express');
const bodyParser = require('body-parser');

// ALL - RACE RESULTS DATA
const { execute_run_participation_data_jobs } = require('./src/participation_data/step_0_run_participation_data_jobs_031425');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8004;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/participation-test', async (req, res) => {
    console.log('/participation-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Particiption server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending participation data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending participation data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat participation data job
app.get('/scheduled-participation', async (req, res) => {
    console.log('/scheduled-participation route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Participation Data = get, load and create data succesful.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        await execute_run_participation_data_jobs();

    } catch (error) {
        console.error('Error quering or sending participation data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending participation data.',
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

    console.log(`Tunnel using cloudflare https://usat-races.kidderwise.org/scheduled-participation`)
    // 192.168.187:8004
});




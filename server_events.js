const express = require('express');
const bodyParser = require('body-parser');

// ALL - EVENTS DATA
const { execute_run_event_data_jobs } = require('./src/events/step_0_run_event_data_jobs_042125');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8005;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/events-test', async (req, res) => {
    console.log('/events-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Events server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending events data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending events data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat events data job
app.get('/scheduled-events', async (req, res) => {
    console.log('/scheduled-events route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Events Data = get, load and create data succesful.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        await execute_run_event_data_jobs();

    } catch (error) {
        console.error('Error quering or sending events data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending events data.',
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

    console.log(`Tunnel using cloudflare https://usat-events.kidderwise.org/scheduled-events`)
    // 192.168.187:8005
});




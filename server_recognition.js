const express = require('express');
const bodyParser = require('body-parser');

// ALL - RECOGNITION DATA
const { execute_run_recognition_data_jobs } = require('./src/revenue_recognition/step_0_run_recognition_jobs_050325');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8006;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/recognition-test', async (req, res) => {
    console.log('/recognition-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Recognition server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending recognition data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending recognition data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat recognition data job
app.get('/scheduled-recognition', async (req, res) => {
    console.log('/scheduled-recognition route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All recognition Data = get, load and create data succesful.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        await execute_run_recognition_data_jobs();

    } catch (error) {
        console.error('Error quering or sending recognition data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending recognition data.',
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

    console.log(`Tunnel using cloudflare https://usat-recognition.kidderwise.org/scheduled-recognition`)
    // 192.168.187:8005
});




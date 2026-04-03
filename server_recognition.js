const express = require('express');
const bodyParser = require('body-parser');

// ALL - RECOGNITION DATA
const { execute_run_recognition_data_jobs } = require('./src/revenue_recognition/step_0_run_recognition_jobs_050325');

// RECOGNITION HISTORY JOBS
const { execute_delete_recognition_allocation_data_history } = require('./src/revenue_recognition_history/step_3_delete_recognition_allocation_data_history');
const { execute_backup_recognition_allocation_data_history } = require('./src/revenue_recognition_history/step_4_backup_recognition_allocation_data_history');

// ROUTES
const recognition_history_routes = require('./routes/recognition_history/recognition_history.routes');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8006;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = true;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// Middleware - slack slash commands are form-encoded
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ROUTES FROM recognition_history_routes:
// Insert endpoint - insert recognition history by year & month
// See notes.txt for route examples
app.use('/', recognition_history_routes);

// Test endpoint
// curl http://localhost:8006/recognition-test
// https://usat-recognition.kidderwise.org/recognition-test
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
// curl http://localhost:8006/scheduled-recognition
// https://usat-recognition.kidderwise.org/scheduled-recognition
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

// Delete endpoint - delete recognition history by snapshot version
// curl http://localhost:8006/delete-recognition-history
// https://usat-recognition.kidderwise.org/delete-recognition-history
app.get('/delete-recognition-history', async (req, res) => {
    console.log('/delete-recognition-history route req.rawHeaders = ', req.rawHeaders);

    // get snapshot from slash command
    // "/rec_history_delete snapshot=revenue_month_2026_03"

    let history_snapshot = 'revenue_month_2026_03';

    try {
        // Send a success response
        res.status(200).json({
            message: 'Delete recognition history data = delete data succesful.',
        });

        // DELETES RECOGNITION HISTORY DATA BY SNAPSHOT
        // await execute_delete_recognition_allocation_data_history(history_snapshot);

    } catch (error) {
        console.error('Error deleting recognition history data:', error);

        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending recognition data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Backup endpoint = backup recognition history by backup type
// curl http://localhost:8006/backup-recognition-history
// https://usat-recognition.kidderwise.org/backup-recognition-history
app.get('/backup-recognition-history', async (req, res) => {
    console.log('/backup-recognition-history route req.rawHeaders = ', req.rawHeaders);

    // get backup = system from cron job otherwise user
    // "/rec_history_backup"

    let backup_type = { backup_type: 'system' };

    try {
        // Send a success response
        res.status(200).json({
            message: 'Backup recognition history data = backup data succesful.',
        });

        // BACKUP RECOGNITION HISTORY DATA
        // await execute_backup_recognition_allocation_data_history(backup_type);

    } catch (error) {
        console.error('Error backing up recognition history data:', error);

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
    // 192.168.187:8006

    // NGROK TUNNEL
    if (is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});




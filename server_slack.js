const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8001;

// NGROK TUNNEL FOR TESTING
const run_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SLACK - SALES DATA
const { execute_run_slack_sales_data_jobs } = require('./src/slack_sales_data/step_0_run_slack_sales_data_jobs_01125');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
// curl http://localhost:8001/get-member-sales-test
app.get('/get-member-sales-test', async (req, res) => {
    console.log('/get-member-sales-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Slack member sales server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending slack member sales data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending slack member sales data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle slack slash "/sales" command
app.post('/get-member-sales', async (req, res) => {
    console.log('Received request for stats:', {
        body: req.body,
        headers: req.headers,
    });
    console.log('/get-sales route req.rawHeaders = ', req.rawHeaders);

    // Acknowledge the command from Slack immediately to avoid a timeout
    const processingMessage = "Retrieving member sales. Will respond in about 30 seconds.";

    // Respond back to Slack
    res.json({
        text: processingMessage,
    });

    try {
        // STEP #1 GET RAW SALES DATA / EXPORT TO CSV
        // STEP #2 LOAD SALES DATA INTO DB
        // STEP #3 QUERY SLACK DATA & SEND MESSAGE

        // only used for STEP #3 to route slack messages
        const is_cron_job = false;
        const { channel_id, channel_name, user_id } = req.body;

        await execute_run_slack_sales_data_jobs(is_cron_job, channel_id, channel_name, user_id);

    } catch (error) {
        console.error('Error quering or sending membership sales data:', error);

        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership sales data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab usat slack sales data job
// curl http://localhost:8001/scheduled-slack-sales
app.get('/scheduled-slack-sales', async (req, res) => {
    console.log('/scheduled-slack-sales route req.rawHeaders = ', req.rawHeaders);

    try {
        // STEP #1 GET RAW SALES DATA / EXPORT TO CSV
        // STEP #2 LOAD SALES DATA INTO DB
        // STEP #3 QUERY SLACK DATA & SEND MESSAGE

        // only used for STEP #3 to route slack messages
        const is_cron_job = true; 

        await execute_run_slack_sales_data_jobs(is_cron_job);

        // Send a success response
        res.status(200).json({
            message: 'Membership sales queried & sent successfully.',
        });
    } catch (error) {
        console.error('Error quering or sending membership sales data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership sales data.',
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

    console.log(`Tunnel using cloudflare https://usat-slack.kidderwise.org/get-member-sales`)
    // 192.168.1.87:8001

    // NGROK TUNNEL
    if (run_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});




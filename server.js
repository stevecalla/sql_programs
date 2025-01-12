    const express = require('express');
    const bodyParser = require('body-parser');

    // ALL - SALES DATA
    const { execute_run_sales_data_jobs } = require('./src/sales_data/step_0_run_sales_data_jobs_010425');

    // SLACK - SALES DATA
    const { execute_run_slack_sales_data_jobs } = require('./src/slack_sales_data/step_0_run_slack_sales_data_jobs_01125');

    // EXPRESS SERVER
    const app = express();
    const PORT = process.env.PORT || 8001;

    // Middleware
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());

    // Endpoint to handle crontab all usat sales data job
    app.get('/scheduled-all-sales', async (req, res) => {
        console.log('/scheduled-leads route req.rawHeaders = ', req.rawHeaders);

        try {
            // Send a success response
            res.status(200).json({
                message: 'All Sales Data = get, load and create sales key metrics started succesfully.',
            });

            // GETS ALL SALES DATA, LOADS INTO MYSQL, CREATES SALES KEY METRICS
            await execute_run_sales_data_jobs();

        } catch (error) {
            console.error('Error quering or sending membership sales data:', error);
            
            // Send an error response
            res.status(500).json({
                message: 'Error quering or sending membership sales data.',
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
    app.get('/scheduled-slack-sales', async (req, res) => {
        console.log('/scheduled-leads route req.rawHeaders = ', req.rawHeaders);

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

        console.log(`Tunnel using cloudflare https://usat.kidderwise.org/get-member-sales`)

        // switched to cloudflare; see notes.txt

    });




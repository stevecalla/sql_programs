    const express = require('express');
    const bodyParser = require('body-parser');
    const axios = require('axios');

    // USAT ALL - SALES DATA
    const { execute_run_sales_data_jobs } = require('./src/sales_data/step_0_run_sales_data_jobs_010425');

    // USAT SLACK - SALES DATA
    const { execute_run_slack_sales_data_jobs } = require('./src/slack_sales_data/step_0_run_slack_sales_data_jobs_01125');

    // const { execute_get_slack_sales_data } = require('./src/slack_sales_data/step_1_get_slack_sales_data');
    // const { execute_load_slack_sales_data } = require('./src/slack_sales_data/step_2_load_slack_sales_data');

    const { execute_create_send_slack_sales_data } = require('./src/slack_sales_data/step_3_create_send_slack_sales_data');

    // SLACK SETUP
    const { WebClient } = require('@slack/web-api');
    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // Make sure to set your token; Initialize Slack Web API client

    // EXPRESS SERVER
    const app = express();
    const PORT = process.env.PORT || 8001;

    // Middleware
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());

    // **********************************
    // ALL - DAILY SALES DATA - START
    // **********************************
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
    // **********************************
    // ALL - DAILY SALES DATA - END
    // **********************************

    // **********************************
    // SLACK - DAILY SALES DATA - START
    // **********************************
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
            await execute_run_slack_sales_data_jobs();

            // STEP #3 QUERY SLACK DATA & SEND MESSAGE
            const is_cron_job = false;
            const slackMessage = await execute_create_send_slack_sales_data(is_cron_job);

            // Send a follow-up message to Slack
            await sendFollowUpMessage(req.body.channel_id, req.body.channel_name, req.body.user_id, slackMessage);
            
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
            await execute_run_slack_sales_data_jobs();

            // STEP #3 QUERY SLACK DATA & SEND MESSAGE
            const is_cron_job = true;
            await execute_create_send_slack_sales_data(is_cron_job);

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
    // **********************************
    // SLACK - DAILY SALES DATA - END
    // **********************************

    // Function to send follow-up message to Slack
    async function sendFollowUpMessage(channelId, channelName, userId, message) {
        try {
            if(channelId && message && channelName !== "directmessage"){
                await slackClient.chat.postEphemeral({
                    channel: channelId,
                    user: userId,
                    text: message,
                });
                console.log(`Message sent to Slack ${channelName}`);
            } else if (channelId && message && channelName === "directmessage") {
                await slackClient.chat.postMessage({
                    channel: userId,
                    text: message,
                });
                console.log(`Message sent to Slack ${channelName}`);
            } else {
                console.error('Channel ID or message is missing');
            }
        } catch (error) {
            console.error('Error sending message to Slack in server.js:', error);
        }
    }

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




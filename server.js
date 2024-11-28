    const express = require('express');
    const bodyParser = require('body-parser');
    const axios = require('axios');

    // USAT SALES DATA
    const { execute_get_sales_data } = require('./src/slack_sales_data/step_1_get_sales_data');
    const { execute_load_sales_data } = require('./src/slack_sales_data/step_2_load_sales_data');
    const { execute_get_slack_sales_data } = require('./src/slack_sales_data/step_3_get_slack_sales_data');

    // SLACK SETUP
    const { WebClient } = require('@slack/web-api');
    const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN); // Make sure to set your token; Initialize Slack Web API client

    // EXPRESS SERVER
    const app = express();
    const PORT = process.env.PORT || 8001;

    // Middleware
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(bodyParser.json());

    // Endpoint to handle slackk slash "/sales" command
    app.post('/get-member-sales', async (req, res) => {
        console.log('Received request for stats:', {
            body: req.body,
            headers: req.headers,
        });
        console.log('/get-leads route req.rawHeaders = ', req.rawHeaders);

        // Acknowledge the command from Slack immediately to avoid a timeout
        const processingMessage = "Retrieving member sales. Will respond in about 30 seconds.";

        // Respond back to Slack
        res.json({
            text: processingMessage,
        });

        try {
            // STEP #1 GET RAW SALES DATA / EXPORT TO CSV
            await execute_get_sales_data();

            // STEP #2 LOAD SALES DATA INTO DB
            await execute_load_sales_data();

            // STEP #3 QUERY SLACK DATA & SEND MESSAGE
            const slackMessage = await execute_get_slack_sales_data(false);

            // Send a follow-up message to Slack
            await sendFollowUpMessage(req.body.channel_id, req.body.channel_name, req.body.user_id, slackMessage);
            
            // Send a success response
            // res.status(200).json({
            //     message: 'Membership sales queried & sent successfully.',
            // });
            
        } catch (error) {
            console.error('Error quering or sending membership sales data:', error);
            
            // Send an error response
            res.status(500).json({
                message: 'Error quering or sending membership sales data.',
                error: error.message || 'Internal Server Error',
            });
        }
    });

    // Endpoint to handle crontab usat promo data job
    app.get('/scheduled-usat-sales', async (req, res) => {
        console.log('/scheduled-leads route req.rawHeaders = ', req.rawHeaders);

        try {
            // STEP #1 GET RAW SALES DATA / EXPORT TO CSV
            await execute_get_sales_data();

            // STEP #2 LOAD SALES DATA INTO DB
            await execute_load_sales_data();

            // STEP #3 QUERY SLACK DATA & SEND MESSAGE
            const slackMessage = await execute_get_slack_sales_data(true);

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

        console.log(`Tunnel using cloudflare https://usat-sales.kidderwise.org/get-member-sales`)

        // switched to cloudflare; see notes.txt

    });




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
    // const { slack_message_api } = require('./utilities/slack_message_api');
    // const { create_daily_lead_slack_message } = require('../schedule_slack/slack_daily_lead_message');

    // NGROK TUNNEL
    const ngrok = require('ngrok');

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
            console.error('Error sending message to Slack:', error);
        }
    }

    async function start_ngrok_random_domain() {
        try { 
            const ngrokUrl = await ngrok.connect(PORT);
            console.log(`Ngrok tunnel established at: ${ngrokUrl}`);

            // Fetch tunnel details from the ngrok API
            const apiUrl = 'http://127.0.0.1:4040/api/tunnels';
            const response = await axios.get(apiUrl);
            
            // Log tunnel information
            response.data.tunnels.forEach(tunnel => {
                // console.log({tunnel});
                console.log(`Tunnel: ${tunnel.public_url}`);
                console.log(`Forwarding to: ${tunnel.config.addr}`);
                console.log(`Traffic Inspector: https://dashboard.ngrok.com/ac_2J6Qn9CeVqC2bGd0EhZnAT612RQ/observability/traffic-inspector`)
                console.log(`Status: http://127.0.0.1:4040/status`)
            });

        } catch (error) {
            console.error(`Could not create ngrok tunnel: ${error}`);
        }
    }

    async function start_ngrok_static_domain() {
        try {
            // Configure ngrok with a specific hostname
            const ngrokUrl = await ngrok.connect({
                addr: PORT,
                // hostname: 'koala-huge-goldfish.ngrok-free.app',
                url: 'koala-huge-goldfish.ngrok-free.app 8001',
                region: 'us',
            });
    
            console.log(`Ngrok tunnel established at: ${ngrokUrl}`);
    
            // Check ngrok API availability
            const apiUrl = 'http://127.0.0.1:4040/api/tunnels';
            const response = await axios.get(apiUrl);
            response.data.tunnels.forEach(tunnel => {
                console.log(`Tunnel: ${tunnel.public_url}`);
                console.log(`Forwarding to: ${tunnel.config.addr}`);
                console.log(`Traffic Inspector: https://dashboard.ngrok.com/ac_2J6Qn9CeVqC2bGd0EhZnAT612RQ/observability/traffic-inspector`)
                console.log(`Status: http://127.0.0.1:4040/status`)
            });
    
        } catch (error) {
            console.error('Error starting ngrok:', error);
            console.error('Ensure ngrok is running and the API is accessible at http://127.0.0.1:4040');
        }
    }
    
    async function start_ngrok_cli_command() {
        const { exec } = require('child_process');

        const command = 'ngrok http --url=koala-huge-goldfish.ngrok-free.app 8001';
        const process = exec(command);
        
        console.log(`Ngrok tunnel established at: POST https://koala-huge-goldfish.ngrok-free.app/get-member-sales`);
        console.log(`Traffic Inspector: https://dashboard.ngrok.com/ac_2J6Qn9CeVqC2bGd0EhZnAT612RQ/observability/traffic-inspector`)
        console.log(`Status: http://127.0.0.1:4040/status`)

        // ngrok http http://localhost:8001
        // ngrok http --url=koala-huge-goldfish.ngrok-free.app 80

        process.stdout.on('data', data => {
            console.log(`ngrok: ${data}`);
        });
    
        process.stderr.on('data', data => {
            console.error(`ngrok error: ${data}`);
        });
    
        process.on('close', code => {
            console.log(`ngrok process exited with code ${code}`);
        });
    
        process.on('error', err => {
            console.error('Failed to start ngrok:', err);
        });
    }

    // Clean up on exit
    async function cleanup() {
        console.log('\nGracefully shutting down...');
        try {
            if (ngrokUrl) {
                await ngrok.disconnect();
                await ngrok.kill();
                console.log('Ngrok tunnel closed.');
            }
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
        process.exit();
    }

    // Handle termination signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start the server
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);

        // start_ngrok_random_domain();

        // start_ngrok_static_domain(); -- didn't work but I was able to start the static domain from the cli

        start_ngrok_cli_command(); // static domain did start from the cli; this function mimics that behavior
    });




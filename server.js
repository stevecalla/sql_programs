const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// USAT SALES DATA
const { execute_get_sales_data } = require('./src/daily_slack_sales_data/step_1_get_slack_sales_data');

// SLACK SETUP
const { slack_message_api } = require('./utilities/slack_message_api');
// const { create_daily_lead_slack_message } = require('../schedule_slack/slack_daily_lead_message');

// NGROK TUNNEL
const ngrok = require('ngrok');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8001;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Endpoint to handle crontab usat promo data job
app.get('/scheduled-usat-sales', async (req, res) => {
    // TESTING VARIABLES
    let send_slack_to_calla = true;
    
    console.log('/scheduled-leads route req.rawHeaders = ', req.rawHeaders);

    try {
        const usat_sales_results = await execute_get_sales_data();;

        if (usat_sales_results) {
            // const slack_message = await create_daily_lead_slack_message(usat_sales_results);

            const slack_message = 'test';

            if (send_slack_to_calla) {
                await slack_message_api(slack_message, "steve_calla_slack_channel");
              } else {
                await slack_message_api(slack_message, "daily_slack_bot_slack_channel");
              }
        };
        
        // Send a success response
        res.status(200).json({
            message: 'Sales queried & sent successfully.',
        });
    } catch (error) {
        console.error('Error quering or sending sales data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending sales data.',
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
            console.log('Message sent to Slack');
        } else if (channelId && message && channelName === "directmessage") {
            await slackClient.chat.postMessage({
                channel: userId,
                text: message,
            });
            console.log('Message sent to Slack');
        } else {
            console.error('Channel ID or message is missing');
        }
    } catch (error) {
        console.error('Error sending message to Slack:', error);
    }
}

async function startNgrok() {
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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    startNgrok();
});





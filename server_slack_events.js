const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8008;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SLACK EVENTS STATS PROCESS
const { execute_get_slack_events_stats } = require('./src/slack_daily_stats/step_2_get_slack_events_stats');
const { create_slack_message } = require('./src/slack_daily_stats/step_2a_create_slack_events_message');

const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/slack-events-test', async (req, res) => {
    console.log('/sanction-events-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Sanction server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending sanction data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending sanction data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle requests slack slash "/events" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/slack-events-stats', async (req, res) => {
    // console.log('/slack-events-stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for sanction - /slack-events-stats :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
        response_url: req.body.response_url,
    });

    // console.log('req.query = ', req.query);
    // console.log('req.body.text = ', req.body.text);

    // if user initiated request then returns to user otherwise returns to default channel
    const {
        channel_id,
        channel_name,
        user_id,
    } = req.body;

    if (req.body && Object.keys(req.body).length === 0)
        response_url = process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL
    else 
        response_url = req.body.response_url

    // If request not received via slack, then destructure req.query parameters
    let { month } = req.query;
    
    // If request received from slack, then destructure req.body.text
    // ensure req.body is not empty and that req.body.text exists
    // inspect req.body.text to assign values to month
    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {

        // is_cron_job = false; // set cron job to false to send response is request
        const args = req?.body?.text?.trim().split(/\s+/); // Split by space

        for (const arg of args) {
            const [key, value] = arg.split('=');
            if (key && value) {
                const normalizedKey = key.toLowerCase();
                switch (normalizedKey) {
                    case 'month':
                        // If the key is "month" and month hasn't been set yet, it sets month = value.
                        // allows for req.query above
                        if (!month) month = value;
                        break;
                    case 'type':
                        if (!type) type = value;
                        break;
                    case 'category':
                        if (!category) category = value;
                        break;
                    default:
                        console.warn(`Unknown parameter: ${key}`);
                }
            }
        }
    }

    // VALID INPUT = if a user enters a bad month / type / category
        // ... step_1 will query the data but return no data available
        // ... user will be sent no data with example of slash command
        // ... when try block below executes

    // VALID IPNUT = GET DATA, CREATE SLACK MESSAGE, SEND SLACK MESSAGE
    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving slack event stats. Will respond shortly.',
        });

        // STEP 1: GET SLACK EVENTS STATS
        const { result_year_over_year, result_last_7_days, result_last_10_created_events } = await execute_get_slack_events_stats(month);

        // STEP 2: CREATE SLACK EVENTS MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, month, result_last_7_days, result_last_10_created_events);
        // console.log('text message =', slack_message);
        // console.log('blocks message =', slack_blocks);

        // STEP 3: SEND SLACK MESSAGE
        await send_slack_followup_message(channel_id, channel_name, user_id, response_url, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error querying or sending sanction data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending sanction data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab for sanction data
app.get('/scheduled-sanction-events-stats', async (req, res) => {
    // console.log('/scheduled_sanction_stats route req.rawHeaders = ', req.rawHeaders);

    try {
        const type = undefined;
        const category = undefined;
        const month = undefined;

        // STEP 1: GET SANCTION STATS
        const result = await execute_get_sanction_stats(type, category, month);

        // STEP 2: CREATE SLACK MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result, type, category, month);

        // STEP 3: SEND SLACK MESSAGE
        const is_test = false;
        const slack_channel = is_test ? "steve_calla_slack_channel" : "daily_sales_bot_slack_channel";

        await slack_message_api(slack_message, slack_channel, slack_blocks);

        // Send a success response
        res.status(200).json({
            message: 'Membership sanction queried & sent successfully.',
        });

    } catch (error) {
        console.error('Error querying or sending sanction data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending sanction data.',
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

// Start server
app.listen(PORT, async () => {
	console.log(`Server is running on http://localhost:${PORT}`);

    // CLOUDFLARE TUNNEL
    console.log(`Tunnel using cloudflare https://usat-sanction.kidderwise.org/slack-events-stats`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8007;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// EXAMPLE SLACK SLASH COMMANDS
const { get_slash_example_revenue } = require('./src/slack_daily_stats/utilities/example_slash_commands');

// REVENUE STATS PROCESS
const { execute_get_revenue_stats } = require('./src/slack_daily_stats/step_1_get_revenue_stats');
const { create_slack_message } = require('./src/slack_daily_stats/step_1a_create_revenue_message');
const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/revenue-test', async (req, res) => {
    console.log('/revenue-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Revenue server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending revenue data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending revenue data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Example Slack Slash Commands
app.post('/revenue-examples', async (req, res) => {
    // console.log('/revenue_exmaples route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for revenue - /revenue-examples :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
        response_url: req.body.response_url,
    });

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

    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving revenue stats. Will respond soon.',
        });

        const { slack_message, slack_blocks } = await get_slash_example_revenue();

        await send_slack_followup_message(channel_id, channel_name, user_id, response_url, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error quering or sending stats data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending stats data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle requests slack slash "/revenue" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/revenue-stats', async (req, res) => {
    // console.log('/revenue_stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for revenue - /revenue-stats :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
        response_url: req.body.response_url,
    });

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
    let { month, type, category } = req.query;
    
    // If request received from slack, then destructure req.body.text
    // ensure req.body is not empty and that req.body.text exists
    // inspect req.body.text to assign values to month, type, category
    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {

        // is_cron_job = false; // set cron job to false to send response is request
        const args = req?.body?.text?.trim().split(/\s+/); // Split by space

        for (const arg of args) {
            const [key, value] = arg.split('=');
            if (key && value) {
                const normalizedKey = key.toLowerCase();
                switch (normalizedKey) {
                    case 'month':
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
            text: 'Retrieving revenue stats. Will respond shortly.',
        });

        // STEP 1: GET REVENUE STATS
        const result = await execute_get_revenue_stats(type, category, month);

        // STEP 2: CREATE SLACK MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result, type, category, month);

        // STEP 3: SEND SLACK MESSAGE
        await send_slack_followup_message(channel_id, channel_name, user_id, response_url, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error querying or sending revenue data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending revenue data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab for revenue data
app.get('/scheduled-revenue-stats', async (req, res) => {
    // console.log('/scheduled_revenue_stats route req.rawHeaders = ', req.rawHeaders);

    try {
        const type = undefined;
        const category = undefined;
        const month = undefined;

        // STEP 1: GET REVENUE STATS
        const result = await execute_get_revenue_stats(type, category, month);

        // STEP 2: CREATE SLACK MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result, type, category, month);

        // STEP 3: SEND SLACK MESSAGE
        const is_test = false;
        const slack_channel = is_test ? "steve_calla_slack_channel" : "daily_sales_bot_slack_channel";

        await slack_message_api(slack_message, slack_channel, slack_blocks);

        // Send a success response
        res.status(200).json({
            message: 'Membership revenue queried & sent successfully.',
        });

    } catch (error) {
        console.error('Error querying or sending revenue data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending revenue data.',
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
    console.log(`Tunnel using cloudflare https://usat-revenue.kidderwise.org/revenue-stats`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


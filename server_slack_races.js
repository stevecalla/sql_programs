const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8009;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SLACK RACES STATS PROCESS
const { execute_get_participation_stats } = require('./src/slack_daily_stats/step_3_get_slack_participation_stats');
const { create_slack_message } = require('./src/slack_daily_stats/step_3a_create_slack_events_message');

const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/slack-races-test', async (req, res) => {
    console.log('/slack-races-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Slack races server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending slack races data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending slack races data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle requests slack slash "/races" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/slack-races-stats', async (req, res) => {
    // console.log('/slack-races-stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for slack races - /slack-races-stats :', {
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

        // STEP 1: GET SLACK RACES STATS
        const { result_year_over_year, result_sanctioned_vs_participation } = await execute_get_participation_stats();

        // STEP 2: CREATE SLACK RACES MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, result_sanctioned_vs_participation);
        // console.log('text message =', slack_message);
        // console.log('blocks message =', slack_blocks);

        // STEP 3: SEND SLACK MESSAGE
        await send_slack_followup_message(channel_id, channel_name, user_id, response_url, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error querying or sending slack races data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack races data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let isRunning = false;
let lockTimeout;

// Endpoint to handle crontab for slack races data
app.get('/scheduled-slack-races-stats', async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    // npm install uuid
    const jobId = uuidv4();
    console.log(`Started Slack job ${jobId}`);

    // console.log('/scheduled_slack_stats route req.rawHeaders = ', req.rawHeaders);
    if (isRunning) {
        const is_running_message = '/scheduled_slack_stats = Slack event job is already running. Please try again later.';

        const YELLOW = '\x1b[33m';
        const RESET = '\x1b[0m';

        console.warn(`${YELLOW}⚠️ ${is_running_message} ${RESET}`);
        console.log(`Finished Slack job ${jobId}`);

        return res.status(429).json({ message: is_running_message });
    }
    isRunning = true;

    // Sets a failsafe timeout: if the job never finishes (e.g., due to an unhandled error or infinite loop), the timeout ensures isRunning will be reset after 5 minutes. This avoids the app being stuck in a "locked" state forever.
    lockTimeout = setTimeout(() => {
        console.warn('Slack event job timed out.');
        console.log(`Finished Slack job ${jobId}`);
        isRunning = false;
    }, TIMEOUT_MS);

    try {
        // month is not extracted for scheduled job as it always runs the full year stats
        const month = undefined;

        // STEP 1: GET SLACK RACES STATS
        const { result_year_over_year, result_sanctioned_vs_participation } = await execute_get_participation_stats();

        // STEP 2: CREATE SLACK RACES MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, result_sanctioned_vs_participation);
        // console.log('text message =', slack_message);
        // console.log('blocks message =', slack_blocks);

        // STEP 3: SEND SLACK MESSAGE
        const is_test = false;
        const slack_channel = is_test ? "steve_calla_slack_channel" : "daily_sales_bot_slack_channel";

        await slack_message_api(slack_message, slack_channel, slack_blocks);

        // Send a success response
        res.status(200).json({
            message: 'Membership slack races queried & sent successfully.',
        });

    } catch (error) {
        console.error('Error querying or sending slack races data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack races data.',
            error: error.message || 'Internal Server Error',
        });
    } finally {  
        console.log(`Finished Slack job ${jobId}`);
        clearTimeout(lockTimeout); // Cancel timeout if job finished properly
        isRunning = false;         // Release the lock so next request can run
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
    console.log(`Tunnel using cloudflare https://usat-slack-races.kidderwise.org/slack-races-stats`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


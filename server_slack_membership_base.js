const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8013;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SLACK MEMBERHIP BASE DATA
const { execute_get_membership_base_stats } = require('./src/slack_daily_stats/step_5_get_membership_base_stats');
const { create_slack_message } = require('./src/slack_daily_stats/step_5a_create_membership_base_message');

const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
// Test curl http://localhost:8013/slack-membership-base-test
// curl https://koala-huge-goldfish.ngrok-free.app/bookings/slack-membership-base-test
// https://usat-slack-members.kidderwise.org/slack-membership-base-test
app.get('/slack-membership-base-test', async (req, res) => {
    const ROUTE = '/slack-membership-base-test';
    console.log(`${ROUTE} route req.rawHeaders = ${req.rawHeaders}`);

    const status_details = {
        status: 'ok',
        server: `${ROUTE} server is up and running. Stands Ready.`,
        local_time: new Date().toLocaleString('en-US', { timeZone: 'America/Denver', hour12: false }),
        timestamp: new Date().toISOString(),
    }

    console.log(`\n\n***************************************`);
    console.log(`status details:`, status_details);
    console.log(`=======================================\n`);

    
    try {
        // Send a success response
        res.status(200).json(status_details);

    } catch (error) {
        console.error(`Error querying or ${ROUTE} server. ${error}`);

        // Send an error response
        res.status(500).json({
            message: `Error querying or ${ROUTE} server.`,
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle requests slack slash "/members" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/slack-membership-base', async (req, res) => {
    // console.log('/slack-membership-base route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for slack membership base - /slack-membership-base:', {
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
    ;

    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving slack event stats. Will respond shortly.',
        });

        // STEP 1: GET SLACK RACES STATS
        const { result_by_year } = await execute_get_membership_base_stats();

        // STEP 2: CREATE SLACK RACES MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_by_year);
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
app.get('/scheduled-slack-membership-base', async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    // npm install uuid
    const jobId = uuidv4();
    console.log(`Started Slack job ${jobId}`);

    // console.log('/scheduled_slack_stats route req.rawHeaders = ', req.rawHeaders);
    if (isRunning) {
        const is_running_message = '/scheduled-slack-membership-base = Slack membership base job is already running. Please try again later.';

        const YELLOW = '\x1b[33m';
        const RESET = '\x1b[0m';

        console.warn(`${YELLOW}⚠️ ${is_running_message} ${RESET}`);
        console.log(`Finished Slack job ${jobId}`);

        return res.status(429).json({ message: is_running_message });
    }
    isRunning = true;

    // Sets a failsafe timeout: if the job never finishes (e.g., due to an unhandled error or infinite loop), the timeout ensures isRunning will be reset after 5 minutes. This avoids the app being stuck in a "locked" state forever.
    lockTimeout = setTimeout(() => {
        console.warn('Slack membership base job timed out.');
        console.log(`Finished Slack job ${jobId}`);
        isRunning = false;
    }, TIMEOUT_MS);

    try {
        // STEP 1: GET SLACK RACES STATS
        const { result_by_year } = await execute_get_membership_base_stats();

        // STEP 2: CREATE SLACK RACES MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_by_year);
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
    console.log(`Tunnel using cloudflare https://usat-slack-members.kidderwise.org/slack-membership-base`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


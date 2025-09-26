const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8008;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = true;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// SLACK EVENTS STATS PROCESS
const { execute_get_slack_events_stats } = require('./src/slack_daily_stats/step_2_get_slack_events_stats');
const { create_slack_message } = require('./src/slack_daily_stats/step_2a_create_slack_events_message');

const { send_slack_followup_message } = require('./utilities/slack_messaging/send_message_api_v2_followup');
const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');

// SLACK EVENTS RERORTING STATS
const { execute_get_event_vs_participation_detail } = require('./src/slack_daily_stats/step_4_get_slack_event_vs_participation_match_data');
const { create_slack_events_reporting_message } = require('./src/slack_daily_stats/step_4a_create_slack_event_vs_participation_message');
const { 
    upload_single_file_to_thread_scheduled, 
    upload_single_file_to_thread_user 
} = require('./utilities/slack_messaging/slack_message_api_attachment');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/slack-events-test', async (req, res) => {
    console.log('/slack-events-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Slack events server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending slack events data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending slack events data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle requests slack slash "/events" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/slack-events-stats', async (req, res) => {
    // console.log('/slack-events-stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for slack events - /slack-events-stats :', {
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
        console.error('Error querying or sending slack events data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack events data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let isRunning = false;
let lockTimeout;

// Endpoint to handle crontab for slack events data
app.get('/scheduled-slack-events-stats', async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    // npm install uuid
    const jobId = uuidv4();
    console.log(`Started Slack job ${jobId}`);

    // console.log('/scheduled-slack-events-reporting route req.rawHeaders = ', req.rawHeaders);
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

        // STEP 1: GET SLACK EVENTS STATS
        const { result_year_over_year, result_last_7_days, result_last_10_created_events } = await execute_get_slack_events_stats(month);

        // STEP 2: CREATE SLACK EVENTS MESSAGE
        const { slack_message, slack_blocks } = await create_slack_message(result_year_over_year, month, result_last_7_days, result_last_10_created_events);
        // console.log('text message =', slack_message);
        // console.log('blocks message =', slack_blocks);

        // STEP 3: SEND SLACK MESSAGE
        const is_test = false;
        const slack_channel = is_test ? "steve_calla_slack_channel" : "daily_sales_bot_slack_channel";

        await slack_message_api(slack_message, slack_channel, slack_blocks);

        // Send a success response
        res.status(200).json({
            message: 'Membership slack events queried & sent successfully.',
        });

    } catch (error) {
        console.error('Error querying or sending slack events data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack events data.',
            error: error.message || 'Internal Server Error',
        });
    } finally {  
        console.log(`Finished Slack job ${jobId}`);
        clearTimeout(lockTimeout); // Cancel timeout if job finished properly
        isRunning = false;         // Release the lock so next request can run
    }
});

// ===========================
// Slack events vs participation end points
// ===========================
// Endpoint to handle crontab for slack events vs participation reporting data
app.get('/scheduled-slack-events-reporting', async (req, res) => {
    const { v4: uuidv4 } = require('uuid');
    // npm install uuid
    const jobId = uuidv4();
    console.log(`Started Slack job ${jobId}`);

    // console.log('/scheduled-slack-events-reporting route req.rawHeaders = ', req.rawHeaders);
    if (isRunning) {
        const is_running_message = '/scheduled-slack-events-reporting = Slack event job is already running. Please try again later.';

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
        // STEP 1: GET SLACK EVENTS REPORTING STATS
        const { file_directory, file_path, rows } = await execute_get_event_vs_participation_detail(month = "all", type = 'all', is_reported = 'all');

        // STEP 2: CREATE SLACK EVENTS MESSAGE
        const { main_message_text } = await create_slack_events_reporting_message(rows, month, type, is_reported);

        // STEP 3: SEND SLACK MESSAGE
            // channelId = 'C08TMBPTKEC', // channel = test_calla
            // channelId = 'C08SJ3KE32B', // channel = test_calla_public
            // channelId = 'C082FHT4G5D', // channel = daily-sales-bot
        const is_test = true;
        let channelId = is_test ? 'C08TMBPTKEC' : 'C082FHT4G5D';

        await upload_single_file_to_thread_scheduled(file_directory, file_path, channelId, main_message_text);

        // Send a success response
        res.status(200).json({
            message: 'Membership slack events queried & sent successfully.',
        });

    } catch (error) {
        console.error('Error querying or sending slack events data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack events data.',
            error: error.message || 'Internal Server Error',
        });
    } finally {  
        console.log(`Finished Slack job ${jobId}`);
        clearTimeout(lockTimeout); // Cancel timeout if job finished properly
        isRunning = false;         // Release the lock so next request can run
    }
});

// Endpoint to handle requests slack slash "/reporting" command only
    // originating from slack slash will always have req.body unless testing curl, insomnia et al
app.post('/slack-events-reporting', async (req, res) => {
    // console.log('/slack-events-stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for slack events - /slack-events-reporting :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
        response_url: req.body.response_url,
    });

    console.log('req.query = ', req.query);
    console.log('req.body.text = ', req.body.text);

    // default inputs (can be overridden by query or text args)
    let month     = req.query?.month     ?? null;
    let type      = req.query?.type      ?? null;
    let is_reported  = req.query?.reported  ?? null;   // string: 'true' | 'false' | 'all' | null

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
    
    // If request received from slack, then destructure req.body.text
    // ensure req.body is not empty and that req.body.text exists
    // inspect req.body.text to assign values to month
    if (req.body && Object.keys(req.body).length > 0 && req.body.text) {

        // is_cron_job = false; // set cron job to false to send response is request
        const args = req?.body?.text?.trim().split(/\s+/); // Split by space
        console.log('================ args =', args);

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
                    case 'reported':
                        if (!is_reported) is_reported = value;
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
        // Keep existing values like "" (empty string), 0, false, "may", etc.
        // Replace only null or undefined with "all".
        // empty strings (or whitespace) to default to "all"
        month       = (month ?? "").trim() || "all";
        type        = (type ?? "").trim() || "all";
        is_reported = (is_reported ?? "").trim() || "all";

        // Send a success response
        res.status(200).json({
            text: `Retrieving santioned events reported. Will respond shortly.\nMonth=${month}, Type=${type}, Reported=${is_reported}`,
        });
        
        // STEP 1: GET SLACK EVENTS REPORTING STATS
        const { file_directory, file_path, rows } = await execute_get_event_vs_participation_detail(month, type, is_reported);
        
        // STEP 2: CREATE SLACK EVENTS MESSAGE
        const { main_message_text } = await create_slack_events_reporting_message(rows, month, type, is_reported);

        // STEP 3: SEND SLACK MESSAGE
        await upload_single_file_to_thread_user(file_directory, file_path, channel_id, main_message_text, channel_name, user_id, month, type, is_reported);

    } catch (error) {
        console.error('Error querying or sending slack events data.', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error querying or sending slack events data.',
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
    console.log(`Tunnel using cloudflare https://usat-slack-events.kidderwise.org/slack-events-stats`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


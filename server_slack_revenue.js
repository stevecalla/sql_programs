const express = require('express');
const bodyParser = require('body-parser');

const ngrok = require('@ngrok/ngrok');

const { execute_step_1_create_send_revenue_stats } = require('./src/slack_daily_stats/step_1_create_send_slack_revenue_stats');
const { type_map, category_map} = require('./src/slack_daily_stats/utilities/product_mapping');

const { send_slack_followup_message } = require('./utilities/slack_messaging/send_followup_message');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8007;

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
        console.error('Error quering or sending revenue data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending revenue data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Example Requests for Slack
app.post('/revenue-examples', async (req, res) => {
    // console.log('/revenue_exmaples route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for revenue - /revenue-examples :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
    });

    const {
        channel_id = process.env.SLACK_CALLA_CHANNEL_ID,
        channel_name = process.env.SLACK_CALLA_CHANNEL_NAME,
        user_id = process.env.SLACK_CALLA_USER_ID
    } = req.body;

    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving revenue stats. Will respond soon.',
        });

const slack_message = `
👀 *Slash Commands:*
1) \`/revenue\` – returns current month to date, all types
2) \`/revenue month=1 type=adult_annual category=silver\`
3) \`/revenue category=silver month=ytd\`

🤼 *Options:*
• *Months:*      Enter month number \`1\` to current month or \`ytd\`
• *Types:*         \`${Object.keys(type_map).join(", ")}\`
• *Categories:*  \`${Object.keys(category_map).join(", ")}\`
`.trim();

        // const slack_blocks = undefined; // if slack block undefined uses slack_message text
        const slack_blocks = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: slack_message,
                }
            },
            {
                "type": "divider"
            },
            {
                "type": "image",
                "image_url": "https://cataas.com/cat?type=square&position=center",
                "alt_text": "Cute kitten",
                // "image_url": "https://picsum.photos/100",
                // "alt_text": "Random image",
            },
        ];

        await send_slack_followup_message(channel_id, channel_name, user_id, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error quering or sending stats data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending stats data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat stats data job
app.post('/revenue-stats', async (req, res) => {
    // console.log('/revenue_stats route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for revenue - /revenue-stats :', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
    });

    const is_test = true;
    const {
        channel_id = is_test ? process.env.SLACK_CALLA_CHANNEL_ID : SLACK_DAILY_SALES_BOT_CHANNEL_ID,
        channel_name = is_test ? process.env.SLACK_CALLA_CHANNEL_NAME : SLACK_DAILY_SALES_BOT_CHANNEL_NAME,
        user_id = is_test ? process.env.SLACK_CALLA_USER_ID : SLACK_DAILY_SALES_BOT_USER_ID,
    } = req.body;

    // If request not received via slack, then destructure req.query parameters
    let { month, type, category } = req.query;
    
    // If request received from slack, then destructure req.body.text
    // ensure req.body is not empty and that req.body.text exists
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

    // Now you have clean variables regardless of how it was sent
    console.log({ month, type, category });

    // VALIDATION = if a user enters a bad month / type / category
    // ... the step_1 will attempt the query but return an error message
    // ... with example slash command

    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving revenue stats. Will respond shortly.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        // await execute_step_1_create_send_revenue_stats(is_cron_job, month, type, category, channel_id, channel_name, user_id);
        const { slack_message, slack_blocks } = await execute_step_1_create_send_revenue_stats(month, type, category);

        await send_slack_followup_message(channel_id, channel_name, user_id, slack_message, slack_blocks);

    } catch (error) {
        console.error('Error quering or sending revenue data:', error);
        
        // Send an error response
        res.status(500).json({  
            message: 'Error quering or sending revenue data.',
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
    // console.log(`Tunnel using cloudflare https://usat-revenue.kidderwise.org/revenue-stats`)

    // NGROK TUNNEL
	try {
        ngrok.connect({ 
            addr: PORT, 
            authtoken_from_env: true,
         }).then(listener => console.log(`Ingress established at: ${listener.url()}`));

    } catch (err) {
        console.error('Error starting ngrok:', err);
    }
});


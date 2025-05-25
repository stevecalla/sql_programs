const express = require('express');
const bodyParser = require('body-parser');

const ngrok = require('@ngrok/ngrok');

const { execute_step_1_create_send_revenue_stats } = require('./src/slack_daily_stats/step_1_create_send_slack_revenue_stats');
const { type_map, category_map} = require('./utilities/membership_products');

const { slack_message_api } = require('./utilities/slack_messaging/slack_message_api');
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
    
    const { channel_id, channel_name, user_id } = req.body;

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
                    // text:
                    // "👀 *Slash Commands:*" + "\n" +
                    // "1) `/revenue` – returns current month to date, all types" + "\n" +
                    // "2) `/revenue month=1 type=adult_annual category=silver`" + "\n" +
                    // "3) `/revenue category=silver month=ytd`" + "\n" +
                    // "\n" +
                    // "🤼 *Options:*" + "\n" +
                    // "• *Months:* Enter month number `1` to current month or `ytd`" + "\n" +
                    // `• *Types:* ${type_map.join(", ")}` + "\n" +
                    // `• *Categories:* ${Object.keys(category_map).join(", ")}`
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

        if (!channel_id || !channel_name || !user_id) {
            // Fallback to hardcoded channel if required Slack metadata is missing
            await slack_message_api(slack_message, "steve_calla_slack_channel", slack_blocks);
        } else {
            // Send a follow-up message to the user/channel from the request
            await send_slack_followup_message(channel_id, channel_name, user_id, slack_message, slack_blocks);
        }

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
    
    // If request not recived via slack, then destructure req.query parameters
    // First try to get values from query
    let { month, type, category } = req.query;
    
    // If request received from slack, then destructure req.body.text
    const { channel_id, channel_name, user_id } = req.body;
    if (req.body.text) {
        const args = req.body.text.trim().split(/\s+/); // Split by space
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

    // VALIDATION
    // let is_valid = true;
    // let slack_message = "";
    // console.log(`*********** month = `, month);
    // month = month === "ytd" ? month : Number(month);
    // console.log(`*********** month = `, month);
    // const currentMonth = new Date().getMonth() + 1; // getMonth() returns 0-11

    // if (typeof month === 'string' && month.trim() !== '') {
    //     if (!(month === 'ytd' || (monthNum >= 1 && monthNum <= currentMonth))) {
    //         const monthNum = Number(month);
    //         slack_message = `Error: Please enter a month from 1 to ${currentMonth} or "ytd".`;
    //         is_valid = false;
    //         res.status(400).json({
    //             // res.json({
    //             text: slack_message,
    //         });
    //     }
    // }
    
    // if (typeof type === 'string' && type.trim() !== '') {
    //     if (!Object.keys(type_map).includes(type)) {
    //         slack_message = `Error: Inpput = ${type}. Please enter a valid membership type. Allowed types are: ${Object.keys(type_map).join(", ")}.`;
    //         is_valid = false;
    //         res.status(400).json({
    //             // res.json({
    //             text: slack_message,
    //         });
    //     }
    // }

    // if (typeof category === 'string' && category.trim() !== '') {
    //     if (!Object.keys(category_map).includes(category)) { 
    //         slack_message = `Error: Input = "${category}". Please enter a valid category. Allowed values include: ${Object.keys(category_map).join(", ")}.`;
    //         is_valid = false;
    //         res.status(400).json({
    //             // res.json({
    //             text: slack_message,
    //         });
    //     }
    // }

    // if(!is_valid) {
    //     if (!channel_id || !channel_name || !user_id) {
    //         // Fallback to hardcoded channel if required Slack metadata is missing
    //         await slack_message_api(slack_message, "steve_calla_slack_channel", slack_blocks = undefined);
    //         return;
    //     } else {
    //         // Send a follow-up message to the user/channel from the request
    //         await send_slack_followup_message(channel_id, channel_name, user_id, slack_message, slack_blocks = undefined);
    //         return;
    //     }
    // }

    try {
        // Send a success response
        res.status(200).json({
            text: 'Retrieving revenue stats. Will respond soon.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        let is_cron_job = true;
        await execute_step_1_create_send_revenue_stats(is_cron_job, month, type, category);

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


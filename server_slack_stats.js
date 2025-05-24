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
            message: 'All revenue data = get, create slack msg, send slack msg data succesful.',
        });

const slack_message = `
👀 *Sample Requests:*
\`\`\`
1) /revenue              (returns MTD, all types)
2) /revenue month=1 type=adult_annual category=silver
3) /revenue category=silver month=ytd

Options:
- Months:     Enter month number 1 to current month or "ytd"
- Types:      ${type_map.join(", ")}
- Categories: ${Object.keys(category_map).join(", ")}
\`\`\`
`;

        // await slack_message_api(slack_message, "steve_calla_slack_channel");
        send_slack_followup_message(channel_id, channel_name, user_id, slack_message)

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

    // First try to get values from query
    let { month, type, category } = req.query;

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
    const currentMonth = new Date().getMonth() + 1; // getMonth() returns 0-11

    if (typeof month === 'string' && month.trim() !== '') {
        const monthNum = Number(month);
        if (!(month === 'ytd' || (monthNum >= 1 && monthNum <= currentMonth))) {
            return res.status(400).json({
                message: `Error: Please enter a month from 1 to ${currentMonth} or "ytd".`,
            });
        }
    }
    
    if (typeof type === 'string' && type.trim() !== '') {
        if (!type_map.includes(type)) {
            return res.status(400).json({
                message: `Error: Inpput = ${type}. Please enter a valid membership type. Allowed types are: ${type_map.join(", ")}.`,
            });
        }
    }

    if (typeof category === 'string' && category.trim() !== '') {
        if (!Object.keys(category_map).includes(category)) { 
            return res.status(400).json({
            message: `Error: Input = "${category}". Please enter a valid category. Allowed values include: ${Object.keys(category_map).join(", ")}.`
            });
        }
    }
      
    try {
        // Send a success response
        res.status(200).json({
            message: 'All revenue data = get, create slack msg, send slack msg data succesful.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        let is_cron_job = true;
        await execute_step_1_create_send_revenue_stats(is_cron_job, month, type, category, category_map[category]);

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


const express = require('express');
const bodyParser = require('body-parser');

// ALL - STATS DATA
const { execute_step_1_create_send_revenue_stats } = require('./src/slack_daily_stats/step_1_create_send_slack_revenue_stats');

const { execute_run_sales_data_jobs } = require('./src/sales_data/step_0_run_sales_data_jobs_010425');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8007;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/stats-test', async (req, res) => {
    console.log('/stats-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Stats server is up and running. Stands Ready.',
        });

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
app.get('/scheduled-stats', async (req, res) => {
    console.log('/scheduled-stats route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All stats Data = get, load and create data succesful.',
        });

        // GETS ALL PARTICIPATION DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA
        await execute_run_stats_data_jobs();

    } catch (error) {
        console.error('Error quering or sending stats data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending stats data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Example Requests for Slack
app.get('/stats-examples', async (req, res) => {
    console.log('/stats-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 
                `
                Sample Requests:
                1) 
                2) 
                3) 
                4)
                `,
        });

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
app.get('/stats-revenue', async (req, res) => {
    // console.log('/stats-revenue route req.rawHeaders = ', req.rawHeaders);

    console.log('Received request for revenue - /stats-revenue/:month?:', {
        body: req.body,
        headers: req.headers,
        query: req.query,
        param: req.params,
        text: req.body.text,
    });

    const { month, type, category } = req.query;

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
    
    const membership_types = ["adult_annual", "one_day", "elite", "youth_annual"];
    if (typeof type === 'string' && type.trim() !== '') {
        if (!membership_types.includes(type)) {
            return res.status(400).json({
                message: `Error: Inpput = ${type}. Please enter a valid membership type. Allowed types are: ${membership_types.join(", ")}.`,
            });
        }
    }

    // Mapping of simplified types to possible actual category values (for optional future use)
    const category_map = {
        // one_day / bronze
        bronze: ["Bronze - $0", "Bronze - AO", "Bronze - Distance Upgrade", "Bronze - Intermediate", "Bronze - Relay", "Bronze - Sprint", "Bronze - Ultra", "One Day - $15"],
        //annual
        silver: ["1-Year $50", "Silver"],
        gold: ["Gold"],
        two: ["2-Year"],
        three: ["3-Year"],
        lifetime: ["Lifetime"],
        elite: ["Elite"],
        youth_annual: ["Youth Annual"],
        foundation: ["Platinum - Foundation"],
        team_usa: ["Platinum - Team USA"],
        // young adult
        young_adult: ["Young Adult - $36", "Young Adult - $40", "Youth Premier - $25", "Youth Premier - $30"],
        // other
        club: ["Club"],
        other: ["Unknown"],
    };
   
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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);

    console.log(`Tunnel using cloudflare https://usat-stats.kidderwise.org/scheduled-stats`)
    // 192.168.187:8005
});




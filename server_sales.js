const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8003; // 01/20/25 port 8002 worked locally but did not respond to cloudflared; switched to 8003

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = false;
const { create_ngrok_tunnel } = require('./utilities/create_ngrok_tunnel');

// ALL - SALES DATA
const { execute_run_sales_data_jobs } = require('./src/sales_data/step_0_run_sales_data_jobs_010425');
const { execute_run_sales_data_jobs_v2 } = require('./src/sales_data_v2/step_0_run_sales_data_jobs_080925');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
app.get('/scheduled-all-sales-test', async (req, res) => {
    console.log('/scheduled_all_sales-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Member sales server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending member sales data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending member sales data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat sales data job
app.get('/scheduled-all-sales', async (req, res) => {
    console.log('/scheduled-all-sales route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Sales Data = get, load and create sales key metrics started succesfully.',
        });

        // GETS ALL SALES DATA, LOADS INTO MYSQL, CREATES SALES KEY METRICS
        await execute_run_sales_data_jobs();

    } catch (error) {
        console.error('Error quering or sending membership sales data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership sales data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat sales data job
app.get('/scheduled-all-sales-full-update', async (req, res) => {
    console.log('/scheduled-all-sales_v2 route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Sales Data = get full update, load and create sales key metrics started succesfully.',
        });
        
        // GETS ALL SALES DATA, LOADS INTO MYSQL, CREATES SALES KEY METRICS
        await execute_run_sales_data_jobs_v2('full');

    } catch (error) {
        console.error('Error quering or sending membership sales data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership sales data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat sales data job
app.get('/scheduled-all-sales-partial-update', async (req, res) => {
    console.log('/scheduled-all-sales_v2 route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Sales Data = get partial update, load and create sales key metrics started succesfully.',
        });
        
        // GETS ALL SALES DATA, LOADS INTO MYSQL, CREATES SALES KEY METRICS
        await execute_run_sales_data_jobs_v2('partial');

    } catch (error) {
        console.error('Error quering or sending membership sales data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending membership sales data.',
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

    // CLOUDFLARE TUNNEL
    console.log(`Tunnel using cloudflare https://usat-member-sales.kidderwise.org/scheduled-all-sales`)
    // 192.168.187:8003

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});




const express = require('express');
const bodyParser = require('body-parser');

// ALL - SALES DATA
const { execute_run_sales_data_jobs } = require('./src/sales_data/step_0_run_sales_data_jobs_010425');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8002;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

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

    console.log(`Tunnel using cloudflare https://usat-member-sales.kidderwise.org/scheduled-all-sales`)
    // 192.168.187:8002
});




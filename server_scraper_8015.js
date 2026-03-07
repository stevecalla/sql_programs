const express = require('express');
const bodyParser = require('body-parser');

// ALL - Auto Renew DATA
const { execute_run_auto_renew_data_jobs } = require('./src/auto_renew/step_0_run_auto_renew_data_jobs_021326');

const { execute_get_runsignup_data_jobs } = require('./src/scraper_runsignup_api/step_0_run_runsignup_data_jobs_030526');
const { execute_run_trifind_data_jobs } = require('./src/scraper_trifind_url/step_0_run_trifind_data_jobs_030626');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8015;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Test endpoint
// curl http://localhost:8015/scraper-test
// curl https://usat-scraper.kidderwise.org/scraper-test
app.get('/scraper-test', async (req, res) => {
    console.log('/scraper-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Scraper server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error quering or sending scraper data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending scraper data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat scraper data job
// curl http://localhost:8015/scheduled-scraper-runsignup
// curl https://usat-scraper.kidderwise.org/scheduled-scraper
app.get('/scheduled-scraper-runsignup', async (req, res) => {
    console.log('/scheduled-scraper-runsignup route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Runsignup Data = get, load and create data succesful.',
        });

        // GETS ALL scraper DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA);
        await execute_get_runsignup_data_jobs();

    } catch (error) {
        console.error('Error quering or sending scraper runsignup data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending scraper runsignup data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Endpoint to handle crontab all usat scraper data job
// curl http://localhost:8015/scheduled-scraper-trifind
// curl https://usat-scraper.kidderwise.org/scheduled-scraper-trifind
app.get('/scheduled-scraper-trifind', async (req, res) => {
    console.log('/scheduled-scraper-trifind route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'All Runsignup Data = get, load and create data succesful.',
        });

        // GETS ALL scraper DATA, LOADS INTO MYSQL / BQ, CREATES DETAILED DATA);
        await execute_run_trifind_data_jobs();

    } catch (error) {
        console.error('Error quering or sending scraper trifind data:', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error quering or sending scraper trifind data.',
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

    console.log(`Tunnel using cloudflare https://usat-scraper.kidderwise.org/scheduled-scraper`)
    // 192.168.187:8015
});




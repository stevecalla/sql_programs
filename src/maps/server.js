const dotenv = require('dotenv');
dotenv.config();

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

// EXPRESS SERVER
const app = express();
const PORT = process.env.PORT || 8008;

// NGROK TUNNEL FOR TESTING
const is_test_ngrok = true;
const { create_ngrok_tunnel } = require('../../utilities/create_ngrok_tunnel');

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve static files (HTML, GeoJSON, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Test endpoint
app.get('/map-test', async (req, res) => {
    console.log('/Map-test route req.rawHeaders = ', req.rawHeaders);

    try {
        // Send a success response
        res.status(200).json({
            message: 'Map server is up and running. Stands Ready.',
        });

    } catch (error) {
        console.error('Error querying or sending map data.', error);
        
        // Send an error response
        res.status(500).json({
            message: 'Error querying or sending map data.',
            error: error.message || 'Internal Server Error',
        });
    }
});

// Basic route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// http://localhost:8008/map
app.get('/map', (req, res) => {
    console.log('/customer-map route req.rawHeaders = ');

    const map_path = path.join(__dirname, '/public/index.html');

    console.log(map_path);

    res.sendFile(map_path);
});

app.get('/mapbox-token.js', (req, res) => {
  res.type('.js');
  res.send(`mapboxgl.accessToken = "${process.env.MAPBOX_TOKEN}";`);
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
    // console.log(`Tunnel using cloudflare https://usat-map.kidderwise.org`)

    // NGROK TUNNEL
    if(is_test_ngrok) {
        create_ngrok_tunnel(PORT);
    }
});


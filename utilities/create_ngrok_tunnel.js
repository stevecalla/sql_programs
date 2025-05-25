const ngrok = require('@ngrok/ngrok');

async function create_ngrok_tunnel(PORT) {
    try {
        ngrok.connect({ 
            addr: PORT, 
            authtoken_from_env: true,
            }).then(listener => console.log(`Ingress established at: ${listener.url()}`));

    } catch (err) {
        console.error('Error starting ngrok:', err);
    }
}

module.exports = {
    create_ngrok_tunnel,
}
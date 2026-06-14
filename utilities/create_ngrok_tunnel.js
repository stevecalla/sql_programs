const ngrok = require('@ngrok/ngrok');

async function create_ngrok_tunnel(PORT) {
    try {
        const listener = await ngrok.connect({
            addr: PORT,
            authtoken_from_env: true,
        });
        const url = listener.url();
        console.log(`Ingress established at: ${url}`);
        return url;
    } catch (err) {
        console.error('Error starting ngrok:', err);
        return null;
    }
}

module.exports = {
    create_ngrok_tunnel,
}
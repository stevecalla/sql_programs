// cron_get_url_context — nightly refresh of the AI Chat Bot's URL context.
// Follows the utilities/cron_* convention: hit a scheduled endpoint on the running server (localhost),
// which re-fetches + re-chunks every saved URL source. No DB access here — the server owns that.
console.log(`\nHello - RUN URL CONTEXT REFRESH JOB`);
console.log('Current Date and Time:', new Date().toLocaleString());

fetch('http://localhost:8022/api/chatbot/scheduled-refresh-urls')
    .then(response => {
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-refresh-urls:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-refresh-urls:', error.message);
    });
cd
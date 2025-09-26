console.log(`\nHello - RUN ALL SLACK EVENT JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8008/scheduled-slack-events-reporting')
// fetch('http://localhost:8008/slack-events-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-slack-events-stats:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-slack-events-stats:', error.message);
    });
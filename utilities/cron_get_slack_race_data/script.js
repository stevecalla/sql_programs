console.log(`\nHello - RUN ALL SLACK RACES JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8009/scheduled-slack-races-stats')
// fetch('http://localhost:8009/slack-races-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-slack-races-stats:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-slack-races-stats:', error.message);
    });
console.log(`\nHello - RUN RACE RESULTS TRANSFORM USAGE DIGEST JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8018/scheduled-slack-race-results-metrics?days=7')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-slack-race-results-metrics:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-slack-race-results-metrics:', error.message);
    });

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

console.log(`\nHELLO - RUN RECOGNITION HISTORY INSERT JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch(`http://localhost:8006/insert-recognition-history?password=${process.env.SLACK_COMMAND_PASSWORD}`, { method: 'POST' })
// fetch('http://localhost:8006/recognition-test')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /insert-recognition-history:', data);
    })
    .catch(error => {
        console.error('Error with request /insert-recognition-history:', error.message);
    });
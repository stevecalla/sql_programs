const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '../../.env')
});

console.log('SLACK_COMMAND_PASSWORD loaded?', !!process.env.SLACK_COMMAND_PASSWORD);
console.log('password preview:', process.env.SLACK_COMMAND_PASSWORD ? '[loaded]' : '[missing]');

console.log(`\nHELLO - RUN RECOGNITION HISTORY BACKUP JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch(`http://localhost:8006/backup-recognition-history?password=${process.env.SLACK_COMMAND_PASSWORD}&backup_type=system`, { method: 'POST' })
// fetch('http://localhost:8006/recognition-test')
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /backup-recognition-history:', data);
    })
    .catch(error => {
        console.error('Error with request /backup-recognition-history:', error.message);
    });
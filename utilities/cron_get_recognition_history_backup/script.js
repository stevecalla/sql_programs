console.log(`\nHELLO - RUN RECOGNITION HISTORY BACKUP JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8006/backup-recognition-history?backup_type=system', { method: 'POST' })
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
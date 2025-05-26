console.log(`\nHello - RUN ALL REVENUE JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8007/scheduled-revenue-stats')
// fetch('http://localhost:8007/revenue-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-revenue-stats:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-revenue-stats:', error.message);
    });
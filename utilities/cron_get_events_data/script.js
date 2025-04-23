console.log(`\nHello - RUN ALL EVENTS JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8005/scheduled-events')
// fetch('http://localhost:8005/events-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-events:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-events:', error.message);
    });
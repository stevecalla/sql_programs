console.log(`\nHello - RUN ALL MEMBERSHIP SALES JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8003/scheduled-all-sales')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-all-usat-sales:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-all-usat-sales:', error.message);
    });
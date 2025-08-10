console.log(`\nHello - RUN ALL MEMBERSHIP SALES JOB - PARTIAL UPDATE`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8003/scheduled-all-sales-partial-update')
// fetch('http://localhost:8003/scheduled-all-sales-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-all-usat-sales_partial_update:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-all-usat-sales_partial_update:', error.message);
    });
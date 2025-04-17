console.log(`\nHello - RUN ALL MEMBERSHIP SALES JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8004/scheduled-participation')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-participation:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-participation:', error.message);
    });
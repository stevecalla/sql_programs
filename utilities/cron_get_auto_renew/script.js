console.log(`\nHello - RUN ALL AUTO RENEW JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

// fetch('http://localhost:8014/auto-renew-test')
fetch('http://localhost:8014/scheduled-auto-renew')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-membership-base:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-membership-base:', error.message);
    });
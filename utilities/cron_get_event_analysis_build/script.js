console.log(`\nHello - RUN EVENT ANALYSIS BUILD JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

// fetch('http://localhost:8016/api/status')
fetch('http://localhost:8016/api/build')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /api/build:', data);
    })
    .catch(error => {
        console.error('Error with request /api/build:', error.message);
    });

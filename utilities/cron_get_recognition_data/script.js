console.log(`\nHello - RUN ALL recognition JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8006/scheduled-recognition')
// fetch('http://localhost:8006/recognition-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-recognition:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-recognition:', error.message);
    });
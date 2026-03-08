console.log(`\nHello - RUN SCRAPER RUNSIGNUP JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8015/scraper-test')
// fetch('http://localhost:8015/scheduled-scraper-runsignup')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-scraper-runsignup:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-scraper-runsignup:', error.message);
    });
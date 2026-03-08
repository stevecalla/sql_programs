console.log(`\nHello - RUN SCRAPER TRIFIND JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8015/scraper-test')
// fetch('http://localhost:8015/scheduled-scraper-trifind')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-scraper-trifind:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-scraper-trifind:', error.message);
    });
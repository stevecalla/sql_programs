console.log(`\nHello - RUN ALL SLACK NEWS JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8010/scheduled-slack-news-stats')
// fetch('http://localhost:8010/slack-news-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-slack-news-stats:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-slack-news-stats:', error.message);
    });
console.log(`\nHello - RUN ALL SLACK EVENT JOB`);
console.log("Current Date and Time:", new Date().toLocaleString());

fetch('http://localhost:8013/scheduled-slack-membership-base')
// fetch('http://localhost:8013/slack-membership-base-test')
    .then(response => {

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
    })
    .then(data => {
        console.log('Response from /scheduled-slack-membership-base:', data);
    })
    .catch(error => {
        console.error('Error with request /scheduled-slack-membership-base:', error.message);
    });
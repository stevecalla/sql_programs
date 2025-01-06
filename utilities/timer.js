const readline = require('readline');

// ANSI escape codes for colors
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const updateInterval = 1000; // Update interval in milliseconds (1000ms = 1 second)
let seconds = 0;
let timerInterval = {}; // Object to hold timer intervals


// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to format time as HH:MM:SS
function formatTime(totalSeconds, milliseconds) {

    if (milliseconds)
        totalSeconds = Math.floor(endTime / 1000); // Convert to seconds

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let position = 10;
async function startTimerMessage() {
    // console.clear();
    // readline.cursorTo(process.stdout, 0, position); //positions next console.log 1 line below SSH msg
    process.stdout.write(`${BLUE}\nStarting timer... Press Ctrl+C to stop...`);
    // readline.clearLine(process.stdout, position); // Clear the current line
}

// Function to update timer
async function updateTimer(i) {
    await startTimerMessage();

    // readline.cursorTo(process.stdout, 0, position + 2 + i); // Move cursor to top-left corner, but 2 lines below starting line
    // readline.clearLine(process.stdout, position_2); // Clear the current line
    
    process.stdout.write(`${RED}Timer: ${YELLOW}${formatTime(seconds)}${RESET}...`); // Display the timer in red and yellow
    seconds++; // Increment seconds
}

// Function to stop the timer
function stopTimer(i) {
    if (timerInterval[`timerInterval_${i}`]) { // Check if the timerInterval is set
        console.log('Clearing timer interval...'); // Log to confirm clearInterval is about to be called
        clearInterval(timerInterval[`timerInterval_${i}`]); // Stop the timer interval
        seconds = 0; // resest timer to 0
        console.log('Timer interval cleared.'); // Log to confirm clearInterval has been called
    } else {
        console.log('No timer interval found to clear.'); // Log if timerInterval is not set
    }
    position += 15;

    rl.close(); // Close readline interface
    // process.exit(); // Exit the process
}

// Function to start the timer
function runTimer(i) {
    timerInterval[`timerInterval_${i}`] = setInterval(() => updateTimer(i), updateInterval); // Set up the timer interval
}

// Export functions
module.exports = { runTimer, stopTimer, formatTime };
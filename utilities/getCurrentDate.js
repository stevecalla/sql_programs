const dayjs = require('dayjs');

// input = 2025-06-11T15:14:16.000Z, returns 'Jun 11, 2025, 9:14 AM'
// input is in UTC, and format_date() converts it to local time, unless a timeZone is specified in the options
function format_date(date) {
  return date.toLocaleString('en-US', {
    year: '2-digit', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

// input = 2025-06-11T15:14:16.000Z, returns 'Jun 11, 2025'
// input is in UTC, and format_date() converts it to local time, unless a timeZone is specified in the options
function format_date_only(date) {
  return date.toLocaleString('en-US', {
    weekday: 'short',        // Adds day of week (e.g., "Mon")
    year: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

//returns "2024-03-10_10-25-25"
function getCurrentDateTimeForFileNaming() {
    const createdAt = dayjs(); // Current date and time
    const createdAtFormatted = createdAt.format('YYYY-MM-DD_HH-mm-ss');
    // console.log('Current date and time = ', createdAtFormatted);
    return createdAtFormatted;
}

//returns "2024-03-10 10:25:25"
function getCurrentDateTime() {
    const createdAt = dayjs(); // Current date and time
    const createdAtFormatted = createdAt.format('YYYY-MM-DD HH:mm:ss');
    // console.log('Current date and time = ', createdAtFormatted);
    return createdAtFormatted;
}

//returns "10:25:25"
function getCurrentTime() {
    const createdAt = dayjs(); // Current date and time
    const createdAtFormatted = createdAt.format('HH:mm:ss');
    // console.log('Current date and time = ', createdAtFormatted);
    return createdAtFormatted;
}

//returns "2024-03-10"
function getCurrentDateForFileNaming() {
    const createdAt = dayjs(); // Current date and time
    const createdAtFormatted = createdAt.format('YYYY-MM-DD');
    // console.log('Current date = ', createdAtFormatted);
    return createdAtFormatted;
}

//takes 2024-07-01T06:00:00.000Z; returns "2024-03-10"
function getFormattedDate(date) {
    date = dayjs(date);
    const createdAtFormatted = date.format('YYYY-MM-DD');
    // console.log('Current date = ', createdAtFormatted);
    return createdAtFormatted;
}

//takes '2024-10-19 16:05:27'; returns '2024-10-19 04:05:27 PM' use "a" below for lower case and "A" for upper case
function getFormattedDateAmPm(date) {
    date = dayjs(date);

    const createdAtFormatted = date.format('YYYY-MM-DD hh:mm:ss A');

    return createdAtFormatted;
}

// Function to convert Unix timestamp 1712179121648 to 2024-04-03 15:18:41
function convertTimestampToDateTime(timestamp) {
    // Ensure the timestamp is parsed as a number (if it's a string)
    const timestampNumber = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;

    // Create a Day.js object from the Unix timestamp (in milliseconds)
    const dateObj = dayjs(timestampNumber);

    // Format the date object to yy mm dd hh mm ss format
    const formattedDateTime = dateObj.format('YYYY-MM-DD HH:mm:ss');

    // console.log(timestamp);
    // console.log(formattedDateTime);

    return formattedDateTime;
}

function getDayOfWeek(date) {
    const formattedDate = dayjs(date).format('ddd'); // 'ddd' for abbreviated day of the week
    return formattedDate;
  }
// getCurrentDateForFileNaming();
// getCurrentDateTimeForFileNaming();
// convertTimestampToDateTime('1712179121648');

module.exports = {
    format_date,
    format_date_only,
    getCurrentDateTimeForFileNaming,
    getCurrentDateForFileNaming,
    getCurrentDateTime,
    getCurrentTime,
    convertTimestampToDateTime,
    getFormattedDate,
    getFormattedDateAmPm,
    getDayOfWeek,
}
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

async function get_yesterdays_date() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1); // Move back one day

  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const day = String(yesterday.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function get_todays_date() {
  const today = new Date(); // Get the current date

  const year = today.getFullYear(); // Get the current year
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Get the current month (0-indexed, so we add 1)
  const day = String(today.getDate()).padStart(2, '0'); // Get the current day

  // Return the formatted date in 'YYYY-MM-DD' format
  return `${year}-${month}-${day}`;
}

async function get_last_day_of_year() {
  const current_date_mtn = new Date(); // Get the current date
  let end_date_mtn = new Date(current_date_mtn.getFullYear(), 11, 31); // Set the date to December 31st (Month is 0-indexed)

  // Format the date in YYYY-MM-DD format
  return `${end_date_mtn.getFullYear()}-${String(end_date_mtn.getMonth() + 1).padStart(2, '0')}-${String(end_date_mtn.getDate()).padStart(2, '0')}`;
}

async function get_first_day_of_prior_year() {
  const current_date_mtn = new Date(); // Get the current date
  let start_date_mtn = new Date(current_date_mtn.getFullYear() - 1, 0, 1); // Set to Jan 1 of prior year

  // Format the date in YYYY-MM-DD format
  return `${start_date_mtn.getFullYear()}-${String(start_date_mtn.getMonth() + 1).padStart(2, '0')}-${String(start_date_mtn.getDate()).padStart(2, '0')}`;
}

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
  get_yesterdays_date,
  get_todays_date,
  get_last_day_of_year,
  get_first_day_of_prior_year,
}
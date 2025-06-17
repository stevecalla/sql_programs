const { getFormattedDateAmPm } = require('../../../utilities/getCurrentDate');

// RETURNS UPDATED DATE STRING BASED ON DATE INPUT
async function get_date_message(date) {

  const format_date = `${getFormattedDateAmPm(date)} MTN`;
  const date_message = `*Most Recent News:* ${format_date}`;

  return { date_message };
}

// RETURNS MONTH NAME BASED ON INPUT OF MONTH NUMBER
async function get_month_name(month_num) {
  const month_names = [
    "Year-to-Date", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const month_name = month_num === "ytd" ? month_names[0] : month_names[month_num];

//   console.log(`********** month_num = `, month_num, month_name);

  return month_name;
}

module.exports = {
    get_date_message,
    get_month_name,
}

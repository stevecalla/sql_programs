// RETURNS MOST RECENT FULL MONTH WHICH SHOULD ALWAYS BE THE PRIOR MONTH
async function get_prior_month_name() {

  // Get most recent full month dynamically (e.g., "April")
  const now = new Date();
  const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prior_month_name = priorMonthDate.toLocaleString('en-US', { month: 'long' });

  return prior_month_name;
}

async function get_ytd_message(month) {
  const prior_month_name = await get_prior_month_name();

  // Add YTD explanation if month is "ytd"
  const ytd_message = (typeof month === 'string' && month.toLowerCase() === 'ytd') ? `* YTD: Represents January to the most recent full month which is currently Jan to ${prior_month_name}.*\n` : '';

  return ytd_message;
}

module.exports = {
    get_prior_month_name,
    get_ytd_message,
}

const { type_map, category_map} = require('./utilities/product_mapping');

const { fmtCurrency,fmtNumber, fmtRPU, fmtPct} = require('./utilities/number_formats');
// const { pad_markdown_table} = require('./utilities/markdown_table_padding');
const { looker_link } = require('./utilities/looker_link');
const { get_date_message, get_month_name } = require('./utilities/date_info');
const { get_ytd_message } = require('./utilities/get_ytd_message');
const { get_slack_block_template } = require('./utilities/slack_block_template');

async function generate_error_message() {

const error_message = `⚠️ No data available for the selected month.

🤼 *Options:*
• *Months:*      Enter month number \`1\` to  \`12\``;
  return error_message;
}

function pad(str, length) {
  return String(str ?? "").padEnd(length);
}

async function format_markdown_table_year_over_year(data) {
  const columns = [
    { key: "event_type", header: "event_type", width: 15, isNumber: false },
    { key: "sanction_count_last_year", header: "last_year", width: 10, isNumber: true },
    { key: "sanction_count_this_year", header: "this_year", width: 10, isNumber: true },
    { key: "sanction_count_next_year", header: "next_year", width: 10, isNumber: true },
    { key: "difference_last_vs_this_year", header: "diff_vs_ly", width: 10, isNumber: true }
  ];

  function formatValue(value, isNumber) {
    if (value === null || value === undefined) return "";
    if (isNumber && !isNaN(value)) {
      return Number(value).toLocaleString(); // Adds commas
    }
    return String(value);
  }

  // Build header
  const headerRow = "| " + columns.map(col => pad(col.header, col.width)).join(" | ") + " |";
  const dividerRow = "| " + columns.map(col => "-".repeat(col.width)).join(" | ") + " |";

  // Build data rows
  const dataRows = data.map(row => {
    return "| " + columns.map(col => pad(formatValue(row[col.key], col.isNumber), col.width)).join(" | ") + " |";
  });

  return [headerRow, dividerRow, ...dataRows].join("\n");
}

async function create_slack_message(result_year_over_year, month) {

  console.log('month = ', month);

  let slack_message = "Error - No results";
  let is_error = false;
  let year_over_year_table = "";

  let { date_message } = await get_date_message(result_year_over_year[0]?.created_at_mtn);

  // TABLE OUTPUT
  // Ensure `month` is a number (or null/undefined if not set)
  let month_name = "";

  // VALIDATE MONTH
  if (month === "") {
    month_name = "Full Year";
  } else if (isNaN(month) || month < 1 || month > 12) {
    month_name = month;
  } else {
    // Valid month number (1–12)
    month = Number(month);
    month_name = await get_month_name(month);
  }

  // VALIDATE RESULTS
  if (!result_year_over_year || result_year_over_year.length === 0) {
    console.error("No matching row found with given filters.");
    is_error = true;
  } else {
    year_over_year_table = await format_markdown_table_year_over_year(result_year_over_year);
  }

// MESSAGE
// 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️
slack_message =    
  `📢 *EVENTS - SANCTIONING SNAPSHOT*\n` +
  `🕕 ${date_message}\n` +
  `📈 ${await looker_link(`https://lookerstudio.google.com/u/0/reporting/f457edb4-c842-4632-8844-4273ecf05da5/page/p_h2wxc2blsd`)}\n` + '\n' +
  `ℹ️ *Month:* \`${month_name}\`\n` +  
  (is_error ? await generate_error_message() : `\`\`\`${year_over_year_table}\n\`\`\``)
;

  const slack_blocks = await get_slack_block_template(slack_message);

  return { slack_message, slack_blocks };
}

module.exports = {
  create_slack_message,
}
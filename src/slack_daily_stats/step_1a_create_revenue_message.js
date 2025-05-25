const { type_map, category_map} = require('./utilities/product_mapping');

const { fmtCurrency,fmtNumber, fmtRPU, fmtPct} = require('./utilities/number_formats');
const { pad_markdown_table} = require('./utilities/markdown_table_padding');
const { looker_link } = require('./utilities/looker_link');
const { get_date_message, get_month_name } = require('./utilities/date_info');

async function generate_error_message() {

const message = `

⚠️ No data available for the selected month/type/category.

🤼 *Options:*
• *Months:*      Enter month number \`1\` to current month or \`ytd\`
• *Types:*         \`${Object.keys(type_map).join(", ")}\`
• *Categories:*  \`${Object.keys(category_map).join(", ")}\`
`;

  return message;
}

async function format_markdown_table(row, month_name) {
  const markdown_message = [
    [month_name, "REV", "UNITS", "RPU"],
    ["------------------------------", "---------", "---------", "---------"],
    ["Goal", fmtCurrency(row.sales_rev_2025_goal), fmtNumber(row.sales_units_2025_goal), fmtRPU(row.sales_rpu_2025_goal)],
    ["Goal - Pct", fmtPct(row.pct_diff_rev_goal_vs_2024_goal), fmtPct(row.pct_diff_units_goal_vs_2024_goal), fmtPct(row.pct_diff_rpu_goal_vs_2024_goal)],
    ["Goal - Abs", fmtCurrency(row.abs_diff_rev_goal_vs_2024_goal), fmtNumber(row.abs_diff_units_goal_vs_2024_goal), fmtRPU(row.abs_diff_rpu_goal_vs_2024_goal)],
    [""],    
    [month_name + " '25", fmtCurrency(row.sales_rev_2025_actual), fmtNumber(row.sales_units_2025_actual), fmtRPU(row.sales_rpu_2025_actual)],
    [month_name + " '24", fmtCurrency(row.sales_rev_2024_actual), fmtNumber(row.sales_units_2024_actual), fmtRPU(row.sales_rpu_2024_actual)],
    ["YoY - Pct Diff", fmtPct(row.pct_diff_rev_2025_vs_2024_actual), fmtPct(row.pct_diff_units_2025_vs_2024_actual), fmtPct(row.pct_diff_rpu_2025_vs_2024_actual)],
    ["YoY - Abs Diff", fmtCurrency(row.abs_diff_rev_2025_vs_2024_actual), fmtNumber(row.abs_diff_units_2025_vs_2024_actual), fmtRPU(row.abs_diff_rpu_2025_vs_2024_actual)],
    [""],
    ["Actual vs Goal - Pct", fmtPct(row.pct_diff_rev_goal_vs_2025_actual), fmtPct(row.pct_diff_units_goal_vs_2025_actual), fmtPct(row.pct_diff_rpu_goal_vs_2025_actual)],
    ["Actual vs Goal - Abs", fmtCurrency(row.abs_diff_rev_goal_vs_2025_actual), fmtNumber(row.abs_diff_units_goal_vs_2025_actual), fmtRPU(row.abs_diff_rpu_goal_vs_2025_actual)],
  ];

  return markdown_message;
}

async function generate_markdown_table(options) {

  let { result, is_ytd_row, month, month_name } = options;

  // Choose the correct row based on flags
  let row;
  let is_error = false;

  if (!result || result.length === 0) {
      console.error("No matching row found with given filters.");
      is_error = true;
  } else if (is_ytd_row === 1) {
      row = result.find(r => r.is_ytd_row === 1);
  } else if (month) {
      // console.log('month condition = ', month);
      row = result.find(r => r.month_actual === month);
  } else {
      row = result.find(r => r.is_current_month === 1);
  }

  if (!row) {
      console.error("No matching row found with given filters.");
      is_error = true;
  }
  
  const raw_markdown_message = !is_error && await format_markdown_table(row, month_name);
  const final_formatted_message = !is_error && await pad_markdown_table(raw_markdown_message);
  const error_message = await generate_error_message();

  return { final_formatted_message, error_message, is_error };
}

async function create_slack_message(result, type_input = "All", category_input = "All", month) {

  let slack_message = "Error - No results";
  let slack_blocks = "";

  let { date_message } = await get_date_message(result[0].created_at_mtn);

  // TABLE OUTPUT
  // Ensure `month` is a number (or null/undefined if not set)
  let month_name = "";
  let is_ytd_row = "";

  if (month === 'ytd') {
    month = "";
    is_ytd_row = 1;
    month_name = await get_month_name(0);
  } else {
    month = month !== undefined && month !== null ? Number(month) : new Date().getMonth() + 1;
    month_name = await get_month_name(month);
  };

  const options = { result, is_ytd_row, month, month_name, type_input, category_input};
  const { final_formatted_message, error_message, is_error } = await generate_markdown_table(options);

// MESSAGE
// 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️
slack_message =    
  `📢 *MEMBERSHIP - REVENUE SNAPSHOT*\n` +
  `🕕 ${date_message}\n` +
  `📈 ${await looker_link(`https://lookerstudio.google.com/u/0/reporting/f457edb4-c842-4632-8844-4273ecf05da5/page/p_bc9xthh1rd`)}\n` +
  `ℹ️ *Month:* ${month_name}, *Type:* ${type_input}, *Category:* ${category_input}\n` +
  (is_error ? error_message : `\`\`\`${final_formatted_message}\n\`\`\``);

  // console.log('slack_sales_message.js = ', slack_message);

  return { slack_message, slack_blocks };
}

// TEST WITH SEED DATA
// async function testing() {

  // const { revenue_seed_data: result } = require('./utilities/seed_data');

//   let type_input = adult;
//   let category_input = "silver";

//   let options = { result, type_input, category_input, month};      // result = is current month
//   options = { result, type_input, category_input, month: ""};      // result = default to current month
//   options = { result, type_input, category_input, month: 5};       // result = may
//   options = { result, type_input, category_input, month: 2};       // result = Feb
//   options = { result, type_input, category_input, month: "ytd"};       // result = ytd

//   let slack_message = await create_slack_message(revenue_seed_data);
//   console.log(slack_message);
  
//   const { slack_message_api } = require('./slack_message_api');
//   await slack_message_api(slack_message, "steve_calla_slack_channel");
// }

// testing();

module.exports = {
  create_slack_message,
}
const { type_map, category_map} = require('./utilities/product_mapping');

const { fmtNumber } = require('./utilities/number_formats');
const { looker_link } = require('./utilities/looker_link');
const { get_date_message, get_month_name } = require('./utilities/date_info');
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

function padString(str, length) {
  str = String(str);
  if (str.length >= length) return str;
  return str + ' '.repeat(length - str.length);
}

async function format_markdown_table_year_over_year(data) {
  if (!data || data.length === 0) return 'No data provided.';

  const headers = [
    // 'Label',
    // 'Created At',
    'Month',
    // 'Last Year',
    // 'This Year',
    'LY Count',
    'TY Count',
    'diff abs',
    'LY Racers',
    'TY Racers',
    'diff abs'
  ];

  // Extract rows as arrays
  const rows = data.map(row => [
    // row.label,
    // row.created_at_mtn,
    row.start_date_month_races,
    // row.last_year,
    // row.this_year,
    fmtNumber(row.participant_event_count_last_year),
    fmtNumber(row.participant_event_count_this_year),
    fmtNumber(row.participant_event_difference_last_vs_this_year),
    fmtNumber(row.participants_count_last_year),
    fmtNumber(row.participants_count_this_year),
    fmtNumber(row._participants_difference_last_vs_this_year)
  ]);

  // Combine headers and data for width calculation
  const allRows = [headers, ...rows];

  // Determine max width for each column
  const colWidths = headers.map((_, colIndex) => {
    return Math.max(...allRows.map(row => String(row[colIndex]).length));
  });

  // Format a row with padding
  const formatRow = row => {
    return '| ' + row.map((cell, i) => padString(cell, colWidths[i])).join(' | ') + ' |';
  };

  // Build the table
  let markdown = formatRow(headers) + '\n';
  markdown += '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |\n';
  rows.forEach(row => {
    markdown += formatRow(row) + '\n';
  });

  return markdown;
}

async function format_markdown_participation_v_sanction(data) {
  const headers = [
    // 'Label',
    // 'Max Created At',
    'Month',
    // 'Sanction Count LY',
    // 'Participant Count LY',
    // 'Δ LY',
    'Sanction Count TY',
    'Participant Count TY',
    'Δ TY'
  ];

  const keys = [
    // 'label',
    // 'max_created_at',
    'month_label',
    // 'sanction_count_last_year',
    // 'participant_event_count_last_year',
    // 'diff_last_year',
    'sanction_count_this_year',
    'participant_event_count_this_year',
    'diff_this_year'
  ];

  const formatNumber = (value) =>
    isNaN(value) || value === null || value === undefined
      ? String(value)
      : Number(value).toLocaleString();

  const pad = (str, width) => {
    str = String(str);
    return str + ' '.repeat(Math.max(width - str.length, 0));
  };

  const colWidths = keys.map((key, i) => {
    const maxDataLength = Math.max(
      ...data.map(row => formatNumber(row[key]).length),
      headers[i].length
    );
    return maxDataLength;
  });

  const headerRow = '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |';
  const separatorRow = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

  const dataRows = data.map(row =>
    '| ' + keys.map((key, i) => pad(formatNumber(row[key]), colWidths[i])).join(' | ') + ' |'
  );

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

async function create_slack_message(result_year_over_year, result_sanctioned_vs_participation, month) {

  console.log('step 3a create slack events message');

  let slack_message = "Error - No results";
  let is_error = false;
  let year_over_year_table = "";
  let participation_v_sanction_table = "";

  let { date_message } = await get_date_message(result_year_over_year[0]?.created_at_mtn);

  // TABLE OUTPUT
  // Ensure `month` is a number (or null/undefined if not set)
  let month_name = "";

  // VALIDATE MONTH
  if (!month || month === "") {
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
    participation_v_sanction_table = await format_markdown_participation_v_sanction(result_sanctioned_vs_participation);
  }

  let looker_url = `https://lookerstudio.google.com/u/0/reporting/f457edb4-c842-4632-8844-4273ecf05da5/page/p_son6g0w4qd`;
  let looker_report = `Participation`;

// MESSAGE
// 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️
slack_message =    
  `📢 *PARTICIPATION SNAPSHOT*\n` 
  +
  `🕕 ${date_message}\n` 
  +
  `👀 ${await looker_link(looker_url, looker_report)}\n` + '\n' 
  +
  `ℹ️ *Month:* \`${month_name}\`; *Includes:* \`All Data Reported To Date\`\n` 
  +  
  (is_error ? await generate_error_message() : `\`\`\`${year_over_year_table}\n\`\`\``) 
  +  
  `\n🏃‍♀️ Participation vs Sanction Events: \`Adult & Youth Events Only\`\n` 
  +  
  (!is_error && `\`\`\`${participation_v_sanction_table}\n\`\`\``) 
;

  const slack_blocks = await get_slack_block_template(slack_message);

  return { slack_message, slack_blocks };
}

module.exports = {
  create_slack_message,
}
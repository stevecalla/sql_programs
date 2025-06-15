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

async function format_markdown_table_last_7_days(data) {
  const colWidths = {
    date: 12,
    weekday: 8,
    eventType: 12,
    total: 5
  };

  // Get event types (excluding blank ones), sorted alphabetically
  const eventTypes = [...new Set(data.map(d => d.event_type))]
    .filter(type => type && type.trim() !== "")
    .sort();

  // Get all unique dates with weekday info
  const dateMeta = {};
  for (const row of data) {
    dateMeta[row.created_at_mtn] = row.created_weekday_abbr;
  }

  const sortedDates = Object.keys(dateMeta).sort((a, b) => new Date(b) - new Date(a));

  // Build matrix: date -> event_type -> count
  const matrix = {};
  for (const row of data) {
    const date = row.created_at_mtn;
    const type = row.event_type;
    if (!matrix[date]) matrix[date] = {};
    if (!type || type.trim() === "") continue; // Skip blank headers
    matrix[date][type] = row.count_distinct_id_sanctioning_events;
  }

  // Header and divider
  const header = "| " +
    pad("Date", colWidths.date) + " | " +
    pad("Weekday", colWidths.weekday) + " | " +
    eventTypes.map(t => pad(t, colWidths.eventType)).join(" | ") + " | " +
    pad("Total", colWidths.total) + " |";

  const divider = "|-" +
    "-".repeat(colWidths.date) + "-|-" +
    "-".repeat(colWidths.weekday) + "-|-" +
    eventTypes.map(() => "-".repeat(colWidths.eventType)).join("-|-") +
    "-|-" + "-".repeat(colWidths.total) + "-|";

  // Data rows
  const rows = sortedDates.map(date => {
    const weekday = dateMeta[date] ?? "";
    const counts = eventTypes.map(type => {
      const val = matrix[date]?.[type] ?? 0;
      return pad(val === 0 ? "" : fmtNumber(val), colWidths.eventType);
    });
    const total = eventTypes.reduce((sum, type) => sum + (matrix[date]?.[type] || 0), 0);
    return "| " +
      pad(date, colWidths.date) + " | " +
      pad(weekday, colWidths.weekday) + " | " +
      counts.join(" | ") + " | " +
      pad(total === 0 ? "" : fmtNumber(total), colWidths.total) + " |";
  });

  return [header, divider, ...rows].join("\n");
}

async function format_markdown_table_last_10_created_events(data) {
    const headerMap = {
        id_sanctioning_events: 'Sanction Id',
        name_events: 'Name *',
        // name_event_type: 'Type',
        // name_race_type: 'Race',
        // name_distance_types: 'Distance',
        starts_events: 'Start Date',
        state_code_events: 'State',
        race_count: 'Race Count',
    };

    // Get fields in order from headerMap keys
    const fields = Object.keys(headerMap);

    // Build headers array from headerMap values
    const headers = fields.map(f => headerMap[f]);

    // Slice first 10 rows
    const rows = data.slice(0, 10);

    // Prepare data rows as arrays of strings, matching fields order
    const tableData = rows.map((row, i) =>
        fields.map(f => (row[f] !== undefined && row[f] !== null ? String(row[f]) : ''))
    );

    // Add row numbering as first column, so add header and data column for that
    const numberedHeaders = ['#'].concat(headers);
    const numberedRows = tableData.map((row, i) => [String(i + 1)].concat(row));

    // Combine header and data
    const allRows = [numberedHeaders, ...numberedRows];

    // Calculate max widths per column
    const colWidths = numberedHeaders.map((_, colIndex) =>
        Math.max(...allRows.map(row => row[colIndex].length))
    );

    // Helper to pad strings left-aligned
    function pad(str, width) {
        return str + ' '.repeat(width - str.length);
    }

    // Build lines with padded columns separated by ' | '
    const lines = allRows.map(row => row.map((cell, i) => pad(cell, colWidths[i])).join(' | '));

    // Insert separator line after header
    lines.splice(1, 0, colWidths.map(w => '-'.repeat(w)).join('-|-'));

    return lines.join('\n');
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
      return fmtNumber(Number(value)); // Adds commas
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

async function create_slack_message(result_year_over_year, month, result_last_7_days, result_last_10_created_events) {

  console.log('step 2a create slack events message: month = ', month);

  let slack_message = "Error - No results";
  let is_error = false;
  let year_over_year_table = "";
  let last_7_days_table = "";
  let last_10_created_events = "";

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
    last_7_days_table = await format_markdown_table_last_7_days(result_last_7_days);
    last_10_created_events = await format_markdown_table_last_10_created_events(result_last_10_created_events);
  }

  let looker_url = `https://lookerstudio.google.com/u/0/reporting/f457edb4-c842-4632-8844-4273ecf05da5/page/p_h2wxc2blsd`;
  let looker_report = `Events`;

// MESSAGE
// 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️
slack_message =    
  `📢 *EVENTS - SANCTIONING SNAPSHOT*\n` 
  +
  `🕕 ${date_message}\n` 
  +
  `👀 ${await looker_link(looker_url, looker_report)}\n` + '\n' 
  +
  `ℹ️ *Month:* \`${month_name}\`; *Excludes:* \`cancelled, deleted, declined\`\n` 
  +  
  (is_error ? await generate_error_message() : `\`\`\`${year_over_year_table}\n\`\`\``) 
  +  
  `\n🏃‍♀️ Most Recent 7 Days:\n` 
  +  
  (!is_error && `\`\`\`${last_7_days_table}\n\`\`\``) 
  +  
  `\n🚴‍♂️ Most Recent 10 Events:\n` 
  +  
  (!is_error && `\`\`\`${last_10_created_events}\n\`\`\``)
;

  const slack_blocks = await get_slack_block_template(slack_message);

  return { slack_message, slack_blocks };
}

module.exports = {
  create_slack_message,
}
// Format helpers with null/undefined/NaN safety
const fmtCurrency = val => {
  const num = parseFloat(val);
  return isFinite(num) ? `$${Math.round(num / 1000).toLocaleString()}K` : "";
};

const fmtNumber = val =>
  isFinite(parseInt(val)) ? parseInt(val).toLocaleString() : "";

const fmtRPU = val =>
  isFinite(parseFloat(val)) ? `$${parseFloat(val).toFixed(2)}` : "";

const fmtPct = val =>
  isFinite(parseFloat(val)) ? `${parseFloat(val).toFixed(1)}%` : "";

async function create_markdown(row, month_name) {
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

async function pad_markdown(raw_markdown_message) {
  // Pad helper
  const pad = (str, width) => (str?.toString?.() ?? "").padEnd(width, " ");
  
  // Column widths
  const COL_WIDTHS = [30, 9, 9, 9];

  const final_formatted_message = raw_markdown_message
    .map(cols => cols.length
      ? "| " + cols.map((col, i) => pad(col, COL_WIDTHS[i])).join(" | ") + " |"
      : "")
    .join("\n");

  return final_formatted_message;
}

async function generate_revenue_markdown_table(options) {

  let { data, is_ytd_row, month, month_name } = options;

  // console.log(data);
  // console.log('options = ', options);

  // Choose the correct row based on flags
  let row;

  if (!data || data.length === 0) {
      console.error("No matching row found with given filters.");
      return "⚠️ No data available for the selected month/type/category.";
  } else if (is_ytd_row === 1) {
      row = data.find(r => r.is_ytd_row === 1);
  } else if (month) {
      console.log('month condition = ', month);
      row = data.find(r => r.month_actual === month);
  } else {
      row = data.find(r => r.is_current_month === 1);
  }

  if (!row) {
    console.error("No matching row found with given filters.");
    return "⚠️ No data available for the selected month/type/category.";
  }
  
  const raw_markdown_message = await create_markdown(row, month_name);
  console.log(raw_markdown_message);

  const final_formatted_message = await pad_markdown(raw_markdown_message);

  return final_formatted_message;
}

// Example usage:
// const { revenue_seed_data } = require('./step_4_slack_seed_data');
// let options = { data: revenue_seed_data, is_ytd_row: "", month: "", month_name: ""};      // result = is current month
// options = { data: revenue_seed_data, is_ytd_row: "", month: "" };                         // result = default to current month
// options = { data: revenue_seed_data, is_ytd_row: "", month: 5 , month_name: "May"};       // result = may
// options = { data: revenue_seed_data, is_ytd_row: "", month: 2 , month_name: "February"};  // result = Feb
// options = { data: revenue_seed_data, is_ytd_row: 1, month: "", month_name: ""};           // result = ytd
// generate_revenue_markdown_table(options);

module.exports = {
    generate_revenue_markdown_table,
};

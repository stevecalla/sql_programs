const { type_map, category_map } = require('./utilities/product_mapping');

const { pad_markdown_table } = require('./utilities/markdown_table_padding');
const { looker_link } = require('./utilities/looker_link');

const { get_date_message } = require('./utilities/date_info');
const { get_slack_block_template } = require('./utilities/slack_block_template');

async function generate_error_message() {
  const error_message = `⚠️ No data available.`;
  return error_message;
}

/**
 * YoY rows expected like:
 * {
 *   year: 2026,
 *   unique_profiles: '150,665',
 *   unique_profiles_sales_through_day_of_year: '150,665',
 *   unique_profiles_sales_ytd: '908',
 *   yoy_sales_through_doy_change: '-4,652',
 *   yoy_sales_through_doy_pct: '-3.0%'
 * }
 */
async function format_markdown_table(result) {
  const rows_2019_plus = (result || [])
    .filter(r => Number(r.year) >= 2019)
    .sort((a, b) => Number(a.year) - Number(b.year));

  // IMPORTANT:
  // Keep this "dash row" SHORT so it DOES NOT inflate column widths.
  // pad_markdown_table likely uses max string length per column, including this row.
  const markdown_message = [
    ["YEAR", "UNIQUE", "YTD CURRENT", "YTD ALL", "YoY Δ", "YoY %"],
    ["-------", "---------", "-----------", "--------", "--------", "--------"],
  ];

  for (const r of rows_2019_plus) {
    markdown_message.push([
      String(r.year ?? ""),
      r.unique_profiles ?? "",
      r.unique_profiles_sales_ytd ?? "",
      r.unique_profiles_sales_through_day_of_year ?? "",
      r.yoy_sales_through_doy_change ?? "",
      r.yoy_sales_through_doy_pct ?? "",
    ]);
  }

  return markdown_message;
}

async function generate_markdown_table(options) {
  const { result } = options;

  let is_error = false;
  if (!result || result.length === 0) {
    console.error("No rows found.");
    is_error = true;
  }

  const raw_markdown_table = !is_error && await format_markdown_table(result);
  
  const custom_padding = [7, 9, 11, 9, 9, 9];
  const final_formatted_table = !is_error && await pad_markdown_table(raw_markdown_table, custom_padding);

  const error_message = await generate_error_message();

  return { final_formatted_table, error_message, is_error };
}

async function create_slack_message(result) {
  let slack_message = "Error - No results";

  // YoY result may not include created_at_mtn; fallback to now
  let { date_message } = await get_date_message(result?.[0]?.created_at_mtn || new Date());

  const options = { result };
  const { final_formatted_table, error_message, is_error } = await generate_markdown_table(options);

  const looker_url = `https://lookerstudio.google.com/u/0/reporting/7f97c13e-287d-4bc0-bc70-969b5f3944be/page/p_kn3r3e09zd`;
  const looker_report = `Membership Base`;

  slack_message =
    `🏊‍♂️🏃‍♀️🚴‍♂️ MEMBERSHIP BASE - UNIQUE MEMBERS\n` 
    +
    `🕕 ${date_message}\n`
    +
    `👀 ${await looker_link(looker_url, looker_report)}\n`
    +
    `ℹ️ *Years:* \`2019+\`\n` 
    +
    (is_error ? error_message : `\`\`\`${final_formatted_table}\n\`\`\``) 
    +
    `* UNIQUE = Unique members full year\n` +
    `** YTD CURRENT= Thru current date of year only sold in that year\n` +
    `*** YTD ALL = Thru current date of year sold in any year`

  const slack_blocks = await get_slack_block_template(slack_message);

  // console.log(slack_message);

  return { slack_message, slack_blocks };
}

// if (require.main === module) {
//   create_slack_message().catch(err => {
//     console.error(err);
//     process.exit(1);
//   });
// }

module.exports = {
  create_slack_message,
};

const { format_date, format_date_only } = require('../../utilities/getCurrentDate');
const { looker_link } = require('./utilities/looker_link');
const { get_date_message } = require('./utilities/date_info');
const { get_slack_block_template } = require('./utilities/slack_block_template');

async function generate_error_message() {

const error_message = `⚠️ No data available for the search term.

🤼 *Slash Commands:*
• *Example #1:*      Enter \`news\`; Default is "subject=triathlon"
• *Example #2:*      Enter \`news subject=usatriathlon count=10\`
• *Example #3:*      Enter \`news subject=ironman count=3\`
• *Example #4:*      Enter \`news subject=weather austin tx count=2\`
`;
  return error_message;
}

function padString(str, length) {
  str = String(str);
  if (str.length >= length) return str;
  return str + ' '.repeat(length - str.length);
}

async function format_markdown_table_news_data(news_data) {
    const headers = ['Date', 'Title (hover & click link)'];
    const date_width = 17;
    const title_width = 55;
    const colWidths = [date_width, title_width];

    // Format header row
    const headerRow = headers.map((h, i) => padString(h, colWidths[i])).join(' | ');
    const divider = colWidths.map(w => '-'.repeat(w)).join(' | ');

    // Format data rows
    const rows = await Promise.all(
      news_data.map(async row => {
        const [title, date, link] = row;

        // Ensure the title is exactly 60 characters
        let formatted_title;
        if (title.length > title_width) {
          formatted_title = title.slice(0, title_width - 3) + '...';
        } else {
          formatted_title = title.padEnd(title_width, '');
        }

        // Wrap title in a link
        const title_with_link = await looker_link(link, formatted_title);

        const rowData = [
          padString(format_date_only(date), colWidths[0]),
          title_with_link
        ];

        return rowData.join(' | ');
      })
    );

    // Join all rows into a markdown string
    const markdown = [
      '| ' + headerRow,
      '| ' + divider,
      ...rows.map(r => '| ' + r)
    ].join('\n');

    return markdown;
}

async function create_slack_message(result_news, subject, count) {

  console.log('step 1a create slack news data message');

  let slack_message = "Error - No results";
  let is_error = false;
  let news_table = "";

  let { date_message } = await get_date_message(format_date(result_news[0][1]));

  // VALIDATE RESULTS
  if (!subject || subject === undefined || !result_news || result_news.length === 0) {
    console.error("Try again. Search term = \`subject\`.");
    is_error = true;
  } else {
    news_table = await format_markdown_table_news_data(result_news);
  }

// MESSAGE
// 📈🤼🚴‍♂️🥇👀📢🏊‍♂️🏃‍♀️🚴‍♂️🕕ℹ️📰🔎
slack_message =    
  `📰 *RECENT NEWS - GOOGLE NEWS FEED*\n` 
  + 
  (is_error ? "" : date_message) + `\n`
  +
  `\n🔎 *Search Term:* \`${subject}\`; *Count Requested:* \`${count}\`\n` 
  +  
  (is_error ? await generate_error_message() : `\`\`\`${news_table}\n\`\`\``) 
;

  const slack_blocks = await get_slack_block_template(slack_message);

  return { slack_message, slack_blocks };
}

module.exports = {
  create_slack_message,
}
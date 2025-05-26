const { type_map, category_map} = require('./product_mapping');
const { get_slack_block_template } = require('./slack_block_template');

const slack_message_revenue = `
👀 *Slash Commands:*
1) \`/revenue\` – returns current month to date, all types
2) \`/revenue month=1 type=adult_annual category=silver\`
3) \`/revenue category=silver month=ytd\`

🤼 *Options:*
• *Months:*      Enter month number \`1\` to current month or \`ytd\`
• *Types:*         \`${Object.keys(type_map).join(", ")}\`
• *Categories:*  \`${Object.keys(category_map).join(", ")}\`
`.trim()
;

async function get_slash_example_revenue() {

    const slack_message = slack_message_revenue;
    
    const slack_blocks = await get_slack_block_template(slack_message);
    // const slack_blocks = undefined; // if slack block undefined defaults to slack_message

  return { slack_message, slack_blocks };
}

module.exports = {
    get_slash_example_revenue,
}

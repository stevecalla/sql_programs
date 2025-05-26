const { type_map, category_map} = require('./product_mapping');

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

    // const slack_blocks = undefined; // if slack block undefined uses slack_message text
    const slack_message = slack_message_revenue;

    const slack_blocks = [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: slack_message,
            }
        },
        {
            "type": "divider"
        },
        {
            "type": "image",
            "image_url": "https://cataas.com/cat?type=square&position=center",
            "alt_text": "Cute kitten",
            // "image_url": "https://picsum.photos/100",
            // "alt_text": "Random image",
        },
  ];

  return { slack_message, slack_blocks };
}

module.exports = {
    get_slash_example_revenue,
}

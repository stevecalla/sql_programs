const { get_image_url } = require('./get_random_image_url');

async function get_slack_block_template(slack_message) {
    
    const url = await get_image_url();

    // const slack_blocks = undefined; // if slack block undefined uses slack_message text
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
            "image_url": `${url}`,
            "alt_text": "Random image of cat, dog, fox or other",
        },
  ];

//   console.log('slack blocks =', slack_blocks);

  return slack_blocks;
}

// get_slack_block_template('hello');

module.exports = {
    get_slack_block_template,
}
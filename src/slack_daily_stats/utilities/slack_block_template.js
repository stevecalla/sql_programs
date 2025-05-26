async function get_slack_block_template(slack_message) {

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
            "image_url": "https://cataas.com/cat?type=square&position=center",
            "alt_text": "Cute kitten",
            // "image_url": "https://picsum.photos/100",
            // "alt_text": "Random image",
        },
  ];

  console.log('slack blocks =', slack_blocks);

  return slack_blocks;
}

module.exports = {
    get_slack_block_template,
}
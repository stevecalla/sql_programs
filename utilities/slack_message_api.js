const axios = require('axios');

const dotenv = require('dotenv');
dotenv.config({  path: "../.env" });

async function sendSlackMessage(message, slack_channel_url, channel) {
  const slack_message = `${message}`;

  const payload = {
    response_type: "ephemeral",  // Make the response visible only to the sender
    // response_type: "in_channel",  // Make the response visible to everyone
    text: slack_message,
    icon_emoji: ":ghost:",
    username: "Steve Calla",
  };

  try {
    let response;

    // Check if fetch is available
    if (typeof fetch !== 'undefined') {
      response = await fetch(slack_channel_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });


      if (!response.ok) {
        throw new Error(`Error sending message to Slack - slack message api 1: ${response.status} ${response.statusText}`);
      }

    } else {
      // Fallback to axios
      response = await axios.post(slack_channel_url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    console.log(`Message sent to USAT ${channel}`);
  } catch (error) {
    console.error('Error sending message to Slack - slack message api 2:', error.response ? error.response.data : error.message);
  }
}

async function slack_message_api(message, channel) {
  
  const slack_message_url = {
    "steve_calla_slack_channel": process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL,
    "daily_sales_bot_slack_channel": process.env.SLACK_WEBHOOK_USAT_DAILY_SALES_BOT_URL 
  };

  let url = slack_message_url[channel];
  console.log('slack api = ', url);

  await sendSlackMessage(message, slack_message_url[channel], channel);
}

// slack_message_api('test', "steve_calla_slack_channel");

module.exports = {
  slack_message_api,
}

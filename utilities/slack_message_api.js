const axios = require('axios');

const dotenv = require('dotenv');
dotenv.config({  path: "../../.env" });

async function sendSlackMessage(message, slack_channel_url) {
  const slack_message = `${message}`;

  console.log(message);
  console.log(slack_channel_url);

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
        throw new Error(`Error sending message to Slack HELP: ${response.status} ${response.statusText}`);
      }

    } else {
      // Fallback to axios
      response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    console.log('Message sent to eZhire Slack Steve Calla channel');
  } catch (error) {
    console.error('Error sending message to Slack:', error.response ? error.response.data : error.message);
  }
}

async function slack_message_api(message) {
  await sendSlackMessage(message, process.env.SLACK_WEBHOOK_STEVE_CALLA_USAT_URL);
  // await sendSlackMessage(message, process.env.SLACK_WEBHOOK_USAT_DAILY_SALES_BOT_URL);
}

slack_message_api('test');

module.exports = {
  slack_message_api,
}

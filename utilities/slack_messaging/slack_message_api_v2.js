const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });
const axios = require('axios');

// SLACK SETUP
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Function to send follow-up message to Slack
// async function send_slack_followup_message(channelId, channelName, userId, message, blocks) {

//     console.log('send slack followup =', channelId, channelName, userId, message, blocks);

//     try {
//         if(channelId && message && channelName !== "directmessage"){

//             console.log('1. slack followup message; !== directmessage');

//             await slackClient.chat.postEphemeral({
//                 channel: channelId,
//                 user: userId,
//                 text: message,
//                 ...(blocks?.length > 0 && { blocks }), // only include 'blocks' if provided
//             });
//             console.log(`Message sent to Slack ${channelName}`);
//         } else if (channelId && message && channelName === "directmessage") {

//             const im = await slackClient.conversations.open({ users: userId });
//             const dmChannelId = im.channel.id;

//             console.log('2. slack followup message; === directmessage');
//             console.log('dm channel id =', dmChannelId);

//             await slackClient.chat.postMessage({
//                 channel: dmChannelId,
//                 text: message,
//                 ...(blocks?.length > 0 && { blocks }),
//             });

//             // await slackClient.chat.postMessage({
//             //     // channel: userId, // this sends msg to the bot not user
//             //     channel: channelId, // this fails channel not found
//             //     text: message,
//             //     ...(blocks?.length > 0 && { blocks }), // only include 'blocks' if provided
//             // });
//             console.log(`Message sent to Slack ${channelName}`);
//         } else {
//             console.error('Channel ID or message is missing');
//         }
//     } catch (error) {
//         console.error('Error sending message to Slack in server.js:', error);
//     }
// }

async function send_slack_followup_message(channelId, channelName, userId, response_url, message, blocks) {
  try {
    if (!channelId || !message) {
      console.error('Missing channelId or message');
      return;
    }

    const isDirectMessage = channelId.startsWith('D');

    if (isDirectMessage) {
        await axios.post(response_url, {
        text: message,
        response_type: 'ephemeral', // or 'in_channel' if desired
        ...(blocks?.length > 0 && { blocks }),
    });

    } else {
      await slackClient.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: message,
        ...(blocks?.length > 0 && { blocks }),
      });
    }
  } catch (error) {
    console.error('Error sending message to Slack:', error);
  }
}


module.exports = {
    send_slack_followup_message,
}


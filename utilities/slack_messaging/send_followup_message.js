const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

// SLACK SETUP
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Function to send follow-up message to Slack
async function send_slack_followup_message(channelId, channelName, userId, message, blocks) {

    console.log('send slack followup =', channelId, channelName, userId, message, blocks);

    try {
        if(channelId && message && channelName !== "directmessage"){

            console.log('1. slack followup message; !== directmessage');

            await slackClient.chat.postEphemeral({
                channel: channelId,
                user: userId,
                text: message,
                ...(blocks?.length > 0 && { blocks }), // only include 'blocks' if provided
            });
            console.log(`Message sent to Slack ${channelName}`);
        } else if (channelId && message && channelName === "directmessage") {
            
            console.log('2. slack followup message; === directmessage');

            await slackClient.chat.postMessage({
                channel: userId,
                text: message,
                ...(blocks?.length > 0 && { blocks }), // only include 'blocks' if provided
            });
            console.log(`Message sent to Slack ${channelName}`);
        } else {
            console.error('Channel ID or message is missing');
        }
    } catch (error) {
        console.error('Error sending message to Slack in server.js:', error);
    }
}

module.exports = {
    send_slack_followup_message,
}


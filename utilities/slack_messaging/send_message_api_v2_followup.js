const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });
const axios = require('axios');

// SLACK SETUP
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Function to send follow-up message to Slack
async function send_slack_followup_message(channelId, channelName, userId, response_url, message, blocks) {

    console.log('send slack v2 followup channel details =', channelId, channelName, userId, response_url);
    // console.log('send slack v2 followup =', message);
    // console.log('send slack v2 followup blocks =', blocks);

    try {
        if (channelId && message && channelName !== "directmessage") {

            console.log('1. slack followup message; !== directmessage');

            await slackClient.chat.postEphemeral({
                channel: channelId,
                user: userId,
                text: message,
                ...(blocks?.length > 0 && { blocks }), // only include 'blocks' if provided
            });
            console.log(`Message sent to Slack ${channelName}`);
        } else if (
            (channelId && message && channelName === "directmessage") ||
            response_url
        ) {
            
            console.log('2. slack followup message; === directmessage');
            
            await axios.post(response_url, {
                icon_emoji: ":ghost:",
                username: "Steve Calla",
                response_type: 'ephemeral', // or 'in_channel' if desired
                text: message,
                ...(blocks?.length > 0 && { blocks }),    
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


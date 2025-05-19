const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { WebClient } = require('@slack/web-api');

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const slackToken = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(slackToken);

// async function uploadAndShareFile(filePath, channelId, messageText) {
//   try {
//     const fileName = path.basename(filePath);
//     const fileSize = fs.statSync(filePath).size;

//     // Step 1: Get Upload URL and File ID
//     const url_response = await web.files.getUploadURLExternal({
//       filename: fileName,
//       length: fileSize,
//     });

//     const { ok, upload_url, file_id } = url_response;
//     console.log('Upload URL received:', upload_url);
//     console.log('File ID:', file_id);

//     // Step 2: Upload the file to Slack's temporary upload URL
//     const fileStream = fs.createReadStream(filePath);
//     const form = new FormData();
//     form.append('file', fileStream, fileName);

//     const uploadResponse = await axios.post(upload_url, form, {
//       headers: form.getHeaders(),
//     });

//     if (uploadResponse.status !== 200) {
//       throw new Error(`Upload failed with status: ${uploadResponse.status}`);
//     }

//     console.log('✅ File uploaded to Slack temporary storage');

//     // Step 3: Finalize the upload and share to channel
//     await web.files.completeUploadExternal({
//       files: [{ id: file_id }],
//       channel_id: channelId,
//     });

//     console.log('✅ File upload finalized');

//     // Step 4: Post the file with a message
//     const block_object = [
//       {
//         type: "section",
//         text: {
//           type: "mrkdwn",
//           text: messageText
//         }
//       }
//     ];

//     await web.chat.postMessage({
//       channel: channelId,
//       text: messageText,
//       blocks: block_object,
//     });

//     console.log('✅ File shared with message in the channel');
//     console.log('✅ Message posted');

//   } catch (error) {
//     console.error('❌ Error:', error.data?.error || error.message);
//   }
// }

// // Example usage
// const upload_file_path = '../../utilities/python_events/src/event_output/chart_yoy_filtered_adult_race.png';
// // const filePath = path.resolve(__dirname, 'your_file.pdf'); // Replace with your file path
// const filePath = path.resolve(__dirname, upload_file_path); // Replace with your file path
// // const channelId = 'C08TMBPTKEC'; // test_calla (private channel with bot /invite @membership-sales-bot)
// const channelId = 'D07H5CCLNKB'; // steve calla channel
// const messageText = 'Here is the latest report 📄';

// uploadAndShareFile(filePath, channelId, messageText);


const email = "steve.calla@usatriathlon.org";

async function getUserIdByEmail(email) {
  try {
    const result = await web.users.lookupByEmail({ email });
    console.log("User ID:", result.user.id); // 👈 this is your user ID
    return result.user.id;
  } catch (error) {
    console.error("Error fetching user ID:", error.data?.error || error.message);
  }
}

getUserIdByEmail(email);


// NOTE:
// const file_path = 'C:/Users/calla/development/usat/sql_programs/utilities/python_events/src/event_output/chart_yoy_filtered_adult_race.png';
// const file_path = '../../utilities/python_events/src/event_output/chart_yoy_filtered_adult_race.png';

// console.log('dirname ', __dirname);
// console.log(path.resolve(__dirname, '../../output/daily_report.csv'));
// console.log(path.resolve(__dirname, file_path));
// console.log(process.env.SLACK_BOT_TOKEN);

// NOTE: Here's a small Node.js script to list your Slack channel names and their corresponding channel IDs using your bot token (SLACK_BOT_TOKEN). This will help you identify the correct channel ID to use with files.upload.

// const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// async function listSlackChannels() {
//   try {
//     const response = await axios.get('https://slack.com/api/conversations.list', {
//       headers: {
//         Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
//       },
//       params: {
//         types: 'public_channel,private_channel',
//         limit: 1000,
//       },
//     });

//     if (!response.data.ok) {
//       throw new Error(`Slack API error: ${response.data.error}`);
//     }

//     console.log('📋 Slack Channels:');
//     response.data.channels.forEach(channel => {
//       console.log(`- ${channel.name} (${channel.is_private ? 'private' : 'public'}) ➜ ID: ${channel.id}`);
//     });
//   } catch (error) {
//     console.error('❌ Error fetching channels:', error.message);
//   }
// }

// listSlackChannels();





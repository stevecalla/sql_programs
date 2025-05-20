// const fs = require('fs');
// const path = require('path');
// const axios = require('axios');
// const FormData = require('form-data');
// const { WebClient } = require('@slack/web-api');
// require('dotenv').config({ path: '../../.env' });

// const slackToken = process.env.SLACK_BOT_TOKEN;
// const web = new WebClient(slackToken);
// const SIZE_LIMIT_V2 = 1000 * 1000 * 1000; // 1 GB

// // Upload one file and return the file ID
// async function uploadFileHybrid(filePath, channelId) {
//   const fileName = path.basename(filePath);
//   const fileSize = fs.statSync(filePath).size;

//   try {
//     if (fileSize <= SIZE_LIMIT_V2) {
//       const result = await web.filesUploadV2({
//         channel_id: channelId,
//         file_uploads: [{ file: filePath, filename: fileName }],
//       });
//       return result.files[0].id;
//     } else {
//       const { upload_url, file_id } = await web.files.getUploadURLExternal({
//         filename: fileName,
//         length: fileSize,
//       });

//       const fileStream = fs.createReadStream(filePath);
//       const form = new FormData();
//       form.append('file', fileStream, fileName);

//       const uploadResponse = await axios.post(upload_url, form, {
//         headers: form.getHeaders(),
//       });

//       if (uploadResponse.status !== 200) {
//         throw new Error(`Upload failed: ${uploadResponse.status}`);
//       }

//       await web.files.completeUploadExternal({
//         files: [{ id: file_id }],
//         channel_id: channelId,
//       });

//       return file_id;
//     }
//   } catch (err) {
//     console.error(`❌ Error uploading ${fileName}:`, err.data?.error || err.message);
//     return null;
//   }
// }

// // Upload all files in a folder and post in thread
// async function uploadAllToThread(folderPath, channelId, mainMessageText = '📊 Here is the latest batch of reports:') {
//   // 1. Post the main message
//   const parent = await web.chat.postMessage({
//     channel: channelId,
//     text: mainMessageText,
//   });
//   const thread_ts = parent.ts;
//   console.log('parent = ', parent, thread_ts);

//   // 2. Upload each file and collect file blocks
//   const files = fs.readdirSync(folderPath).filter(file => fs.statSync(path.join(folderPath, file)).isFile());

//   console.log('files = ', files);

//   const fileBlocks = [];

//   for (const file of files) {
//     const fullPath = path.join(folderPath, file);
//     const file_id = await uploadFileHybrid(fullPath, channelId);

//     if (file_id) {
//       fileBlocks.push({
//         type: 'file',
//         external_id: file_id,
//         source: 'remote',
//       });
//     }
//   }
  
//   console.log('fileblocks = ', fileBlocks);

//   // 3. Post a single reply in the thread with all files
//   if (fileBlocks.length > 0) {
//     await web.chat.postMessage({
//       channel: channelId,
//       thread_ts,
//       text: '🧾 Attached files:',
//       blocks: fileBlocks,
//     });
//     console.log('✅ Files posted to thread');
//   } else {
//     console.log('⚠️ No files uploaded');
//   }
// }

// // 🟢 Run
// const folderPath = path.resolve(__dirname, '../../utilities/python_events/src/event_output_slack_test');
// const channelId = 'C08TMBPTKEC'; // test_calla or a DM ID

// uploadAllToThread(folderPath, channelId);

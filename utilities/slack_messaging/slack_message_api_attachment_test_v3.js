const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { WebClient } = require('@slack/web-api');
require('dotenv').config({ path: '../../.env' });

const slackToken = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(slackToken);
const SIZE_LIMIT_V2 = 1000 * 1000 * 1000; // 1 GB

const { determineOSPath } = require('../../utilities/determineOSPath');

// Upload one file and return the file ID
async function uploadFileHybrid(filePath, channelId) {
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;

  try {
    if (fileSize <= SIZE_LIMIT_V2) {
      const result = await web.filesUploadV2({
        channel_id: channelId,
        file_uploads: [{ file: filePath, filename: fileName }],
      });
      return result.files[0].id;
    } else {
      const { upload_url, file_id } = await web.files.getUploadURLExternal({
        filename: fileName,
        length: fileSize,
      });

      const fileStream = fs.createReadStream(filePath);
      const form = new FormData();
      form.append('file', fileStream, fileName);

      const uploadResponse = await axios.post(upload_url, form, {
        headers: form.getHeaders(),
      });

      if (uploadResponse.status !== 200) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      await web.files.completeUploadExternal({
        files: [{ id: file_id }],
        channel_id: channelId,
      });

      return file_id;
    }
  } catch (err) {
    console.error(`❌ Error uploading ${fileName}:`, err.data?.error || err.message);
    return null;
  }
}

// const folderPath = '../../utilities/python_events/src/event_output_slack_test';

const directoryName = 'usat_event_output';
const channelId = 'C08TMBPTKEC'; // test_calla or a DM ID

async function process_folder_path(directoryName) {
  // 1. Create full path
  const basePath = await determineOSPath();
  const fullPath = path.join(basePath, directoryName);

  // 2. Upload each file and collect file blocks
  const files = fs.readdirSync(fullPath).filter(file => fs.statSync(path.join(fullPath, file)).isFile());

  console.log('files = ', files);

  // 3. Create file block
  const file_blocks = [];

  for (const file of files) {
    const filePath = path.join(fullPath, file);

    file_blocks.push({
      file: filePath,
      filename: file,
    });
  }

  return { file_blocks };
}

// Upload all files in a folder and post in thread
async function uploadAllToThread(directoryName, channelId, mainMessageText = '📊 Here is the latest batch of reports:') {

  // 1. Post the main message
  const parent = await web.chat.postMessage({
    channel: channelId,
    text: mainMessageText,
  });
  const thread_ts = parent.ts;
  console.log('parent = ', parent, thread_ts);

  // 2. Post additional text to the thread
  // await web.chat.postMessage({
  //   channel: channelId,
  //   thread_ts,
  //   text: '🧾 Attached files:',
  //   // blocks: fileBlocks,
  // });

  // 3. Post a single reply in the thread with all files
  const { file_blocks } = await process_folder_path(directoryName);
  console.log('file blocks = ', file_blocks);
  
  if (file_blocks.length > 0) {
    await web.filesUploadV2({
      channel_id: channelId,
      thread_ts,
      initial_comment: "🧾 Attached files:",
      file_uploads: file_blocks,
    });
    console.log('✅ Files posted to thread');
  } else {  
      await web.chat.postMessage({
        channel: channelId,
        thread_ts,
        text: '⚠️ No files uploaded',
      });
      console.log('⚠️ No files uploaded');
  }
}

// 🟢 Run
// uploadAllToThread(directoryName, channelId);

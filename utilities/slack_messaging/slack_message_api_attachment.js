const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');
require('dotenv').config({ path: '../../.env' });

const slackToken = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(slackToken);

const { determineOSPath } = require('../../utilities/determineOSPath');

async function get_folder_path(directoryName) {
  // Create full path
  const basePath = await determineOSPath();
  
  const fullPath = path.join(basePath, directoryName);

  return { basePath, fullPath };
}

async function get_upload_files(fullPath) {
  // Upload each file and collect file blocks
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

/**
 * Post a message to a Slack channel or as a threaded reply.
 *
 * @param {Object} options - Configuration for the message.
 * @param {string} options.channelId - The Slack channel ID to post to.
 * @param {string} options.text - The message text.
 * @param {string} [options.thread_ts] - Optional timestamp to post in a thread.
 * @param {WebClient} options.web - Instance of Slack WebClient.
 * @returns {Promise<object>} - The result from Slack API (includes ts for threading).
 */
async function post_slack_message({ channelId, text, thread_ts, web }) {
  try {
    const result = await web.chat.postMessage({
      channel: channelId,
      text,
      ...(thread_ts ? { thread_ts } : {})  // include thread_ts only if provided
    });

    console.log(`✅ Message posted${thread_ts ? ' in thread' : ''}:`, result.ts);
    return result;
  } catch (error) {
    console.error(`❌ Failed to post message${thread_ts ? ' in thread' : ''}:`, error.data?.error || error.message);
    return null;
  }
}

// Upload all files in a folder and post in thread
async function upload_all_to_thread(
  directoryName = "usat_event_output", 
  channelId = 'C08TMBPTKEC', 
  mainMessageText = '📊 Here is the latest batch of reports:') {

  // 1. Post the main message
  // Post main message
  const parent = await post_slack_message({
    channelId,
    text: mainMessageText,
    web
  });
  const thread_ts = parent.ts;

  // 2. Post additional text to the thread
  // await post_slack_message({
  //   channelId,
  //   text: '✅ Optional Additional Message',
  //   thread_ts: parent.ts,
  //   web
  // });

  // 3. Post a single reply in the thread with all files
  const { fullPath } = await get_folder_path(directoryName);
  const { file_blocks } = await get_upload_files(fullPath);
  
  if (file_blocks.length > 0) {
    await web.filesUploadV2({
      channel_id: channelId,
      thread_ts,
      initial_comment: "🧾 Attached files:",
      file_uploads: file_blocks,
    });
    console.log('✅ Files posted to thread');
  } else {  
      await post_slack_message({
        channelId,
        text: '⚠️ No files uploaded',
        thread_ts: parent.ts,
        web
      });
      console.log('⚠️ No files uploaded');
  }
}

// 🟢 Run
upload_all_to_thread(
  directoryName = "usat_event_output", 
  channelId = 'C08TMBPTKEC', 
  mainMessageText = '📊 Here is the latest batch of reports:'
);

module.exports = {
  upload_all_to_thread,
}

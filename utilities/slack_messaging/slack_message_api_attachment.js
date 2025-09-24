const fs = require('fs');
const fs_p = require('fs/promises');
const path = require('path');
const { WebClient } = require('@slack/web-api');
require('dotenv').config({ path: '../../.env' });

const slackToken = process.env.SLACK_BOT_TOKEN;
const web = new WebClient(slackToken);

const { determineOSPath } = require('../../utilities/determineOSPath');

async function get_folder_path(directoryName) {
  // Create full path
  const basePath = await determineOSPath();

  console.log('base path =', basePath);

  const fullPath = path.join(basePath, directoryName);

  return { basePath, fullPath };
}

/**
 * Build file blocks for either a specific file_path, or all files in directory_path.
 * - Non-blocking (async)
 * - Avoids extra stat() by using Dirent
 * - Stable sort
 * @param {string} directory_path
 * @param {string} [file_path] optional absolute/relative file path
 * @returns {Promise<Array<{file:string, filename:string}>>}
 */
async function get_upload_files(directory_path, file_path) {
  const file_blocks = [];

  // If a single file is provided, short-circuit
  if (file_path) {

    file_blocks.push({
      file: file_path,
      filename: path.basename(file_path), // get file name
    });

    return { file_blocks };
  }

  // Otherwise, list files in the directory
  const dirents = await fs_p.readdir(directory_path, { withFileTypes: true });
  const files = dirents
    .filter(d => d.isFile())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b)); // stable order

  file_blocks = files.map(name => ({
    file: path.join(directory_path, name),
    filename: name,
  }));

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

  console.log('full path', fullPath);

  // if (file_blocks.length > 0) {
  //   await web.filesUploadV2({
  //     channel_id: channelId,
  //     thread_ts,
  //     initial_comment: "🧾 Attached files:",
  //     file_uploads: file_blocks,
  //   });
  //   console.log('✅ Files posted to thread');
  // } else {  
  //     await post_slack_message({
  //       channelId,
  //       text: '⚠️ No files uploaded',
  //       thread_ts: parent.ts,
  //       web
  //     });
  //     console.log('⚠️ No files uploaded');
  // }
}

async function upload_single_file_to_thread(
  file_directory,
  file_path,
  channelId = 'C08TMBPTKEC',
  mainMessageText = '📊 Here is the latest batch of reports:') {

  console.log('file_directory 2 =', file_directory);
  console.log('file_path 2 = ', file_path);

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
  const { file_blocks } = await get_upload_files(file_directory, file_path);

  // console.log('full path', fullPath);

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
// upload_all_to_thread(
//   directoryName = "usat_event_output", 
//   channelId = 'C08TMBPTKEC', 
//   mainMessageText = '📊 Here is the latest batch of reports:'
// );

module.exports = {
  upload_all_to_thread,
  upload_single_file_to_thread,
}

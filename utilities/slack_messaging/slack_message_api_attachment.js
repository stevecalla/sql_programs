const fs = require('fs');
const fs_p = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: '../../.env' });

const slackToken = process.env.SLACK_BOT_TOKEN;
const { WebClient } = require('@slack/web-api');
const web = new WebClient(slackToken);

const { determineOSPath } = require('../../utilities/determineOSPath');

async function get_upload_files(directory_path, file_path) {
  let file_blocks = [];

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

async function post_slack_message({ channelId, text, thread_ts }) {
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

async function file_upload_to_slack(file_directory, file_path, channelId, thread_ts, month, type, is_reported) {
  const { file_blocks } = await get_upload_files(file_directory, file_path);

  if (file_blocks.length > 0) {
    // Only append the Month/Type/Reported detail when those values are
    // provided (the event-analysis server passes them; the duplicates server
    // does not). Avoids an irrelevant "Month=, Type=, Reported=" line.
    const has_detail = [month, type, is_reported].some((v) => v != null && v !== '');
    const initial_comment = has_detail
      ? `🧾 Attached file(s):\nMonth=${month}, Type=${type}, Reported=${is_reported}`
      : '🧾 Attached file(s):';
    await web.filesUploadV2({
      channel_id: channelId,
      thread_ts,
      initial_comment,
      file_uploads: file_blocks,
    });
    console.log('\n✅ File(s) posted to thread');
  } else {
    await post_slack_message({
      channelId,
      text: '⚠️ No file(s) uploaded',
      thread_ts,
    });
    console.log('⚠️ No file(s) uploaded');
  }
}

async function upload_single_file_to_thread_scheduled(
  file_directory,
  file_path,
  channelId = 'C08TMBPTKEC', // channel = test_calla
  mainMessageText = '📊 Here is the latest batch of reports:',
  channel_name,
  user_id,
  // Default these so the helper no longer relies on caller-leaked globals.
  // server_slack_events.js calls with the first 4 args, so these fall back to
  // 'all' — the same values it used to leak — keeping its behavior unchanged.
  month = 'all',
  type = 'all',
  is_reported = 'all',) {

  // console.log('========= channel id =', channelId);
  // console.log('========= channel name = ', channel_name);
  // console.log('========= user_id = ', user_id);

  // 1. Post the main message
  // Post main message
  const parent = await post_slack_message({
    channelId,
    text: mainMessageText,
  });
  const thread_ts = parent.ts;

  // 2. Post additional text to the thread
  // await post_slack_message({
  //   channelId,
  //   text: '✅ Optional Additional Message',
  //   thread_ts,
  // });

  // 3. Post a single reply in the thread with all files
  await file_upload_to_slack(file_directory, file_path, channelId, thread_ts, month, type, is_reported);
}

async function upload_single_file_to_thread_user(
  file_directory,
  file_path,
  channelId = 'C08TMBPTKEC',
  mainMessageText = '📊 Here is the latest batch of reports:',
  channel_name,
  user_id,
  month, 
  type,
  is_reported,
) {
  // console.log('========= channel id =', channelId);
  console.log('========= channel name = ', channel_name);
  // console.log('========= user_id = ', user_id);

  // 1) open DM (app <-> user)
  const { channel } = await web.conversations.open({ users: user_id });
  channelId = channel.id;

  // 2) post parent message in DM
  const parent = await web.chat.postMessage({ channel: channelId, text: mainMessageText });
  const thread_ts = parent.ts;

  // 3. Post a single reply in the thread with all files
  await file_upload_to_slack(file_directory, file_path, channelId, thread_ts, month, type, is_reported);

  // 4) get a permalink to the parent message
  const { permalink } = await web.chat.getPermalink({ channel: channelId, message_ts: parent.ts });

  // 5) use response_url to notify in the original context 
  const axios = require('axios');
  await axios.post(response_url, {
    response_type: "ephemeral",
    text: `Your file(s) are ready here: ${permalink}`,
  });
}

// 🟢 Run
// upload_all_to_thread_scheduled(
//   directoryName = "usat_event_output", 
//   channelId = 'C08TMBPTKEC', 
//   mainMessageText = '📊 Here is the latest batch of reports:'
// );

module.exports = {
  // upload_all_to_thread,
  upload_single_file_to_thread_scheduled,
  upload_single_file_to_thread_user,
}

// async function get_folder_path(directoryName) {
//   // Create full path
//   const basePath = await determineOSPath();
//   console.log('base path =', basePath);
//   const fullPath = path.join(basePath, directoryName);
//   return { basePath, fullPath };
// }

// // Upload all files in a folder and post in thread
// async function upload_all_to_thread(
//   directoryName = "usat_event_output",
//   channelId = 'C08TMBPTKEC',
//   mainMessageText = '📊 Here is the latest batch of reports:') {

//   // 1. Post the main message
//   // Post main message
//   const parent = await post_slack_message({
//     channelId,
//     text: mainMessageText,
//   });
//   const thread_ts = parent.ts;

//   // 2. Post additional text to the thread
//   // await post_slack_message({
//   //   channelId,
//   //   text: '✅ Optional Additional Message',
//   //   thread_ts: parent.ts,
//   // });

//   // 3. Post a single reply in the thread with all files
//   // const { fullPath } = await get_folder_path(directoryName);

//   // 3. Post a single reply in the thread with all files
//   // await file_upload_to_slack(file_directory, file_path, channelId, thread_ts);
// }

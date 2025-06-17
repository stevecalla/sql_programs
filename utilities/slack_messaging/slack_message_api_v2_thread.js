require('dotenv').config({ path: '../../.env' });
const slackToken = process.env.SLACK_BOT_TOKEN;

const { WebClient } = require('@slack/web-api');
const { slack_message_api } = require('./slack_message_api');
const slack = new WebClient(slackToken);

// async function slack_message_api_v2_thread(channelId, message, blocks, thread_ts) {
//   try {
//     const response = await slack.chat.postMessage({
//       channel: channelId,
//       text: message,
//       // blocks,
//       ...(thread_ts && { thread_ts }) // if replying in thread
//     });

//     console.log('Message sent. ts =', response.ts);
//     console.log('response = ', response);
//     console.log(`✅ Message posted${thread_ts ? ' in thread' : ''}:`, response.ts);

//     return response.ts; // return for threading if needed

//   } catch (error) {

//     console.error(`❌ Failed to post message${thread_ts ? ' in thread' : ''}:`, error.data?.error || error.message);
//   }
// }

async function slack_message_api_v2_thread(channelId, userId, message, blocks = {}, thread_ts = '') {
  // const userInfo = await slack.users.info({ user: userId });
  // console.log('👤 Sending message to user:', userId, userInfo.user.real_name, userInfo.user.name);

  console.log('what does it look like = ', thread_ts);

  try {
    // If DM, open a conversation first
    if (!channelId && userId) {
      const dm = await slack.conversations.open({ users: userId });

      console.log('dm =', dm);
      channelId = dm.channel.id;
      console.log('dm channel id = ', channelId);
    }

    const response = await slack.chat.postMessage({
      channel: channelId,
      text: message,
      ...(blocks && Object.keys(blocks).length && { blocks }),
      ...(thread_ts && { thread_ts }),
    });

    console.log(`Slack message sent. ts=${response.ts}`);
    return response.ts;

  } catch (error) {

    console.error('Slack post error:', error.data || error.message);
  }
}

// 🟢 Run
async function test() {

  //NOTE: Initial message
  const initial_message = await slack_message_api_v2_thread(
    // NOTE: To send to Steve Calla (actually goes to membership sales bot)
    channelId = '', // set channel id to blank
    userId = 'U07GC601RPZ', // this is "steve_calla" slack channel; Find your Slack User ID: Click your profile picture → "View Profile" → click ••• → "Copy member ID".

    // NOTE: To send to a channel
    // channelId = 'C08TMBPTKEC', // this is "test_calla" slack channel; works
    // channelId = 'C082FHT4G5D', // this is "daily-sales-bot" slack channel; works
    // userId = '',

    message = '📊 This is a test.',
    blocks = {},
    thread_ts = '',
  );

  const message_timestamp = initial_message;
  console.log('message_timestamp = ', message_timestamp);

  if (message_timestamp) {
    slack_message_api_v2_thread(
      // NOTE: To send to Steve Calla (actually goes to membership sales bot)
      channelId = '', // set channel id to blank
      userId = 'U07GC601RPZ', // this is "steve_calla" slack channel; Find your Slack User ID: Click your profile picture → "View Profile" → click ••• → "Copy member ID".

      // NOTE: To send to a channel
      // channelId = 'C08TMBPTKEC', // this is "test_calla" slack channel; works
      // channelId = 'C082FHT4G5D', // this is "daily-sales-bot" slack channel; works
      // userId = '',

      message = '📊 This is a thread message.',
      blocks = {},
      thread_ts = `${message_timestamp}`,
    );
  }
}

test()

module.exports = {
  slack_message_api_v2_thread,
}

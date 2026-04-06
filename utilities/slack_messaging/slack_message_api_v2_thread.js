// C:\Users\calla\development\usat\sql_programs\utilities\slack_messaging\slack_message_api_v2_thread.js

require('dotenv').config({ path: '../../.env' });

const { WebClient } = require('@slack/web-api');

const slackToken = process.env.SLACK_BOT_TOKEN;
const slack = new WebClient(slackToken);

function is_dm_channel(channelId = '') {
  return typeof channelId === 'string' && channelId.startsWith('D');
}

function is_channel_like(channelId = '') {
  return typeof channelId === 'string' && ['C', 'G'].includes(channelId.charAt(0));
}

async function resolve_slack_channel_id(channelId = '', userId = '') {
  // If a normal public/private channel was provided, use it directly
  if (is_channel_like(channelId)) {
    return channelId;
  }

  // If this is a DM or no usable channelId was passed, open DM via userId
  if (userId) {
    const dm = await slack.conversations.open({ users: userId });
    const resolved_dm_channel_id = dm?.channel?.id;

    if (!resolved_dm_channel_id) {
      throw new Error(`Unable to open DM conversation for userId=${userId}`);
    }

    return resolved_dm_channel_id;
  }

  // Last fallback: if some other channelId was passed, try it as-is
  if (channelId) {
    return channelId;
  }

  throw new Error('No valid Slack destination provided. Expected channelId and/or userId.');
}

async function slack_message_api_v2_thread(
  channelId = '',
  userId = '',
  message = '',
  blocks = undefined,
  thread_ts = ''
) {
  try {
    const resolved_channel_id = await resolve_slack_channel_id(channelId, userId);

    console.log('🧵 Slack message destination resolved =', {
      original_channel_id: channelId || '(blank)',
      user_id: userId || '(blank)',
      resolved_channel_id,
      thread_ts: thread_ts || '(none)',
    });

    const response = await slack.chat.postMessage({
      channel: resolved_channel_id,
      text: message,
      ...(blocks && Object.keys(blocks).length > 0 ? { blocks } : {}),
      ...(thread_ts ? { thread_ts } : {}),
    });

    console.log(`✅ Slack message sent${thread_ts ? ' in thread' : ''}. ts=${response.ts}`);
    return response.ts;

  } catch (error) {
    console.error('❌ Slack post error:', error?.data || error?.message || error);
    return null;
  }
}

module.exports = {
  slack_message_api_v2_thread,
};
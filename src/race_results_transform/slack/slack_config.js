'use strict';
// Slack bot-token config from environment (repo-root .env, loaded by the server/CLI). The token is a
// BOT token (xoxb-…) and is server-side only — it is never sent to the browser. is_test=true prefers
// the *_DEV_* token if you keep a separate test app; otherwise both fall back to SLACK_BOT_TOKEN.

function slack_config(opts) {
  const o = opts || {};
  const is_test = o.is_test != null ? !!o.is_test : false;
  const env = process.env;
  const file_types = String(env.SLACK_FILE_TYPES || 'xlsx,xls,csv,pptx,ppt')
    .split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  return {
    is_test: is_test,
    environment_name: is_test ? 'test' : 'production',
    // Bot User OAuth token (xoxb-…). One app is fine for both; keep *_DEV_* only if you run a separate test app.
    token: is_test ? (env.SLACK_DEV_BOT_TOKEN || env.SLACK_BOT_TOKEN) : (env.SLACK_PROD_BOT_TOKEN || env.SLACK_BOT_TOKEN),
    api_base: env.SLACK_API_BASE || 'https://slack.com/api',
    // Optional default channel pre-selection; the UI channel picker overrides it per-pull, and the CLI
    // takes --channel. Leave blank and the user just picks from the dropdown.
    default_channel: env.SLACK_CHANNEL_ID || '',
    // auto | public | private — only affects how channel visibility is reported; reads work for both
    // once the bot is a member.
    channel_visibility: (env.SLACK_CHANNEL_VISIBILITY || 'auto').toLowerCase(),
    file_types: file_types
  };
}

// Returns { ok, missing[] } so callers can 503 with a clear message instead of throwing on boot.
function check_slack_config(cfg) {
  const missing = [];
  if (!cfg.token) missing.push(cfg.is_test ? 'SLACK_DEV_BOT_TOKEN (or SLACK_BOT_TOKEN)' : 'SLACK_BOT_TOKEN');
  return { ok: missing.length === 0, missing: missing };
}

module.exports = { slack_config, check_slack_config };

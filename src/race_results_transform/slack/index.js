'use strict';
// One entry point for the Slack race-results intake module (server + CLI + tests).
const config = require('./slack_config');
const dates = require('./slack_dates');
const naming = require('./slack_naming');
const client = require('./slack_client');
const fetch_mod = require('./slack_fetch');

module.exports = {
  // config
  slack_config: config.slack_config,
  check_slack_config: config.check_slack_config,
  // dates
  DEFAULT_TZ: dates.DEFAULT_TZ,
  slack_ts_window: dates.slack_ts_window,
  make_date_filter: dates.make_date_filter,
  ymd_in_time_zone: dates.ymd_in_time_zone,
  datetime_in_time_zone: dates.datetime_in_time_zone,
  today_ymd_in_time_zone: dates.today_ymd_in_time_zone,
  // naming
  snake_case: naming.snake_case,
  safe_file_name: naming.safe_file_name,
  build_download_file_name: naming.build_download_file_name,
  // client
  make_connection: client.make_connection,
  auth_test: client.auth_test,
  list_member_channels: client.list_member_channels,
  channel_info: client.channel_info,
  list_channel_files: client.list_channel_files,
  file_ext: client.file_ext,
  DEFAULT_EXTS: client.DEFAULT_EXTS,
  // fetch
  fetch_file_bytes: fetch_mod.fetch_file_bytes
};

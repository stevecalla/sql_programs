'use strict';
// One entry point for the Salesforce race-results module (server + CLI + tests).
const naming = require('./sf_naming');
const dates = require('./sf_dates');
const config = require('./sf_config');
const client = require('./sf_client');
const email = require('./sf_email');
const fetch_mod = require('./sf_fetch');

module.exports = {
  // naming
  snake_case: naming.snake_case,
  safe_file_name: naming.safe_file_name,
  build_download_file_name: naming.build_download_file_name,
  // dates
  DEFAULT_TZ: dates.DEFAULT_TZ,
  ymd_in_time_zone: dates.ymd_in_time_zone,
  datetime_in_time_zone: dates.datetime_in_time_zone,
  today_ymd_in_time_zone: dates.today_ymd_in_time_zone,
  make_date_filter: dates.make_date_filter,
  // config
  sf_config: config.sf_config,
  check_sf_config: config.check_sf_config,
  // client
  make_connection: client.make_connection,
  list_race_results_files: client.list_race_results_files,
  run_soql: client.run_soql,
  describe_object: client.describe_object,
  DEFAULT_SEARCH_TERM: client.DEFAULT_SEARCH_TERM,
  DEFAULT_EXTS: client.DEFAULT_EXTS,
  // email queue
  list_email_queue_files: email.list_email_queue_files,
  parse_subject: email.parse_subject,
  // fetch
  fetch_content_version_bytes: fetch_mod.fetch_content_version_bytes
};

'use strict';
// One import surface for the email-queue POC's Salesforce layer.
// Reuses the proven race_results_transform/sf plumbing (connection, run_soql, describe, fetch,
// date formatting) and adds the email-queue read modules. Internalize the plumbing later if we
// want full independence — the public surface here stays the same, so no restructuring.
const rrt = require('../../race_results_transform/sf');
const queues = require('./sf_queues');
const threads = require('./sf_threads');
const context = require('./sf_context');
const text_clean = require('./text_clean');

module.exports = {
  // plumbing (reused from race_results_transform)
  make_connection: rrt.make_connection,
  sf_config: rrt.sf_config,
  check_sf_config: rrt.check_sf_config,
  run_soql: rrt.run_soql,
  describe_object: rrt.describe_object,
  fetch_content_version_bytes: rrt.fetch_content_version_bytes,
  datetime_in_time_zone: rrt.datetime_in_time_zone,
  ymd_in_time_zone: rrt.ymd_in_time_zone,
  DEFAULT_TZ: rrt.DEFAULT_TZ,
  // email-queue reads (new)
  list_queues: queues.list_queues,
  list_queue_cases: threads.list_queue_cases,
  get_thread: threads.get_thread,
  list_attachments: threads.list_attachments,
  cases_with_attachments: threads.cases_with_attachments,
  cases_with_links: threads.cases_with_links,
  status_counts: threads.status_counts,
  message_counts: threads.message_counts,
  is_automated_sender: threads.is_automated_sender,
  get_sender_history: context.get_sender_history,
  // text helpers
  html_to_text: text_clean.html_to_text,
  strip_quoted_history: text_clean.strip_quoted_history
};

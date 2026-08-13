'use strict';
// Salesforce read layer for the email-queue module. Domain reads (queues, threads, sender history) on
// top of the shared services/salesforce client + services/text_clean helpers. Connection is injected.
const sfsvc = require('../../../services/salesforce');
const text_clean = require('../../../services/text_clean');
const queues = require('./sf_queues');
const threads = require('./sf_threads');
const context = require('./sf_context');
const send = require('./sf_send');

module.exports = {
  // shared plumbing (re-exported for convenience)
  connect: sfsvc.connect,
  run_soql: sfsvc.run_soql,
  describe_object: sfsvc.describe_object,
  fetch_content_version_bytes: sfsvc.fetch_content_version_bytes,
  datetime_in_time_zone: sfsvc.datetime_in_time_zone,
  ymd_in_time_zone: sfsvc.ymd_in_time_zone,
  DEFAULT_TZ: sfsvc.DEFAULT_TZ,
  // domain reads
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
  // outbound (write)
  send_case_email: send.send_case_email,
  send_case_email_apex: send.send_case_email_apex,
  resolve_owe_id: send.resolve_owe_id,
  // text helpers
  html_to_text: text_clean.html_to_text,
  strip_quoted_history: text_clean.strip_quoted_history
};

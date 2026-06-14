'use strict';
// Download one Slack file's bytes into MEMORY (a Buffer). Never writes to disk — the server streams it
// straight to the browser. Slack private files require the bot token in an Authorization: Bearer header;
// if the bot isn't in the channel (or the token/scope is wrong) Slack returns an HTML login page instead
// of bytes, so we guard against that with a clear error.

async function fetch_file_bytes(conn, file_id) {
  // files.info gives the current url_private_download for this file.
  const info = await conn.call('files.info', { file: file_id });
  const file = (info && info.file) || {};
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error('Slack file ' + file_id + ' has no downloadable URL (is it a hosted/Google file?)');

  const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + conn.token } });
  if (!response.ok) {
    const text = await response.text().catch(function () { return ''; });
    throw new Error('Slack download failed for ' + file_id + ' (HTTP ' + response.status + '): ' + text.slice(0, 200));
  }
  // A text/html body means Slack served a sign-in page, not the file — almost always "bot not in the
  // channel" or a bad/under-scoped token.
  const content_type = String(response.headers.get('content-type') || '');
  if (/text\/html/i.test(content_type)) {
    throw new Error('Slack returned a login page instead of the file — confirm the bot is in that channel and the token has files:read.');
  }
  const array_buffer = await response.arrayBuffer();
  return Buffer.from(array_buffer);
}

module.exports = { fetch_file_bytes };

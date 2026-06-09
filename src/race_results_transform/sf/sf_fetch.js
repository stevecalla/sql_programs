'use strict';
// Download one ContentVersion's bytes into MEMORY (a Buffer). Never writes to disk — the server
// streams it straight to the browser, which saves it to the user's chosen folder. No persistence.

async function fetch_content_version_bytes(conn, content_version_id) {
  const url = conn.instanceUrl + '/services/data/v' + conn.version +
    '/sobjects/ContentVersion/' + content_version_id + '/VersionData';
  const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + conn.accessToken } });
  if (!response.ok) {
    const text = await response.text().catch(function () { return ''; });
    throw new Error('Salesforce download failed for ' + content_version_id + ' (HTTP ' + response.status + '): ' + text);
  }
  const array_buffer = await response.arrayBuffer();
  return Buffer.from(array_buffer);
}

module.exports = { fetch_content_version_bytes };

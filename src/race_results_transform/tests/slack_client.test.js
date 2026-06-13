'use strict';
// Slack client — unit tests with an INJECTED mock conn (no network). Covers channel listing,
// spreadsheet filtering / dedupe / newest-first, uploader resolution, and the normalized record shape.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const client = require('../slack/slack_client');

// Mock conn: dispatches conn.call(method, params) to canned responses; records the calls it received.
function make_mock(responses) {
  return {
    token: 'xoxb-test',
    api_base: 'https://slack.com/api',
    seen: [],
    call: function (method, params) {
      this.seen.push({ method: method, params: params });
      const r = responses[method];
      const value = typeof r === 'function' ? r(params) : r;
      if (value === undefined) return Promise.reject(new Error('unexpected method ' + method));
      return Promise.resolve(value);
    }
  };
}

const CHANNEL = 'C0TESTBOT';
const channel_info_ok = { channel: { id: CHANNEL, name: 'test_bot', is_private: true } };

describe('slack_client.auth_test', () => {
  test('returns the bot identity', async () => {
    const conn = make_mock({ 'auth.test': { ok: true, user: 'membershipsalesbot', user_id: 'U01', team: 'USA Triathlon' } });
    const id = await client.auth_test(conn);
    assert.equal(id.user, 'membershipsalesbot');
    assert.equal(id.user_id, 'U01');
  });
});

describe('slack_client.list_member_channels', () => {
  test('returns the bot channels (public + private), paginated + sorted by name', async () => {
    let page = 0;
    const conn = make_mock({
      'users.conversations': function () {
        page += 1;
        if (page === 1) {
          return { ok: true, channels: [{ id: 'C2', name: 'results', is_private: false }], response_metadata: { next_cursor: 'NEXT' } };
        }
        return { ok: true, channels: [{ id: 'C1', name: 'general', is_private: false }, { id: CHANNEL, name: 'test_bot', is_private: true }], response_metadata: { next_cursor: '' } };
      }
    });
    const channels = await client.list_member_channels(conn);
    assert.deepEqual(channels.map(function (c) { return c.name; }), ['general', 'results', 'test_bot']);
    const priv = channels.find(function (c) { return c.id === CHANNEL; });
    assert.equal(priv.is_private, true);
    // it followed the cursor (two pages)
    assert.equal(conn.seen.filter(function (s) { return s.method === 'users.conversations'; }).length, 2);
  });
});

describe('slack_client.list_channel_files', () => {
  function files_response() {
    return {
      ok: true,
      paging: { count: 200, total: 4, page: 1, pages: 1 },
      files: [
        { id: 'F_OLD', name: 'old_race.xlsx', filetype: 'xlsx', user: 'U_A', created: 1700000000, url_private_download: 'https://files.slack.com/old' },
        { id: 'F_NEW', name: 'new_race.csv', filetype: 'csv', user: 'U_B', created: 1700100000, url_private_download: 'https://files.slack.com/new' },
        { id: 'F_IMG', name: 'photo.png', filetype: 'png', user: 'U_A', created: 1700050000, url_private_download: 'https://files.slack.com/img' },
        { id: 'F_NEW', name: 'new_race.csv', filetype: 'csv', user: 'U_B', created: 1700100000, url_private_download: 'https://files.slack.com/new' }
      ]
    };
  }
  const users = {
    'users.info': function (params) {
      const map = { U_A: 'Tonia Wilson', U_B: 'Cathy Walker' };
      return { ok: true, user: { id: params.user, real_name: map[params.user] || '', name: 'x' } };
    }
  };

  test('filters to spreadsheets, dedupes, sorts newest-first, normalizes the record', async () => {
    const conn = make_mock(Object.assign({ 'files.list': files_response(), 'conversations.info': channel_info_ok }, users));
    const out = await client.list_channel_files(conn, { channel: CHANNEL, filter: { mode: 'all' } });

    // png dropped; duplicate F_NEW deduped -> 2 records
    assert.equal(out.length, 2);
    // newest first (F_NEW created later than F_OLD)
    assert.deepEqual(out.map(function (r) { return r.file_id; }), ['F_NEW', 'F_OLD']);
    // reuses content_version_id = slack file id so the shared UI works unchanged
    assert.equal(out[0].content_version_id, 'F_NEW');
    // uploader resolved + aliased to owner_name
    assert.equal(out[0].uploader_name, 'Cathy Walker');
    assert.equal(out[0].owner_name, 'Cathy Walker');
    // channel + extension + a built download name
    assert.equal(out[0].channel_id, CHANNEL);
    assert.equal(out[0].file_extension, 'csv');
    assert.match(out[0].target_name, /^test_bot_cathy_walker_new_race_f_new\.csv$/);
  });

  test('a channel-less call throws', async () => {
    const conn = make_mock({});
    await assert.rejects(function () { return client.list_channel_files(conn, { filter: { mode: 'all' } }); }, /channel id is required/);
  });

  test('empty file list returns []', async () => {
    const conn = make_mock({ 'files.list': { ok: true, paging: { pages: 1 }, files: [] }, 'conversations.info': channel_info_ok });
    const out = await client.list_channel_files(conn, { channel: CHANNEL, filter: { mode: 'all' } });
    assert.deepEqual(out, []);
  });
});

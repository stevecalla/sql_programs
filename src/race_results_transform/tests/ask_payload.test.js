'use strict';
// Guards the dashboard "ask" payload-size fix:
//   - the auth-gated ask routes get a LARGER JSON body than the deliberately-tight public
//     /api/event ingest (so a few turns of conversation context fit);
//   - oversized / malformed bodies return JSON, never Express's default HTML error page (which an
//     AJAX caller fails to JSON.parse -> "Unexpected token '<'");
//   - the dashboard caps REHYDRATED conversation answers the same way the live path does, so a
//     reloaded thread cannot bloat the POST past the limit.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(ROOT, 'metrics', 'metrics_dashboard.html'), 'utf8');

describe('ask payload guards', () => {
  test('dashboard caps BOTH the live and the rehydrated history answers to 400 chars', () => {
    // live path (ask_after) already capped; the reload/rehydrate path must match it or a reloaded
    // thread sends full prior answers and blows the JSON body limit.
    assert.match(dashboard, /answer: \(d\.answer \|\| ''\)\.slice\(0,\s*400\)/, 'live path caps answers to 400');
    assert.match(dashboard, /answer: \(t\.answer \|\| ''\)\.slice\(0,\s*400\)/, 'rehydrated path also caps answers to 400');
  });

  test('the visible transcript + "See N earlier" expander are independent of the capped history', () => {
    // the full-text transcript renders from ask_convo_add, NOT from ask_history, so capping the
    // context payload does not shorten what the user can read.
    assert.match(dashboard, /function ask_convo_add\b/, 'transcript bubbles render full answers');
    assert.match(dashboard, /ask-convo-more/, '"See N earlier" expander still present');
  });

  test('server: ask routes get a larger JSON limit, ingest stays tight, errors return JSON', () => {
    const server_path = path.join(ROOT, '..', '..', 'server_race_results_transform_8018.js');
    if (!fs.existsSync(server_path)) return;   // skip outside the monorepo
    const server = fs.readFileSync(server_path, 'utf8');
    assert.match(server, /\/api\/metrics-ask[\s\S]*?express\.json\(\{ limit: '512kb' \}\)/, 'ask routes get a 512kb JSON parser');
    assert.match(server, /express\.json\(\{ limit: '16kb' \}\)/, 'public /api/event ingest stays capped at 16kb');
    assert.match(server, /entity\.too\.large/, 'oversized body is handled');
    assert.match(server, /request too large/, 'oversized body returns a clean 413 JSON message');
    assert.match(server, /entity\.parse\.failed/, 'malformed JSON returns a 400 JSON message');
  });
});

'use strict';
// Tests for the rolling / sliding session (auth/session.js). No DB, no network — pure HMAC + timing.
// Covers: sign/verify round-trip, tamper rejection, IDLE expiry (ts older than MAX_AGE_MS), and the
// rolling refresh() that slides the expiry forward while a user is active but skips a re-issue when
// the token is still fresh (so we don't Set-Cookie on every request).
const test = require('node:test');
const assert = require('node:assert');
const session = require('../auth/session');

const SECRET = 'unit-test-secret';
function mkres() { const h = {}; return { setHeader: (k, v) => { h[k] = v; }, getHeader: (k) => h[k], _h: h }; }
function cookieToken(setCookie) { return String(setCookie).split(';')[0].split('=').slice(1).join('='); }

test('sign/verify round-trips a valid, fresh session', () => {
  const t = session.sign({ user: 'skip', role: 'admin', ts: Date.now() }, SECRET);
  const p = session.verify(t, SECRET);
  assert.ok(p, 'verifies');
  assert.strictEqual(p.user, 'skip');
  assert.strictEqual(p.role, 'admin');
});

test('verify rejects a tampered payload', () => {
  const t = session.sign({ user: 'skip', role: 'user', ts: Date.now() }, SECRET);
  const body = t.split('.')[0];
  const forged = Buffer.from(JSON.stringify({ user: 'skip', role: 'admin', ts: Date.now() })).toString('base64url');
  assert.strictEqual(session.verify(forged + '.' + t.split('.')[1], SECRET), null, 'swapped body fails MAC');
  assert.strictEqual(session.verify(body + '.deadbeef', SECRET), null, 'bad MAC fails');
});

test('verify expires an idle session (ts older than MAX_AGE_MS)', () => {
  const stale = session.sign({ user: 'skip', role: 'user', ts: Date.now() - session.MAX_AGE_MS - 1000 }, SECRET);
  assert.strictEqual(session.verify(stale, SECRET), null, 'expired past the idle window');
  const edge = session.sign({ user: 'skip', role: 'user', ts: Date.now() - session.MAX_AGE_MS + 60000 }, SECRET);
  assert.ok(session.verify(edge, SECRET), 'still valid just inside the window');
});

test('refresh() is a no-op while the token is still fresh', () => {
  const res = mkres();
  session.refresh(res, { user: 'skip', role: 'admin', ts: Date.now() }, SECRET);
  assert.strictEqual(res.getHeader('Set-Cookie'), undefined, 'no re-issue within REFRESH_AFTER_MS');
});

test('refresh() slides the expiry forward once the token is older than REFRESH_AFTER_MS', () => {
  const res = mkres();
  const oldTs = Date.now() - session.REFRESH_AFTER_MS - 1000;
  session.refresh(res, { user: 'skip', role: 'admin', ts: oldTs }, SECRET);
  const sc = res.getHeader('Set-Cookie');
  assert.ok(sc && /usat_apps_session=/.test(sc), 'a fresh cookie is issued');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Path=\//);
  assert.match(sc, new RegExp('Max-Age=' + Math.floor(session.MAX_AGE_MS / 1000) + '\\b'), 'full idle window');
  const p = session.verify(cookieToken(sc), SECRET);
  assert.ok(p && (Date.now() - p.ts) < 2000, 'ts slid forward to ~now');
});

test('refresh() does not clobber a Set-Cookie the route already set (login/logout)', () => {
  const res = mkres();
  res.setHeader('Set-Cookie', 'usat_apps_session=preset; Path=/');
  session.refresh(res, { user: 'skip', role: 'admin', ts: Date.now() - session.REFRESH_AFTER_MS - 1000 }, SECRET);
  assert.match(String(res.getHeader('Set-Cookie')), /preset/, 'leaves the existing cookie alone');
});

test('issue() sets a verifiable cookie; clear() expires it', () => {
  const r1 = mkres(); session.issue(r1, 'skip', 'admin', SECRET);
  const p = session.verify(cookieToken(r1.getHeader('Set-Cookie')), SECRET);
  assert.ok(p && p.user === 'skip' && p.role === 'admin');
  const r2 = mkres(); session.clear(r2);
  assert.match(String(r2.getHeader('Set-Cookie')), /Max-Age=0/, 'logout expires the cookie');
});

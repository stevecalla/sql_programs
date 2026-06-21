/* Generic analytics core (browser). Served as a static asset; any page can load
 * it and call UsageMetrics.init({ app, endpoint, allowList }). Sends events via
 * navigator.sendBeacon (non-blocking, fire-and-forget). Counts/enums only — the
 * allow-list is the second line of defense against leaking any value. Honors
 * Do-Not-Track and a global METRICS_OFF flag. */
(function (global) {
  'use strict';
  var cfg = { app: 'app', endpoint: '/api/event', allowList: [], baseProps: {} };
  var ids = {};
  var ALWAYS = ['app', 'event_name', 'page_path', 'visitor_id', 'session_id', 'is_returning', 'upload_id',
    'client_tz', 'local_hour', 'local_dow', 'event_at_local', 'viewport', 'theme'];

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
    });
  }
  function ls_get(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function ls_set(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function ss_get(k) { try { return global.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ss_set(k, v) { try { global.sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function ck_get(k) {
    try { var m = (global.document && global.document.cookie || '').match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
    catch (e) { return null; }
  }
  function ck_set(k, v) {
    try { global.document.cookie = k + '=' + encodeURIComponent(v) + '; Max-Age=' + (60 * 60 * 24 * 730) + '; Path=/; SameSite=Lax'; }
    catch (e) { /* no document */ }
  }
  function dnt() {
    var v = global.navigator && (global.navigator.doNotTrack || global.doNotTrack);
    return v === '1' || v === 'yes';
  }
  function automated() {
    try { return !!(global.navigator && global.navigator.webdriver) && !global.METRICS_TEST_ALLOW; }
    catch (e) { return false; }
  }
  function off() { return !!global.METRICS_OFF || dnt() || automated(); }

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmt_local(d) {
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' +
      two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  function base_props() {
    var d = new Date();
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* old browser */ }
    return {
      app: cfg.app, visitor_id: ids.visitor_id, session_id: ids.session_id,
      is_returning: ids.is_returning, upload_id: ids.upload_id || null,
      client_tz: tz, local_hour: d.getHours(), local_dow: d.getDay(), event_at_local: fmt_local(d),
      file_name: ids.file_name || null,
      page_path: (global.location ? (global.location.pathname + global.location.search).slice(0, 255) : null),
      viewport: (global.innerWidth && global.innerWidth < 768) ? 'mobile' : 'desktop',
      theme: (global.document && document.documentElement.getAttribute('data-theme')) || 'auto'
    };
  }
  function init(opts) {
    opts = opts || {};
    cfg.app = opts.app || cfg.app;
    cfg.endpoint = opts.endpoint || cfg.endpoint;
    cfg.allowList = opts.allowList || [];
    cfg.baseProps = opts.baseProps || {};   // props merged into EVERY event (e.g. a per-session is_test flag)
    if (off()) return;
    // Durable anonymous id: prefer cookie, then localStorage, else mint. Persist to BOTH
    // so the id survives if either store is cleared (cookie also lasts ~2 years).
    var vid = ck_get('um_visitor_id') || ls_get('um_visitor_id');
    ids.is_returning = vid ? 1 : 0;
    if (!vid) vid = uuid();
    ls_set('um_visitor_id', vid);
    ck_set('um_visitor_id', vid);
    ids.visitor_id = vid;
    // session_id = ONE sign-in/sitting: persisted in sessionStorage so it stays stable across page
    // navigations (app -> /metrics -> /admin) and tab refreshes, but resets on a new tab or new login.
    // (visitor_id above is the durable cross-time id; session_id groups a single visit.)
    var sid = ss_get('um_session_id');
    if (!sid) { sid = uuid(); ss_set('um_session_id', sid); }
    ids.session_id = sid;
    // Auto-fire the page_view on init unless the caller opts out (opts.autoPageView === false). Apps
    // that gate behind a login can defer the visit until after auth so it carries the user/actor.
    if (opts.autoPageView !== false) track('page_view', {});
  }
  function new_upload() { ids.upload_id = uuid(); return ids.upload_id; }
  // Start a fresh session id (e.g. call this on sign-in so each login is a distinct session even within
  // the same tab). Persists to sessionStorage so it stays stable across this login's page navigations.
  function new_session() { var s = uuid(); ids.session_id = s; ss_set('um_session_id', s); return s; }
  function track(event_name, props) {
    if (off()) return;
    if (props && props.file_name) ids.file_name = props.file_name;   // remember for later events
    var merged = {}, src = base_props(), k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) merged[k] = src[k];
    for (k in cfg.baseProps) if (Object.prototype.hasOwnProperty.call(cfg.baseProps, k)) merged[k] = cfg.baseProps[k];
    if (props) for (k in props) if (Object.prototype.hasOwnProperty.call(props, k)) merged[k] = props[k];
    var payload = {};
    Object.keys(merged).forEach(function (key) {
      if (ALWAYS.indexOf(key) >= 0 || cfg.allowList.indexOf(key) >= 0) payload[key] = merged[key];
    });
    payload.event_name = event_name;
    send(payload);
  }
  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      if (global.navigator && global.navigator.sendBeacon) {
        global.navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: 'application/json' }));
      } else if (global.fetch) {
        global.fetch(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      }
    } catch (e) { /* never throw from analytics */ }
  }
  global.UsageMetrics = { init: init, track: track, new_upload: new_upload, new_session: new_session,
    ids: function () { return { visitor_id: ids.visitor_id || null, session_id: ids.session_id || null }; },
    // Full client env (ids + tz/local time/viewport/theme/page) so server-logged events (ai_call,
    // send, status) can carry the SAME metadata as browser events.
    meta: function () { try { return base_props(); } catch (e) { return {}; } } };
})(typeof window !== 'undefined' ? window : this);

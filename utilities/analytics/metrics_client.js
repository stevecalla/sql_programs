/* Generic analytics core (browser). Served as a static asset; any page can load
 * it and call UsageMetrics.init({ app, endpoint, allowList }). Sends events via
 * navigator.sendBeacon (non-blocking, fire-and-forget). Counts/enums only — the
 * allow-list is the second line of defense against leaking any value. Honors
 * Do-Not-Track and a global METRICS_OFF flag. */
(function (global) {
  'use strict';
  var cfg = { app: 'app', endpoint: '/api/event', allowList: [] };
  var ids = {};
  var ALWAYS = ['app', 'visitor_id', 'session_id', 'is_returning', 'upload_id',
    'client_tz', 'local_hour', 'local_dow', 'event_at_local', 'viewport', 'theme', 'event_name'];

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
    });
  }
  function ls_get(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function ls_set(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function dnt() {
    var v = global.navigator && (global.navigator.doNotTrack || global.doNotTrack);
    return v === '1' || v === 'yes';
  }
  function off() { return !!global.METRICS_OFF || dnt(); }

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
      viewport: (global.innerWidth && global.innerWidth < 768) ? 'mobile' : 'desktop',
      theme: (global.document && document.documentElement.getAttribute('data-theme')) || 'auto'
    };
  }
  function init(opts) {
    opts = opts || {};
    cfg.app = opts.app || cfg.app;
    cfg.endpoint = opts.endpoint || cfg.endpoint;
    cfg.allowList = opts.allowList || [];
    if (off()) return;
    var vid = ls_get('um_visitor_id');
    ids.is_returning = vid ? 1 : 0;
    if (!vid) { vid = uuid(); ls_set('um_visitor_id', vid); }
    ids.visitor_id = vid;
    ids.session_id = uuid();
    track('page_view', {});
  }
  function new_upload() { ids.upload_id = uuid(); return ids.upload_id; }
  function track(event_name, props) {
    if (off()) return;
    var merged = {}, src = base_props(), k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) merged[k] = src[k];
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
  global.UsageMetrics = { init: init, track: track, new_upload: new_upload };
})(typeof window !== 'undefined' ? window : this);

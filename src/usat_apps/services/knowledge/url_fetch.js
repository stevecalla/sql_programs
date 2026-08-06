'use strict';
// url_fetch.js — fetch an allow-listed URL, extract readable text (headings preserved), chunk it, and
// store the chunks + a raw snapshot. Plain HTTP by default; Playwright is only an OPTIONAL render fallback
// for JS-heavy pages (scaffolded — see render_with_playwright). Safety: allowlist + SSRF guard (DNS resolve
// then re-check every address), http(s) only, manual redirect re-validation, content-type + size caps.
//
// ASSUMPTION (logged in the plan): Node global fetch is available on the prod server (Node 18+); if not,
// swap the one fetch() call for the https module. Playwright render is stubbed to null for now — the plain
// path works; JS-only pages are flagged needs_js so an operator sees why a page came back thin.
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const data_dir = require('./data_dir');
const chunker = require('./chunk');
const store = require('./chunk_store');
const safety = require('./url_safety');

const MAX_BYTES = 3 * 1024 * 1024;     // per-page download cap
const MAX_CHARS = 400 * 1000;          // extracted-text cap before chunking
const THIN_CHARS = 200;                // below this, flag needs_js (likely JS-rendered)
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const DEFAULT_ALLOWLIST = ['usatriathlon.org'];

// ---- allowlist (persisted in the shared config.json) ----
function get_allowlist() {
  const cfg = data_dir.read_config() || {};
  const list = Array.isArray(cfg.knowledge_allowlist) ? cfg.knowledge_allowlist.filter(Boolean) : null;
  return (list && list.length) ? list : DEFAULT_ALLOWLIST.slice();
}
function set_allowlist(hosts) {
  const clean = Array.from(new Set((hosts || []).map(function (h) {
    return String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+|\.+$/g, '');
  }).filter(Boolean)));
  const cfg = data_dir.read_config() || {};
  cfg.knowledge_allowlist = clean;
  data_dir.write_config(cfg);
  return clean;
}

// ---- HTML -> text with H1/H3 preserved as markdown so the chunker can see structure ----
function html_to_headings(html) {
  let s = String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, function (m, t) { return '\n# ' + strip(t) + '\n'; })
       .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, function (m, t) { return '\n## ' + strip(t) + '\n'; })
       .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, function (m, t) { return '\n### ' + strip(t) + '\n'; });
  s = s.replace(/<li[^>]*>/gi, '\n• ').replace(/<\/(p|div|tr|section|article|ul|ol|table|h[4-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
       .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
  return s.split('\n').map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function strip(t) { return String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

async function assert_public(host) {
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (e) { throw new Error('Could not resolve host.'); }
  for (let i = 0; i < addrs.length; i++) {
    if (safety.is_private_ip(addrs[i].address)) throw new Error('Host resolves to a private/internal address — blocked.');
  }
}

// Fetch text with manual redirect re-validation (each hop re-checked against allowlist + SSRF).
async function fetch_text(rawUrl, allowlist) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const chk = safety.check_url(current, allowlist);
    if (!chk.ok) throw new Error(chk.reason);
    await assert_public(chk.host);
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    let res;
    try { res = await fetch(current, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'usat-apps-knowledge-bot/1.0', 'accept': 'text/html,text/plain' } }); }
    finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Redirect without a Location header.');
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) throw new Error('Unsupported content-type: ' + (ct || 'unknown'));
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_BYTES) throw new Error('Page too large (' + len + ' bytes).');
    const body = await res.text();
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_BYTES) throw new Error('Page too large (' + bytes + ' bytes).');
    const isHtml = /text\/html|application\/xhtml/.test(ct);
    let text = isHtml ? html_to_headings(body) : body.trim();
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
    return { url: current, host: chk.host, text: text, bytes: bytes, content_type: ct };
  }
  throw new Error('Too many redirects.');
}

// OPTIONAL Playwright render fallback (scaffold). Returns null today; wired later after real JS-page testing.
async function render_with_playwright(/* url */) { return null; }

function snapshot_path_for(source_ref) {
  const dir = path.join(data_dir.base_sync(), 'knowledge_snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(source_ref).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'src';
  return path.join(dir, safe + '.txt');
}
function title_from(text, url) {
  const h = /(^|\n)#\s+(.+)/.exec(text || '');
  if (h) return h[2].trim().slice(0, 200);
  try { return new URL(url).hostname + new URL(url).pathname; } catch (e) { return String(url).slice(0, 200); }
}

// Add or refresh one URL source. opts: { scope:'global'|'queue', queue, added_by, needs_js }
// Returns { ok, source_ref, title, chunks, needs_js } or { ok:false, reason }.
async function add_or_refresh(rawUrl, opts) {
  const o = opts || {};
  const allowlist = get_allowlist();
  const pre = safety.check_url(rawUrl, allowlist);
  if (!pre.ok) return { ok: false, reason: pre.reason };
  const source_ref = pre.url.toString();
  let got;
  try {
    got = await fetch_text(source_ref, allowlist);
    if ((!got.text || got.text.length < THIN_CHARS) && (o.needs_js || false)) {
      const rendered = await render_with_playwright(source_ref);
      if (rendered && rendered.length > got.text.length) got.text = rendered;
    }
  } catch (e) {
    await store.upsert_source({ source_ref: source_ref, source_type: 'url', scope: o.scope, queue: o.queue, status: 'error', error: String(e.message || e), added_by: o.added_by, chunk_count: 0, fetched: true });
    return { ok: false, reason: String(e.message || e), source_ref: source_ref };
  }
  const thin = !got.text || got.text.length < THIN_CHARS;
  const title = title_from(got.text, source_ref);
  const meta = { source_ref: source_ref, source_type: 'url', source_title: title, scope: o.scope, queue: o.queue };
  const chunks = chunker.chunk(got.text, meta);
  try { fs.writeFileSync(snapshot_path_for(source_ref), '# SOURCE: ' + source_ref + '\n# FETCHED: ' + new Date().toISOString() + '\n\n' + got.text); } catch (e) { /* snapshot best-effort */ }
  const snap = snapshot_path_for(source_ref);
  await store.replace_source_chunks(meta, chunks);
  await store.upsert_source({
    source_ref: source_ref, source_type: 'url', source_title: title, scope: o.scope, queue: o.queue,
    status: thin ? 'thin' : 'ok', error: thin ? 'Fetched very little text — the page may be JavaScript-rendered (set needs_js).' : null,
    needs_js: thin ? 1 : (o.needs_js ? 1 : 0), chunk_count: chunks.length, bytes: got.bytes, added_by: o.added_by,
    snapshot_path: snap, fetched: true,
  });
  return { ok: true, source_ref: source_ref, title: title, chunks: chunks.length, needs_js: thin ? true : !!o.needs_js };
}

// Re-fetch every URL source (the cron/refresh-all entry point). Returns a per-source result list.
async function refresh_all() {
  await store.ensure();
  // Pull every URL source (globals + queue-scoped) directly and re-fetch each.
  const all = await require('../../store/db').query(
    'SELECT source_ref, scope, queue, needs_js, added_by FROM ' + store.SOURCES + " WHERE source_type = 'url'");
  const results = [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const r = await add_or_refresh(s.source_ref, { scope: s.scope, queue: s.queue, added_by: s.added_by, needs_js: !!s.needs_js });
    results.push({ source_ref: s.source_ref, ok: r.ok, chunks: r.chunks || 0, reason: r.reason || '' });
  }
  return results;
}

module.exports = {
  get_allowlist, set_allowlist, add_or_refresh, refresh_all, html_to_headings,
  MAX_BYTES, MAX_CHARS, THIN_CHARS,
};

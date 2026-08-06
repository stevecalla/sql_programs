'use strict';
// url_safety.js — pure guards for the URL-context fetcher. No I/O, so it unit-tests standalone.
//   check_url(raw, allowlist) -> { ok, url, host, reason }   (protocol + allowlist)
//   is_private_ip(ip)         -> bool                         (SSRF: block internal targets)
//   host_allowed(host, list)  -> bool                         (apex + subdomain match)
// url_fetch.js does the DNS resolve then calls is_private_ip on each resolved address before fetching.

function host_allowed(host, allowlist) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const list = (allowlist || []).map(function (x) { return String(x || '').toLowerCase().replace(/^\.+|\.+$/g, ''); }).filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (h === a || h.endsWith('.' + a)) return true;   // apex or any subdomain of an allowlisted host
  }
  return false;
}

function is_private_ip(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (!s) return true;
  // IPv6
  if (s.indexOf(':') >= 0) {
    if (s === '::1' || s === '::') return true;                 // loopback / unspecified
    if (s.startsWith('fe80')) return true;                      // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true;  // unique-local fc00::/7
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);          // IPv4-mapped
    if (m) return is_private_ip(m[1]);
    return false;
  }
  // IPv4
  const p = s.split('.').map(function (x) { return parseInt(x, 10); });
  if (p.length !== 4 || p.some(function (x) { return isNaN(x) || x < 0 || x > 255; })) return true; // malformed → treat unsafe
  const a = p[0], b = p[1];
  if (a === 0 || a === 10 || a === 127) return true;            // this-net / private / loopback
  if (a === 169 && b === 254) return true;                      // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;             // private
  if (a === 192 && b === 168) return true;                      // private
  if (a === 100 && b >= 64 && b <= 127) return true;            // carrier-grade NAT 100.64/10
  if (a >= 224) return true;                                    // multicast / reserved
  return false;
}

function check_url(raw, allowlist) {
  let url;
  try { url = new URL(String(raw || '')); } catch (e) { return { ok: false, reason: 'Not a valid URL.' }; }
  const proto = url.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') return { ok: false, url: url, host: url.hostname, reason: 'Only http and https URLs are allowed.' };
  if (!host_allowed(url.hostname, allowlist)) return { ok: false, url: url, host: url.hostname, reason: 'Host "' + url.hostname + '" is not on the allowlist.' };
  return { ok: true, url: url, host: url.hostname.toLowerCase(), reason: '' };
}

module.exports = { host_allowed: host_allowed, is_private_ip: is_private_ip, check_url: check_url };

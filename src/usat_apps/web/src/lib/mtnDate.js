// Shared MTN (America/Denver) timestamp formatter — one place so the SF API panel and the metrics
// reports render dates identically: weekday, month + day, year, 12-hour AM/PM (e.g. "Mon, Jul 13,
// 2026 · 4:52 PM"). tz-safe: the input is a Denver wall-clock string, so we parse its parts and derive
// the weekday via Date.UTC — never new Date(str), which would reinterpret it in the browser's zone.
// Accepts the raw sortable form ('YYYY-MM-DD HH:mm:ss') and the legacy report/display forms
// ('YYYY-MM-DD h:mm AM/PM', 'Jul 13, 2026 4:52 PM') so every surface normalizes to the same string.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOI = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function to24(h, ap) {
  h = +h;
  if (!ap) return h;
  const a = String(ap).toUpperCase();
  if (a === 'PM' && h < 12) return h + 12;
  if (a === 'AM' && h === 12) return 0;
  return h;
}
function build(Y, Mo, D, H, Mi) {
  const wd = WD[new Date(Date.UTC(Y, Mo - 1, D)).getUTCDay()];
  const h12 = (H % 12) || 12;
  const ap = H < 12 ? 'AM' : 'PM';
  return wd + ', ' + MO[Mo - 1] + ' ' + D + ', ' + Y + ' · ' + h12 + ':' + String(Mi).padStart(2, '0') + ' ' + ap;
}

export function formatMtn(raw) {
  if (raw == null || raw === '') return '—';
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (m) return build(+m[1], +m[2], +m[3], to24(m[4], m[6]), +m[5]);
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    const mo = MOI[m[1].slice(0, 3).toLowerCase()];
    if (mo) return build(+m[3], mo, +m[2], to24(m[4], m[6]), +m[5]);
  }
  return s;
}

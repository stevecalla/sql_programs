// Light/dark theming, mirroring the merge app's scheme: a localStorage choice
// ('dark' | 'light' | absent = follow the OS), applied as data-theme on <html>.
const KEY = 'reporting_theme';

function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

export function effective_dark() {
  const t = stored();
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export function apply_theme() {
  const t = stored();
  const r = document.documentElement;
  if (t === 'dark' || t === 'light') r.setAttribute('data-theme', t);
  else r.removeAttribute('data-theme');
}

export function toggle_theme() {
  const d = effective_dark();
  try { localStorage.setItem(KEY, d ? 'light' : 'dark'); } catch (e) { /* ignore */ }
  apply_theme();
}

export function watch_system(cb) {
  if (window.matchMedia) {
    try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb); } catch (e) { /* ignore */ }
  }
}

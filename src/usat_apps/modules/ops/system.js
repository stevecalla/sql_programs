'use strict';
// Ops · System health — host stats (CPU/mem/swap/disk/PSI/temps), daily summary + ubuntu update log,
// allow-listed live commands, disk-usage explorer, and crontab view/guarded-edit. Ported from the
// proxy's /api/system* handlers. Admin-only. Linux-oriented; /proc & /sys reads degrade gracefully.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { require_admin } = require('../../auth/require_auth');

function fmtGB(bytes) { if (bytes == null) return '—'; return (bytes / 1073741824).toFixed(1) + ' GiB'; }

function build_system() {
  const out = { ok: true, host: os.hostname(), now_mtn: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }), uptime_sec: Math.round(os.uptime()) };
  const la = os.loadavg(); const cores = os.cpus().length;
  out.cpu = { load1: +la[0].toFixed(2), load5: +la[1].toFixed(2), load15: +la[2].toFixed(2), cores: cores, util_pct: +((la[0] / cores) * 100).toFixed(1) };
  try {
    const kv = {}; fs.readFileSync('/proc/meminfo', 'utf8').split('\n').forEach((l) => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) kv[m[1]] = Number(m[2]) * 1024; });
    const total = kv.MemTotal, avail = (kv.MemAvailable != null ? kv.MemAvailable : kv.MemFree);
    out.memory = { total, available: avail, used: total - avail, used_pct: +(100 * (total - avail) / total).toFixed(1) };
    if (kv.SwapTotal) out.swap = { total: kv.SwapTotal, free: kv.SwapFree, used: kv.SwapTotal - kv.SwapFree, used_pct: +(100 * (kv.SwapTotal - kv.SwapFree) / kv.SwapTotal).toFixed(1) };
  } catch (e) { const t = os.totalmem(), f = os.freemem(); out.memory = { total: t, available: f, used: t - f, used_pct: +(100 * (t - f) / t).toFixed(1) }; }
  const psi = (file) => { try { const t = fs.readFileSync(file, 'utf8'); const s = (t.match(/some [^\n]*avg10=([\d.]+)/) || [])[1]; const fu = (t.match(/full [^\n]*avg10=([\d.]+)/) || [])[1]; return { some: s != null ? Number(s) : null, full: fu != null ? Number(fu) : null }; } catch (e) { return null; } };
  out.psi = { memory: psi('/proc/pressure/memory'), cpu: psi('/proc/pressure/cpu'), io: psi('/proc/pressure/io') };
  try { const base = '/sys/class/thermal'; const temps = {}; fs.readdirSync(base).filter((d) => d.indexOf('thermal_zone') === 0).forEach((z) => { try { const type = fs.readFileSync(base + '/' + z + '/type', 'utf8').trim(); const t = Number(fs.readFileSync(base + '/' + z + '/temp', 'utf8').trim()) / 1000; if (!isNaN(t)) temps[type] = +t.toFixed(1); } catch (e) { /* skip zone */ } }); out.temps = temps; } catch (e) { out.temps = {}; }
  try {
    const st = fs.statfsSync ? fs.statfsSync('/') : null;
    if (st) { const bs = st.bsize; const total = st.blocks * bs; const avail = st.bavail * bs; const used = (st.blocks - st.bfree) * bs; const denom = used + avail || total; out.disk = { total, avail, free: avail, used, used_pct: +(100 * used / denom).toFixed(1) }; }
  } catch (e) { /* no statfs */ }
  const tailText = (fp, max) => { try { const st = fs.statSync(fp); const start = Math.max(0, st.size - (max || 16000)); const len = st.size - start; const fd = fs.openSync(fp, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, start); fs.closeSync(fd); return { text: b.toString('utf8'), mtime: st.mtime.toISOString() }; } catch (e) { return null; } };
  try {
    const cands = [process.env.HEALTH_SUMMARY_FILE, path.join(RUN_DIR, 'utilities', 'cron_system_metrics', 'latest_summary.txt'), path.join(RUN_DIR, 'utilities', 'cron_system_metrics', 'system_metrics.log')].filter(Boolean);
    for (const fp of cands) { if (fs.existsSync(fp)) { const r = tailText(fp, 8000); if (r) { out.summary = { path: fp, mtime: r.mtime, text: r.text }; break; } } }
  } catch (e) { /* no summary */ }
  try { const fp = process.env.UBUNTU_UPDATE_LOG || path.join(RUN_DIR, 'utilities', 'cron_update_ubuntu', 'ubuntu-update.log'); if (fs.existsSync(fp)) { const r = tailText(fp, 8000); if (r) out.ubuntu = { path: fp, mtime: r.mtime, text: r.text }; } } catch (e) { /* none */ }
  return out;
}

const RUN_DIR = path.join(__dirname, '..', '..', '..', '..');  // repo root

// Allow-listed read-only snapshots (htop-style). Full-screen TUIs can't render in a web panel.
const SYS_CMDS = {
  top: { label: 'top', bin: 'top', argv: ['-b', '-n', '1'] },
  htop: { label: 'htop', interactive: true, note: 'Interactive TUI — run in a terminal.' },
  btop: { label: 'btop', interactive: true, note: 'Interactive TUI — run in a terminal.' },
  atop: { label: 'atop', bin: 'atop', argv: ['1', '1'] },
  glances: { label: 'glances', bin: 'glances', argv: ['--stdout-csv', 'cpu,mem,load,uptime', '-t', '1', '--stop-after', '1'] },
  nmon: { label: 'nmon', interactive: true, note: 'Interactive TUI — run in a terminal.' },
  processes: { label: 'processes', bin: 'bash', argv: ['-lc', 'ps -eo pid,ppid,%cpu,%mem,rss,comm --sort=-%cpu | head -n 30'] },
  free: { label: 'free -h', bin: 'free', argv: ['-h'] },
  disk: { label: 'df -h', bin: 'df', argv: ['-h'] },
  vmstat: { label: 'vmstat', bin: 'vmstat', argv: ['1', '2'] },
  uptime: { label: 'uptime', bin: 'uptime', argv: [] },
  sensors: { label: 'sensors', bin: 'sensors', argv: [] },
  pm2: { label: 'pm2 list', bin: 'pm2', argv: ['list'] },
};
const DU_PATHS = ['/', '/var', '/var/lib', '/var/lib/mysql', '/var/log', '/var/cache', '/var/lib/docker', '/home', '/usr', '/snap', '/tmp'];

function mount(app) {
  app.get('/api/ops/system', require_admin, function (req, res) { try { res.json(build_system()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  app.get('/api/ops/system/cmds', require_admin, function (req, res) {
    res.json({ ok: true, cmds: Object.keys(SYS_CMDS).map((id) => ({ id, label: SYS_CMDS[id].label, interactive: !!SYS_CMDS[id].interactive })) });
  });
  app.get('/api/ops/system/cmd', require_admin, function (req, res) {
    const c = SYS_CMDS[String(req.query.name || '')]; if (!c) return res.status(400).json({ ok: false, error: 'unknown command' });
    if (c.interactive) return res.json({ ok: true, name: req.query.name, label: c.label, output: c.label + ' is a full-screen terminal app — run it in a terminal/SSH session.\n\n' + (c.note || ''), time: new Date().toISOString() });
    let out = ''; let proc;
    try { proc = spawn(c.bin, c.argv, { shell: false, windowsHide: true }); }
    catch (e) { return res.status(500).json({ ok: false, error: c.bin + ' not available', detail: e.message }); }
    const cap = () => { if (out.length > 60000) { out = out.slice(0, 60000) + '\n…(truncated)'; try { proc.kill(); } catch (e) { /* noop */ } } };
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* noop */ } }, 8000);
    proc.stdout.on('data', (d) => { out += d.toString(); cap(); });
    proc.stderr.on('data', (d) => { out += d.toString(); cap(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: c.bin + ': ' + e.message, output: out }); });
    proc.on('close', () => { clearTimeout(timer); res.json({ ok: true, name: req.query.name, label: c.label, output: out || '(no output)', time: new Date().toISOString() }); });
  });

  app.get('/api/ops/system/du-paths', require_admin, function (req, res) { res.json({ ok: true, paths: DU_PATHS }); });
  app.get('/api/ops/system/du', require_admin, function (req, res) {
    const p = String(req.query.path || '');
    if (p === 'journal') {
      let out = ''; let proc;
      try { proc = spawn('journalctl', ['--disk-usage'], { shell: false, windowsHide: true }); } catch (e) { return res.json({ ok: false, error: e.message }); }
      const t = setTimeout(() => { try { proc.kill(); } catch (e) { /* noop */ } }, 8000);
      proc.stdout.on('data', (d) => { out += d.toString(); }); proc.stderr.on('data', (d) => { out += d.toString(); });
      proc.on('error', (e) => { clearTimeout(t); res.json({ ok: false, error: e.message }); });
      proc.on('close', () => { clearTimeout(t); res.json({ ok: true, path: 'journal', output: out.trim() || '(no output)', time: new Date().toISOString() }); });
      return;
    }
    if (DU_PATHS.indexOf(p) < 0) return res.status(400).json({ ok: false, error: 'path not allowed' });
    let out = ''; let proc;
    try { proc = spawn('bash', ['-lc', 'du -h --max-depth=1 ' + p + ' 2>/dev/null | sort -h'], { shell: false, windowsHide: true }); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* noop */ } }, 60000);
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: e.message }); });
    proc.on('close', () => { clearTimeout(timer); res.json({ ok: true, path: p, output: out.trim() || '(no readable entries — protected dirs need sudo; run in a terminal for exact numbers)', time: new Date().toISOString() }); });
  });

  // Crontab view (read-only)
  app.get('/api/ops/system/cron', require_admin, function (req, res) {
    let out = '', err = '', proc;
    try { proc = spawn('crontab', ['-l'], { shell: false, windowsHide: true }); } catch (e) { return res.json({ ok: false, error: 'crontab not available', detail: e.message }); }
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* noop */ } }, 6000);
    proc.stdout.on('data', (d) => { out += d.toString(); }); proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); res.json({ ok: false, error: e.message }); });
    proc.on('close', (code) => { clearTimeout(timer); res.json({ ok: true, user: (os.userInfo && os.userInfo().username) || '', crontab: (out.trim() || ('(no crontab installed)' + (err ? '\n' + err.trim() : ''))), code, time: new Date().toISOString() }); });
  });
  // Crontab write (guarded): validate every line, back up the current crontab, then install via `crontab -`.
  app.post('/api/ops/system/cron', require_admin, function (req, res) {
    const content = String((req.body && req.body.crontab) != null ? req.body.crontab : '');
    if (!content.trim()) return res.status(400).json({ ok: false, error: 'refusing to write an empty crontab' });
    const bad = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => {
      if (l[0] === '#') return false;
      if (/^@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)\s+\S/.test(l)) return false;
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) return false;
      return l.split(/\s+/).length < 6;
    });
    if (bad.length) return res.status(400).json({ ok: false, error: 'invalid cron line(s): ' + bad.slice(0, 3).join('  |  ') });
    const dir = path.join(RUN_DIR, '.crontab_backups');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* noop */ }
    const backup = path.join(dir, 'crontab_' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak');
    let cur = '';
    const lister = spawn('crontab', ['-l'], { shell: false, windowsHide: true });
    lister.stdout.on('data', (d) => { cur += d.toString(); });
    lister.on('error', writeNew);
    lister.on('close', () => { try { fs.writeFileSync(backup, cur); } catch (e) { /* noop */ } writeNew(); });
    function writeNew() {
      let w; try { w = spawn('crontab', ['-'], { shell: false, windowsHide: true }); } catch (e) { return res.status(500).json({ ok: false, error: 'crontab not available', detail: e.message }); }
      let werr = ''; w.stderr.on('data', (d) => { werr += d.toString(); });
      w.on('error', (e) => res.status(500).json({ ok: false, error: e.message }));
      w.on('close', (code) => { if (code === 0) res.json({ ok: true, backup: path.basename(backup), time: new Date().toISOString() }); else res.status(500).json({ ok: false, error: 'crontab write failed (code ' + code + ')' + (werr ? ': ' + werr.trim() : '') }); });
      w.stdin.write(content.endsWith('\n') ? content : content + '\n'); w.stdin.end();
    }
  });
}

module.exports = { build_system, mount };

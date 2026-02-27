// send_daily_summary.js
// tail -f system_metrics.log

const fs = require("fs");
const path = require("path");
const { slack_message_api } = require("../slack_messaging/slack_message_api");

const metrics_file = path.join(__dirname, "metrics.jsonl");

function to_num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gib_from_bytes(b) {
  const n = to_num(b);
  if (n === null) return null;
  return n / 1024 / 1024 / 1024;
}

function fmt(n, digits = 1) {
  if (n === null) return "n/a";
  return n.toFixed(digits);
}

function fmt_pct(n, digits = 1) {
  if (n === null) return "n/a";
  return n.toFixed(digits) + "%";
}

function pct(part, total) {
  const p = to_num(part);
  const t = to_num(total);
  if (p === null || t === null || t <= 0) return null;
  return (p / t) * 100;
}

function parse_file() {
  if (!fs.existsSync(metrics_file)) return [];
  const raw = fs.readFileSync(metrics_file, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function ts_utc_ms(ts_utc) {
  if (!ts_utc) return null;
  const t = Date.parse(String(ts_utc).replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : null;
}

// 12-hour AM/PM timestamp for peak/min lines (MT)
function fmt_ts_mtn_from_ts_utc(ts_utc) {
  const ms = ts_utc_ms(ts_utc);
  if (ms === null) return "n/a";
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function peak(arr, key) {
  return arr.reduce((m, r) => {
    const a = to_num(m[key]);
    const b = to_num(r[key]);
    if (a === null) return r;
    if (b === null) return m;
    return b > a ? r : m;
  }, arr[0]);
}

function min_by(arr, key) {
  return arr.reduce((m, r) => {
    const a = to_num(m[key]);
    const b = to_num(r[key]);
    if (a === null) return r;
    if (b === null) return m;
    return b < a ? r : m;
  }, arr[0]);
}

function avg(arr, key) {
  const nums = arr.map((r) => to_num(r[key])).filter((x) => x !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function first_last_delta(arr, key) {
  if (!arr.length) return { first: null, last: null, delta: null };
  const first = to_num(arr[0][key]);
  const last = to_num(arr[arr.length - 1][key]);
  if (first === null || last === null) return { first, last, delta: null };
  return { first, last, delta: last - first };
}

function arrow(delta, epsilon = 0.01) {
  if (delta === null) return "→";
  if (delta > epsilon) return "↑";
  if (delta < -epsilon) return "↓";
  return "→";
}

// 0..100 score: higher is better
function clamp01(x) {
  if (x === null) return null;
  return Math.max(0, Math.min(1, x));
}

// Convert a "badness" percentage (0..100) into penalty points (0..max_penalty)
function penalty_from_pct(pct_val, warn, crit, max_penalty) {
  const x = to_num(pct_val);
  if (x === null) return 0;

  if (x <= warn) return 0;
  if (x >= crit) return max_penalty;

  // linear between warn..crit
  const t = (x - warn) / (crit - warn);
  return t * max_penalty;
}

// Similar but for absolute values (e.g., io wait)
function penalty_from_abs(val, warn, crit, max_penalty) {
  const x = to_num(val);
  if (x === null) return 0;

  if (x <= warn) return 0;
  if (x >= crit) return max_penalty;

  const t = (x - warn) / (crit - warn);
  return t * max_penalty;
}

function status(val, warn, crit) {
  const x = to_num(val);
  if (x === null) return "UNKNOWN";
  if (x >= crit) return "CRITICAL";
  if (x >= warn) return "WARNING";
  return "OK";
}

function emoji_for_status(s) {
  if (s === "CRITICAL") return ":red_circle:";
  if (s === "WARNING") return ":large_orange_circle:";
  if (s === "OK") return ":large_green_circle:";
  return ":white_circle:";
}

async function send_daily_summary() {
  const all = parse_file();
  const now = Date.now();
  const day_ms = 24 * 60 * 60 * 1000;

  const day = all
    .filter((r) => {
      const t = ts_utc_ms(r.ts_utc);
      return t !== null && t >= now - day_ms;
    })
    .sort((a, b) => (ts_utc_ms(a.ts_utc) || 0) - (ts_utc_ms(b.ts_utc) || 0));

  if (!day.length) {
    await slack_message_api("no metrics in last 24h", "steve_calla_slack_channel");
    return;
  }

  const latest = day[day.length - 1];

  // Peaks / mins
  const peak_load = peak(day, "load_1");
  const peak_disk_pct = peak(day, "disk_use_pct");
  const peak_swap = peak(day, "swap_used_b");
  const peak_wa = peak(day, "vm_wa");
  const min_mem = min_by(day, "mem_available_b");

  // RAM
  const mem_total = gib_from_bytes(latest.mem_total_b);
  const mem_used = gib_from_bytes(latest.mem_used_b);
  const mem_avail = gib_from_bytes(latest.mem_available_b);
  const mem_used_pct = pct(latest.mem_used_b, latest.mem_total_b);
  const min_mem_avail = gib_from_bytes(min_mem.mem_available_b);

  // SWAP
  const swap_total = gib_from_bytes(latest.swap_total_b);
  const swap_used = gib_from_bytes(latest.swap_used_b);
  const swap_used_pct = pct(latest.swap_used_b, latest.swap_total_b);
  const peak_swap_used = gib_from_bytes(peak_swap.swap_used_b);

  // DISK
  const disk_total = gib_from_bytes(latest.disk_size_b);
  const disk_used = gib_from_bytes(latest.disk_used_b);
  const disk_pct = to_num(latest.disk_use_pct);
  const peak_disk = to_num(peak_disk_pct.disk_use_pct);

  // CPU utilization vs cores (approx)
  const cpu_load_pct = pct(latest.load_1, latest.cores);

  // Memory pressure (PSI)
  const psi_some = to_num(latest.psi_some_avg10);
  const psi_full = to_num(latest.psi_full_avg10);

  // Trends (first → last) over 24h window
  const t_load_1 = first_last_delta(day, "load_1");
  const t_mem_used_pct = (() => {
    const first = pct(day[0].mem_used_b, day[0].mem_total_b);
    const last = pct(latest.mem_used_b, latest.mem_total_b);
    if (first === null || last === null) return { first, last, delta: null };
    return { first, last, delta: last - first };
  })();
  const t_disk_pct = first_last_delta(day, "disk_use_pct");
  const t_swap_used_b = first_last_delta(day, "swap_used_b");
  const t_vm_wa = first_last_delta(day, "vm_wa");

  // Section status thresholds
  const mem_status = status(mem_used_pct, 75, 90);
  const disk_status = status(disk_pct, 75, 90);
  const cpu_status = status(cpu_load_pct, 70, 90);
  const swap_status = status(swap_used_pct, 70, 90);
  const io_status = status(to_num(latest.vm_wa), 5, 10);

  // Pressure status (simple)
  let pressure_status = "OK";
  // psi_full > 0 indicates real stalls; psi_some indicates reclaim contention
  if ((psi_full !== null && psi_full > 0.2) || (psi_some !== null && psi_some > 5)) {
    pressure_status = "CRITICAL";
  } else if ((psi_full !== null && psi_full > 0.0) || (psi_some !== null && psi_some > 1)) {
    pressure_status = "WARNING";
  }
  const pressure_emoji = emoji_for_status(pressure_status);

  // Overall health
  const statuses = [mem_status, disk_status, cpu_status, swap_status, io_status, pressure_status];
  let overall = "OK";
  if (statuses.includes("CRITICAL")) overall = "CRITICAL";
  else if (statuses.includes("WARNING")) overall = "WARNING";

  const overall_emoji = emoji_for_status(overall);

  // 0–100 Health Score (higher is better)
  // Penalties (max 100 total). Tune weights here.
  const penalty_mem = penalty_from_pct(mem_used_pct, 75, 90, 25);
  const penalty_disk = penalty_from_pct(disk_pct, 75, 90, 20);
  const penalty_cpu = penalty_from_pct(cpu_load_pct, 70, 90, 20);
  const penalty_swap = penalty_from_pct(swap_used_pct, 70, 90, 15);
  const penalty_io = penalty_from_abs(to_num(latest.vm_wa), 5, 10, 10);

  // PSI penalty (very sensitive to full)
  let penalty_psi = 0;
  if (psi_full !== null) penalty_psi += penalty_from_abs(psi_full, 0.01, 0.2, 10);
  else if (psi_some !== null) penalty_psi += penalty_from_abs(psi_some, 1, 5, 5);

  let score = 100 - (penalty_mem + penalty_disk + penalty_cpu + penalty_swap + penalty_io + penalty_psi);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Score badge
  const score_badge =
    score >= 90 ? ":large_green_circle:" :
    score >= 75 ? ":large_orange_circle:" :
    ":red_circle:";

  const peak_load_time_mtn = fmt_ts_mtn_from_ts_utc(peak_load.ts_utc);
  const peak_disk_time_mtn = fmt_ts_mtn_from_ts_utc(peak_disk_pct.ts_utc);
  const peak_swap_time_mtn = fmt_ts_mtn_from_ts_utc(peak_swap.ts_utc);
  const peak_wa_time_mtn = fmt_ts_mtn_from_ts_utc(peak_wa.ts_utc);
  const min_mem_time_mtn = fmt_ts_mtn_from_ts_utc(min_mem.ts_utc);

  const message =
`:desktop_computer: *${latest.host_name} — 24h System Health Summary*
Overall Status: ${overall_emoji} *${overall}*    Health Score: ${score_badge} *${score}/100*
Samples analyzed (last 24h): ${day.length}
────────────────────────
:floppy_disk: *RAM (Memory)*
Current Used: ${fmt(mem_used)}/${fmt(mem_total)} GiB (${fmt_pct(mem_used_pct)})   Trend: ${arrow(t_mem_used_pct.delta)} (${fmt(t_mem_used_pct.delta, 1)} pp)
Current Available: ${fmt(mem_avail)} GiB
Minimum Available (last 24h): ${fmt(min_mem_avail)} GiB @ ${min_mem_time_mtn} MT
Status: ${emoji_for_status(mem_status)} ${mem_status}
Memory Pressure (PSI avg10): some=${psi_some === null ? "n/a" : psi_some.toFixed(2)}  full=${psi_full === null ? "n/a" : psi_full.toFixed(2)}   Status: ${pressure_emoji} ${pressure_status}
────────────────────────
:brain: *CPU*
Current Load (1m/5m/15m): ${latest.load_1}/${latest.load_5}/${latest.load_15}   Trend (1m load): ${arrow(t_load_1.delta)} (${fmt(t_load_1.delta, 2)})
Peak 1-Minute Load (24h): ${to_num(peak_load.load_1) === null ? "n/a" : to_num(peak_load.load_1).toFixed(2)} @ ${peak_load_time_mtn} MT
CPU Utilization vs Capacity (approx): ${fmt_pct(cpu_load_pct)}
Cores: ${latest.cores}
Status: ${emoji_for_status(cpu_status)} ${cpu_status}
────────────────────────
:minidisc: *Disk (Root /)*
Current Used: ${fmt(disk_used)}/${fmt(disk_total)} GiB (${disk_pct === null ? "n/a" : disk_pct.toFixed(0)}%)   Trend: ${arrow(t_disk_pct.delta)} (${fmt(t_disk_pct.delta, 1)} pp)
Peak Usage % (24h): ${peak_disk === null ? "n/a" : peak_disk.toFixed(0)}% @ ${peak_disk_time_mtn} MT
Status: ${emoji_for_status(disk_status)} ${disk_status}
────────────────────────
:repeat: *Swap (Virtual Memory)*
Current Used: ${fmt(swap_used)}/${fmt(swap_total)} GiB (${fmt_pct(swap_used_pct)})   Trend: ${arrow(t_swap_used_b.delta)} (${fmt(gib_from_bytes(t_swap_used_b.delta), 2)} GiB)
Peak Swap Used (24h): ${fmt(peak_swap_used)} GiB @ ${peak_swap_time_mtn} MT
Status: ${emoji_for_status(swap_status)} ${swap_status}
────────────────────────
:zap: *Disk IO Wait*
Current IO Wait: ${latest.vm_wa}%   Trend: ${arrow(t_vm_wa.delta)} (${fmt(t_vm_wa.delta, 1)} pp)
Peak IO Wait (24h): ${peak_wa.vm_wa}% @ ${peak_wa_time_mtn} MT
Status: ${emoji_for_status(io_status)} ${io_status}
────────────────────────
:thermometer: *Temperatures*
Current CPU Temp: ${latest.cpu_temp_c || "n/a"}°C
Current NVMe Temp: ${latest.nvme_temp_c || "n/a"}°C
`;

  await slack_message_api(message, "steve_calla_slack_channel");
}

if (require.main === module) {
  send_daily_summary()
    .catch((e) => {
      console.error("send_daily_summary failed:", e?.message || e);
      process.exitCode = 1;
    });
}

module.exports = { send_daily_summary };
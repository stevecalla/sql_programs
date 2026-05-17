/**
 * dashboard.js — Generate a truly self-contained HTML dashboard.
 *
 * Chart.js is embedded INLINE from the local npm copy — no CDN, no internet
 * required, works offline, works on air-gapped machines.
 *
 * Charts (matching PowerPoint data exactly):
 *   1. Monthly bar chart — raw delta bars + organic delta line
 *   2. Event type grouped bar — 2025 vs 2026 counts by type
 *   3. Segment donut — Retained / Shifted / Lost / New / Recovered
 *   4. Organic performance horizontal bar — raw % vs organic % by type
 *   5. Calendar impact scatter — calendar expected vs organic delta by month
 *
 * Layout: full flexbox, mobile-responsive (stacks to single column ≤768px).
 */

'use strict';

const MN_ARR = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPES  = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];
const TYPE_COLOR = {
  'Adult Race':   '#1565C0',
  'Youth Race':   '#37474F',
  'Adult Clinic': '#C62828',
  'Youth Clinic': '#1E7D34',
};
const SEG_COLOR = {
  Retained:          '#1E7D34',
  Shifted:           '#E65100',
  Lost:          '#C62828',
  New:               '#1565C0',
  Recovered:         '#6A1B9A',
  'Tried to Return': '#BF360C',
};

// Inline SVG favicon — USAT red triathlon icon
const FAVICON_SVG = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%23BF1B2C'/><text x='16' y='23' font-size='20' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'>U</text></svg>`;

// Load Chart.js source once (embedded inline → no CDN, fully offline)
function get_chartjs_src() {
  const fs   = require('fs');
  const path = require('path');
  // Try local npm copy first, then fallback paths
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'),
    path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  // Last resort: CDN script tag (requires internet)
  return null;
}

function generate_dashboard(results, cm, out_path, segments_raw = null) {
  const fs   = require('fs');
  const path = require('path');
  const chartjs_src = get_chartjs_src();

  // ── Pull data using actual field names from analysis_results.json ──────────
  const ya = results.years?.BASELINE_YEAR ?? 2025;
  const yb = results.years?.ANALYSIS_YEAR ?? 2026;
  const n_baseline = results.totals?.BASELINE_YEAR ?? 0;
  const n_analysis = results.totals?.ANALYSIS_YEAR ?? 0;
  const net = results.totals?.net ?? (n_analysis - n_baseline);

  // Segments (direct from results.segments which is the segSummary object)
  const seg = results.segments ?? {};

  // By-type data — field names are tot25/tot26/actDelta
  const by_type = results.by_type ?? {};
  const type_n25    = TYPES.map(t => by_type[t]?.tot25     ?? by_type[t]?.n_baseline ?? 0);
  const type_n26    = TYPES.map(t => by_type[t]?.tot26     ?? by_type[t]?.n_analysis ?? 0);
  const type_deltas = TYPES.map(t => by_type[t]?.actDelta  ?? by_type[t]?.delta ?? 0);

  // Organic by type
  const org_by_type = results.organic_by_type ?? {};
  const type_org_pct = TYPES.map(t => {
    const o = org_by_type[t];
    if (!o) return 0;
    const n = o.tot25 ?? (by_type[t]?.tot25 ?? 1);
    return n ? parseFloat(((o.orgTotal ?? 0) / n * 100).toFixed(1)) : 0;
  });
  const type_raw_pct = TYPES.map((_, i) => {
    const n = type_n25[i];
    return n ? parseFloat(((type_deltas[i]) / n * 100).toFixed(1)) : 0;
  });

  // Monthly data — keys are '1'..'12', field is net_delta
  const monthly = results.monthly ?? {};
  const month_labels = MN_ARR.slice(1);  // Jan..Dec
  const raw_deltas  = month_labels.map((_, i) => monthly[i + 1]?.net_delta    ?? monthly[String(i+1)]?.net_delta    ?? 0);
  const org_deltas  = month_labels.map((_, i) => monthly[i + 1]?.organic_delta ?? monthly[String(i+1)]?.organic_delta ?? raw_deltas[i]);
  const month_n25   = month_labels.map((_, i) => monthly[i + 1]?.n_baseline           ?? monthly[String(i+1)]?.n_baseline           ?? 0);
  const month_n26   = month_labels.map((_, i) => monthly[i + 1]?.n_analysis           ?? monthly[String(i+1)]?.n_analysis           ?? 0);

  // Calendar impact — keys are 0-indexed (0=Jan..11=Dec)
  // Some data sets use 1-indexed, handle both
  const cal_raw = results.calendar_impact ?? {};
  const cal_points = [];
  for (let m = 1; m <= 12; m++) {
    const ci = cal_raw[m - 1];
    if (!ci) continue;
    const cal_total = ci.calTotal ?? 0;
    const org_total = ci.orgTotal ?? ci.organic_delta ?? (monthly[m]?.net_delta ?? 0);
    if (Math.abs(cal_total) > 0.3 || Math.abs(org_total) >= 8) {
      cal_points.push({ label: MN_ARR[m], x: parseFloat(cal_total.toFixed(1)), y: parseFloat(org_total.toFixed(1)) });
    }
  }

  // Top decliner / grower (from commentary or computed)
  const top_dec = cm?.top_decliner ?? TYPES.map((t, i) => ({ type: t, pct: type_raw_pct[i] })).sort((a, b) => a.pct - b.pct)[0];
  const top_gro = cm?.top_grower   ?? TYPES.map((t, i) => ({ type: t, pct: type_raw_pct[i] })).sort((a, b) => b.pct - a.pct).find(d => d.pct > 0);
  const worst_months = cm?.worst_months ?? month_labels.map((l, i) => ({ label: l, delta: raw_deltas[i] })).sort((a, b) => a.delta - b.delta).slice(0, 2);

  // Commentary
  const mode       = cm?.mode ?? 'rule_based';
  const built_at   = results.generated_at ?? new Date().toISOString();
  const ov_count   = results.overrides?.total_applied ?? 0;
  const bullets    = cm?.excel_slack_bullets ?? [];
  const has_api    = mode === 'ai_claude';

  const seg_labels = Object.keys(seg);
  const seg_values = seg_labels.map(k => seg[k]);
  const seg_colors = seg_labels.map(k => SEG_COLOR[k] ?? '#999');
  const ret_pct    = n_baseline ? Math.round((seg.Retained ?? 0) / n_baseline * 100) : 0;

  // ── Build HTML (Chart.js embedded inline — fully offline) ────────────────
  // Build Chart.js script tag via string concat — NOT template literal
  // (Chart.js minified contains 58 backticks that would break a template literal)
  const chartjs_open  = '<scr' + 'ipt>';
  const chartjs_close = '</sc' + 'ript>';
  const chartjs_tag   = chartjs_src
    ? chartjs_open + chartjs_src + chartjs_close
    : chartjs_open.replace('>','') + ' src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js">' + chartjs_close;

  const sign = v => v >= 0 ? `+${v}` : `${v}`;

  // ── Compact event roster for the HTML table ──────────────────────────────
  // Keep only fields needed for display; strip normalizer internals
  const MN_MAP = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_MAP = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const day_of = d => { try { return DAY_MAP[new Date(d).getDay()]; } catch { return ''; } };
  const SEGS = ['Retained','Shifted','Tried to Return','Lost','Recovered','New'];
  const roster = [];
  if (segments_raw) {
    for (const seg_key of SEGS) {
      const js_key = seg_key === 'Tried to Return' ? 'triedToReturn'
                   : seg_key === 'Lost'           ? 'attrited'
                   : seg_key.toLowerCase();
      const items  = segments_raw[js_key] ?? [];
      for (const m of items) {
        roster.push({
          seg:  m.seg ?? seg_key,
          conf: m.conf ?? '?',
          type: m.e25?.type ?? m.e26?.type ?? '',
          m25:  m.e25?.month  ? MN_MAP[m.e25.month]  : '',
          sid25: m.e25?.sanctionId ?? '',
          name25: m.e25?.name ?? '',
          date25: m.e25?.startDate ? m.e25.startDate instanceof Date ? m.e25.startDate.toISOString().slice(0,10) : String(m.e25.startDate).slice(0,10) : '',
          day25:  m.e25?.startDate ? day_of(m.e25.startDate) : '',
          st25:   m.e25?.status ?? '',
          m26:   m.e26?.month  ? MN_MAP[m.e26.month]  : '',
          sid26:  m.e26?.sanctionId ?? '',
          name26: m.e26?.name ?? '',
          date26: m.e26?.startDate ? m.e26.startDate instanceof Date ? m.e26.startDate.toISOString().slice(0,10) : String(m.e26.startDate).slice(0,10) : '',
          day26:  m.e26?.startDate ? day_of(m.e26.startDate) : '',
          st26:   m.e26?.status ?? '',
        });
      }
    }
  }
  const has_table = roster.length > 0;

  const type_cards_html = TYPES.map((t, i) => {
    const d = type_deltas[i], rp = type_raw_pct[i], op = type_org_pct[i];
    const col = TYPE_COLOR[t];
    return `<div class="type-card" style="border-top:3px solid ${col}">
      <div class="type-name">${t}</div>
      <div class="counts" style="color:${col}">${type_n25[i].toLocaleString()} → ${type_n26[i].toLocaleString()}</div>
      <div class="delta" style="color:${d < 0 ? '#C62828' : d > 0 ? '#1E7D34' : '#888'}">${sign(d)} (${sign(rp)}%)</div>
      <div class="org">Organic: ${sign(op)}%</div>
    </div>`;
  }).join('\n');

  const bullets_html = bullets.length
    ? bullets.map(b => `<div class="bullet"><div class="dot"></div><div>${String(b).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div></div>`).join('\n')
    : `<div class="bullet"><div class="dot"></div><div><strong>Net: ${sign(net)} events</strong> (${n_baseline.toLocaleString()} → ${n_analysis.toLocaleString()}, ${((net/n_baseline)*100).toFixed(1)}%)</div></div>
       <div class="bullet"><div class="dot"></div><div><strong>Worst months:</strong> ${worst_months.map(m => m.label + ' (' + sign(m.delta) + ')').join(', ')}</div></div>
       <div class="bullet"><div class="dot"></div><div><strong>Top issue:</strong> ${top_dec?.type ?? '?'} (${top_dec?.pct ?? 0}%)</div></div>
       ${top_gro ? `<div class="bullet"><div class="dot" style="background:#1E7D34"></div><div><strong>Top growth:</strong> ${top_gro.type} (+${top_gro.pct}%)</div></div>` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>USAT ${ya} vs ${yb} — Event Analysis Dashboard</title>
<link rel="icon" href="${FAVICON_SVG}">
` + chartjs_tag + `
<style>
/* ── Reset ── */
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px}
body{font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#F0F2F5;color:#222;
     padding:12px 14px;min-height:100vh}

/* ── Header ── */
.hdr{background:linear-gradient(135deg,#BF1B2C,#8B0000);color:#fff;border-radius:10px;
     padding:16px 20px 12px;margin-bottom:12px;
     display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.hdr-left h1{font-size:clamp(1rem,3vw,1.4rem);font-weight:700;line-height:1.2}
.hdr-left .sub{font-size:.78rem;opacity:.75;margin-top:5px}
.hdr-right{text-align:right;font-size:.82rem;opacity:.75;white-space:nowrap;flex-shrink:0}
.hdr-right .big{font-size:1.3rem;font-weight:700;display:block}
.badge{display:inline-block;font-size:.68rem;padding:2px 7px;border-radius:10px;
       background:rgba(255,255,255,.2);color:#fff;margin-left:6px;vertical-align:middle}
.badge.ai{background:rgba(30,125,52,.65)}
.badge.warn{background:rgba(230,81,0,.7)}

/* ── KPI row (flex, wraps on mobile) ── */
.kpi-row{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:10px}
.kpi{background:#fff;border-radius:8px;padding:12px 16px;flex:1 1 100px;
     box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid #ccc}
.kpi .val{font-size:1.6rem;font-weight:700;line-height:1}
.kpi .lbl{font-size:.68rem;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
.kpi.red{border-color:#C62828} .kpi.red .val{color:#C62828}
.kpi.grn{border-color:#1E7D34} .kpi.grn .val{color:#1E7D34}
.kpi.blu{border-color:#1565C0} .kpi.blu .val{color:#1565C0}
.kpi.amb{border-color:#E65100} .kpi.amb .val{color:#E65100}
.kpi.pur{border-color:#6A1B9A} .kpi.pur .val{color:#6A1B9A}

/* ── Type strip ── */
.type-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.type-card{flex:1 1 120px;background:#fff;border-radius:8px;padding:10px 13px;
           box-shadow:0 1px 3px rgba(0,0,0,.08)}
.type-name{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#666}
.counts{font-size:.95rem;font-weight:700;margin:4px 0 2px}
.delta{font-size:.78rem;font-weight:600}
.org{font-size:.7rem;color:#999;margin-top:1px}

/* ── Chart rows (flex, wrap on mobile) ── */
.row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.card{background:#fff;border-radius:8px;padding:14px 16px;
      box-shadow:0 1px 3px rgba(0,0,0,.08);min-width:0}
/* Row 1: monthly (2/3) + segment (1/3) */
.card-monthly{flex:2 1 360px}
.card-segment{flex:1 1 180px}
/* Row 2: three equal */
.card-third{flex:1 1 220px}
/* Row 3: key findings full width */
/* card-full: 100% of the row — min-width:0 prevents flex blowout on narrow screens */
.card-full{flex:1 1 100%;min-width:0;overflow:hidden}

.card h3{font-size:.74rem;font-weight:700;color:#555;margin-bottom:11px;
         text-transform:uppercase;letter-spacing:.06em;line-height:1.3}
.card h3 .note{font-size:.66rem;font-weight:400;color:#aaa;text-transform:none;letter-spacing:0;display:block}
canvas{width:100%!important;max-height:220px}

/* ── Bullets ── */
.bullets{display:flex;flex-direction:column;gap:7px;margin-top:6px}
.bullet{display:flex;gap:10px;padding:8px 10px;border-radius:6px;background:#F8F9FA;
        font-size:.8rem;line-height:1.45;color:#333}
.dot{width:7px;height:7px;min-width:7px;border-radius:50%;background:#BF1B2C;margin-top:5px}

/* ── Chart action buttons ── */
.chart-actions{margin-left:auto;display:flex;gap:4px;align-items:center}
/* ── Chart ↔ table flip view ── */
.chart-flip-tbl{
  display:none;width:100%;height:100%;overflow-y:auto;overflow-x:auto;
  -webkit-overflow-scrolling:touch}
.chart-flip-tbl table{
  width:100%;min-width:340px;border-collapse:collapse;font-size:.75rem}
.chart-flip-tbl thead th{
  background:#37474F;color:#fff;padding:6px 10px;
  text-align:right;white-space:nowrap;
  position:sticky;top:0;z-index:1}
.chart-flip-tbl thead th:first-child{text-align:left}
.chart-flip-tbl tbody td{
  padding:5px 10px;border-bottom:1px solid #f0f0f0;
  text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.chart-flip-tbl tbody td:first-child{text-align:left;font-weight:600;color:#37474F}
.chart-flip-tbl tbody tr:nth-child(even){background:#F8F9FA}
.chart-flip-tbl tbody tr:hover{background:#EEF2FF}
.chart-flip-tbl tfoot td{
  padding:6px 10px;text-align:right;font-weight:700;
  background:#ECEFF1;border-top:2px solid #37474F}
.chart-flip-tbl tfoot td:first-child{text-align:left}
.flip-btn-active{background:#EEF4FD!important;color:#1565C0!important;border-color:#1565C0!important}
.chart-btn{border:1px solid #ddd;border-radius:4px;background:#fff;color:#555;
           font-size:.65rem;padding:2px 6px;cursor:pointer;font-family:inherit;
           display:inline-flex;align-items:center;gap:2px;transition:all .15s;white-space:nowrap}
.chart-btn:hover{background:#1565C0;color:#fff;border-color:#1565C0}
.card h3{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px}
/* ── Expand modal ── */
#chart-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);
             z-index:9999;align-items:center;justify-content:center}
#chart-modal.open{display:flex}
.modal-box{background:#fff;border-radius:12px;padding:18px;
           width:92vw;height:85vh;position:relative;display:flex;flex-direction:column;
           box-shadow:0 20px 60px rgba(0,0,0,.4)}
.modal-hdr{display:flex;justify-content:space-between;align-items:center;
           margin-bottom:12px;font-weight:700;font-size:.9rem;color:#333}
.modal-close{border:none;background:#eee;border-radius:6px;padding:4px 10px;
             cursor:pointer;font-size:1rem;color:#555}
.modal-close:hover{background:#C62828;color:#fff}
.modal-canvas-wrap{flex:1;position:relative;min-height:0}
/* ── Panel ── */
.panel-body{margin-top:12px}
.panel-body.hidden{display:none}
/* ── Footer ── */
.footer{margin-top:10px;font-size:.68rem;color:#bbb;text-align:center;padding-bottom:4px}

/* ── Multi-select + column-picker dropdowns ── */
.multi-drop{position:relative;display:inline-block}
.multi-drop-btn{
  display:inline-flex;align-items:center;gap:5px;
  border:1px solid #ccc;border-radius:6px;padding:5px 10px;font-size:.78rem;
  font-family:inherit;background:#fafafa;color:#444;cursor:pointer;
  white-space:nowrap;transition:border-color .15s,background .15s}
.multi-drop-btn:hover{border-color:#999;background:#f0f0f0}
.multi-drop-btn:focus{border-color:#1565C0;outline:none;box-shadow:0 0 0 2px rgba(21,101,192,.15)}
.multi-drop-btn.active{border-color:#1565C0;background:#EEF4FD;color:#1565C0;font-weight:600}
.multi-drop-panel{
  display:none;position:absolute;top:calc(100% + 5px);left:0;z-index:300;
  background:#fff;border:1px solid #dde3ee;border-radius:8px;
  padding:4px 0 6px;min-width:170px;
  box-shadow:0 6px 20px rgba(0,0,0,.13),0 1px 4px rgba(0,0,0,.07)}
.multi-drop-panel.open{display:block}
.multi-drop-panel .drop-actions{
  display:flex;align-items:center;gap:0;padding:5px 12px 6px;
  border-bottom:1px solid #eee;margin-bottom:3px}
.multi-drop-panel .drop-actions button{
  background:none;border:none;color:#1565C0;font-size:.71rem;cursor:pointer;
  padding:0;font-family:inherit;font-weight:600;text-decoration:none;letter-spacing:.01em}
.multi-drop-panel .drop-actions button:hover{color:#0d47a1;text-decoration:underline}
.multi-drop-panel .drop-actions span{color:#ddd;padding:0 6px;font-size:.75rem}
/* Row */
.multi-drop-panel label{
  display:flex;align-items:center;padding:4px 12px;
  font-size:.78rem;cursor:pointer;white-space:nowrap;
  color:#333;transition:background .08s;user-select:none;line-height:1.4}
.multi-drop-panel label:hover{background:#F0F5FF}
/* Custom checkbox — cross-browser consistent */
.multi-drop-panel label input[type=checkbox]{
  -webkit-appearance:none;appearance:none;
  flex:0 0 14px;width:14px;height:14px;
  border:1.5px solid #b0b8c8;border-radius:3px;
  background:#fff;margin:0 9px 0 0;cursor:pointer;
  position:relative;transition:border-color .12s,background .12s}
.multi-drop-panel label input[type=checkbox]:checked{
  background:#1565C0;border-color:#1565C0}
.multi-drop-panel label input[type=checkbox]:checked::after{
  content:"";position:absolute;
  left:4px;top:1px;width:4px;height:8px;
  border:2px solid #fff;border-top:none;border-left:none;
  transform:rotate(45deg)}
.multi-drop-panel label input[type=checkbox]:hover{border-color:#1565C0}
/* Color dot */
.multi-drop-panel label .dot{
  flex:0 0 9px;width:9px;height:9px;border-radius:50%;
  margin:0 7px 0 0;display:block}
.multi-drop-panel label .lbl-text{flex:1;text-align:left}
/* Column-picker section headings */
.col-pick-group{padding:4px 12px 2px;font-size:.68rem;font-weight:700;
  color:#999;text-transform:uppercase;letter-spacing:.06em;border-top:1px solid #f0f0f0;margin-top:4px}
.col-pick-group:first-child{border-top:none;margin-top:0}
/* Toggleable table columns — hidden by default, shown when table has class */
#evt-tbl .col-sid25,#evt-tbl .col-date25,
#evt-tbl .col-sid26,#evt-tbl .col-date26{display:none}
#evt-tbl.show-sid25  .col-sid25 {display:table-cell}
#evt-tbl.show-date25 .col-date25{display:table-cell}
#evt-tbl.show-sid26  .col-sid26 {display:table-cell}
#evt-tbl.show-date26 .col-date26{display:table-cell}
/* ── Event table ── */
/* ── Active filter chips ── */
.filter-bar{display:none;align-items:center;gap:6px;flex-wrap:wrap;
  padding:6px 0 4px;border-bottom:1px solid #eee;margin-bottom:8px}
.filter-bar.has-filters{display:flex}
.filter-chip{
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 8px;border-radius:10px;font-size:.72rem;font-weight:600;
  background:#EEF4FD;color:#1565C0;border:1px solid #BBDEFB;
  white-space:nowrap;cursor:default}
.filter-chip .chip-label{color:#888;font-weight:400;margin-right:2px}
.filter-chip button{
  background:none;border:none;color:#1565C0;cursor:pointer;
  padding:0 0 0 3px;font-size:.8rem;line-height:1;opacity:.7}
.filter-chip button:hover{opacity:1;color:#C62828}
.filter-bar .clear-all{
  margin-left:auto;background:none;border:none;color:#C62828;
  font-size:.72rem;cursor:pointer;font-family:inherit;
  text-decoration:underline;padding:0;white-space:nowrap}
.filter-bar .filter-bar-lbl{
  font-size:.71rem;font-weight:700;color:#999;
  text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
/* ── Segment summary bar above table ── */
.seg-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center;min-height:28px}
.seg-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;
  font-size:.73rem;font-weight:600;white-space:nowrap;cursor:pointer;
  border:1px solid transparent;transition:opacity .12s,box-shadow .12s,transform .1s;
  user-select:none}
.seg-chip:hover{box-shadow:0 1px 4px rgba(0,0,0,.15);transform:translateY(-1px)}
.seg-chip.zero{opacity:.28}
.seg-chip.zero:hover{opacity:.45}
.seg-chip.active{border-width:2px!important;box-shadow:0 2px 6px rgba(0,0,0,.18)}
.seg-chip .chip-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.seg-chip .chip-pct{font-weight:400;opacity:.75;margin-left:2px}
.seg-chip .chip-x{font-size:.75rem;margin-left:3px;opacity:.55}
.seg-chip.active .chip-x{opacity:1}
.seg-bar-total{margin-left:auto;font-size:.71rem;color:#999;font-style:italic}
.tbl-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.tbl-toolbar input,.tbl-toolbar select{
  border:1px solid #ddd;border-radius:5px;padding:5px 9px;font-size:.78rem;
  font-family:inherit;background:#fff;color:#333;outline:none}
.tbl-toolbar input{flex:1 1 160px;min-width:140px}
.tbl-toolbar input:focus,.tbl-toolbar select:focus{border-color:#1565C0;box-shadow:0 0 0 2px rgba(21,101,192,.15)}
/* ── Table scroll container ── */
.tbl-wrap{
  overflow-x:auto;
  overflow-y:auto;
  max-height:520px;
  -webkit-overflow-scrolling:touch; /* iOS momentum scroll */
  border-radius:6px;
  border:1px solid #eee;
  /* Clip so sticky header corners stay rounded */
  border-radius:6px;
}
/* Force a minimum table width so horizontal scroll activates on narrow screens */
#evt-tbl{width:100%;min-width:820px;border-collapse:collapse;font-size:.75rem}
#evt-tbl thead th{
  background:#37474F;color:#fff;padding:7px 10px;text-align:left;
  white-space:nowrap;cursor:pointer;user-select:none;position:sticky;top:0;z-index:2}
#evt-tbl thead th:hover{background:#455A64}
#evt-tbl thead th::after{content:' ↕';opacity:.4;font-size:.65rem}
#evt-tbl thead th.asc::after{content:' ↑';opacity:1}
#evt-tbl thead th.desc::after{content:' ↓';opacity:1}
#evt-tbl tbody tr:nth-child(even){background:#F8F9FA}
#evt-tbl tbody tr:hover{background:#EEF2FF}
#evt-tbl td{padding:5px 10px;border-bottom:1px solid #f0f0f0;white-space:nowrap}
#evt-tbl td.st-col{font-size:.7rem;color:#888}
#evt-tbl td.name-col{white-space:normal;min-width:160px;max-width:260px}
.seg-Retained{color:#1E7D34;font-weight:600}
.seg-Shifted{color:#E65100;font-weight:600}
.seg-Lost{color:#C62828;font-weight:600}
.seg-New{color:#1565C0;font-weight:600}
.seg-Recovered{color:#6A1B9A;font-weight:600}
.seg-Tried.to.Return,.seg-TtR{color:#BF360C;font-weight:600}

/* ── Mobile tweaks ── */
@media(max-width:700px){
  .card-monthly,.card-segment,.card-third{flex:1 1 100%!important;min-width:100%!important}
  .row{flex-direction:column}
  /* Table: shorter vertical scroll window on landscape phones/tablets */
  .tbl-wrap{max-height:60vh}
}
@media(max-width:520px){
  body{padding:6px}
  .hdr{padding:10px 12px 8px}
  .kpi .val{font-size:1.2rem}
  canvas{max-height:180px}
  /* Toolbar: search bar full width on first row, filters wrap below */
  .tbl-toolbar{gap:5px}
  .tbl-toolbar input[type=search]{flex:1 1 100%;order:-1}
  /* Smaller table font, tighter padding */
  #evt-tbl{font-size:.7rem;min-width:720px}
  #evt-tbl td{padding:4px 7px}
  #evt-tbl thead th{padding:6px 8px;font-size:.68rem}
  /* Seg bar chips wrap tightly */
  .seg-bar{gap:4px}
  .seg-chip{font-size:.68rem;padding:2px 7px}
  /* KPI cards smaller */
  .kpi{padding:9px 11px}
  /* Type strip cards smaller */
  .type-card{min-width:100px;padding:8px 10px}
}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-left">
    <h1>USAT Sanctioned Events — ${ya} vs ${yb}
      <span class="badge ${has_api ? 'ai' : ''}">${has_api ? '⚡ AI' : '📐 Rule-based'}</span>
      ${ov_count ? `<span class="badge warn">⚠ ${ov_count} override${ov_count > 1 ? 's' : ''}</span>` : ''}
    </h1>
    <div class="sub">Built ${new Date(built_at).toLocaleDateString('en-US',{dateStyle:'long'})}
      · Excl. Cancelled / Declined / Deleted · ~85–90% match confidence</div>
  </div>
  <div class="hdr-right">
    ${n_baseline.toLocaleString()} → ${n_analysis.toLocaleString()}
    <span class="big">${sign(net)} net</span>
  </div>
</div>

<div class="type-strip">${type_cards_html}</div>

<div class="kpi-row">
  <div class="kpi ${net < 0 ? 'red' : 'grn'}">
    <div style="font-size:.72rem;color:#999;margin-bottom:2px">${n_baseline.toLocaleString()} → ${n_analysis.toLocaleString()}</div>
    <div class="val">${sign(net)} <span style="font-size:1rem;font-weight:500">(${((net/n_baseline)*100).toFixed(1)}%)</span></div>
    <div class="lbl">Net change</div>
  </div>
  <div class="kpi ${ret_pct >= 60 ? 'grn' : 'amb'}">
    <div class="val">${(seg.Retained ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${ret_pct}%)</span></div>
    <div class="lbl">Retained</div>
  </div>
  <div class="kpi red">
    <div class="val">${(seg.Lost ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.Lost??0)/n_baseline*100)}%)</span></div>
    <div class="lbl">Lost</div>
  </div>
  <div class="kpi blu">
    <div class="val">${(seg.New ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.New??0)/n_analysis*100)}%)</span></div>
    <div class="lbl">New events</div>
  </div>
  <div class="kpi pur">
    <div class="val">${(seg.Recovered ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.Recovered??0)/n_analysis*100)}%)</span></div>
    <div class="lbl">Recovered</div>
  </div>
  <div class="kpi amb"><div class="val">${worst_months[0]?.label ?? '?'} ${worst_months[0]?.delta ?? ''}</div><div class="lbl">Worst month</div></div>
</div>

<div class="row">
  <div class="card card-monthly">
    <h3>Event count by month comparison <span class="note">bars = actual counts · variance Δ above 2026 bar</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_organic')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_organic')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_organic')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_organic" class="chart-btn" onclick="flip_chart_table('c_organic')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:280px"><canvas id="c_organic"></canvas><div id="flip-tbl-c_organic" class="chart-flip-tbl"></div></div>
  </div>
  <div class="card card-segment">
    <h3>Event counts by type <span class="note">${ya} vs ${yb} · variance above 2026 bar</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_type')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_type')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_type')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_type" class="chart-btn" onclick="flip_chart_table('c_type')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:280px"><canvas id="c_type"></canvas><div id="flip-tbl-c_type" class="chart-flip-tbl"></div></div>
  </div>
</div>

<div class="row">
  <div class="card card-monthly">
    <h3>Monthly event delta <span class="note">bars = raw Δ · orange line = organic Δ (raw minus calendar effect)</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_monthly')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_monthly')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_monthly')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_monthly" class="chart-btn" onclick="flip_chart_table('c_monthly')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:260px"><canvas id="c_monthly"></canvas><div id="flip-tbl-c_monthly" class="chart-flip-tbl"></div></div>
  </div>
  <div class="card card-segment">
    <h3>Segment breakdown<span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_segment')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_segment')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_segment')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_segment" class="chart-btn" onclick="flip_chart_table('c_segment')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:260px"><canvas id="c_segment"></canvas><div id="flip-tbl-c_segment" class="chart-flip-tbl"></div></div>
  </div>
</div>

<div class="row">
  <div class="card card-full">
    <h3>Weekend day shifts <span class="note">Sat Δ (green/red) · Sun Δ (blue/orange) vs prior year · shows which months gained or lost a weekend day</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_calendar')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_calendar')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_calendar')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_calendar" class="chart-btn" onclick="flip_chart_table('c_calendar')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:200px"><canvas id="c_calendar"></canvas><div id="flip-tbl-c_calendar" class="chart-flip-tbl"></div></div>
  </div>
</div>

<div class="row">
  <div class="card card-full">
    <h3>Key findings <span class="note">${has_api ? 'Claude AI' : 'Rule-based'} · matches PowerPoint narratives</span></h3>
    <div class="bullets">${bullets_html}</div>
  </div>
</div>

${has_table ? `
<div class="row">
  <div class="card card-full">
    <h3>Event roster <span class="note">Step 4 detail — ${roster.length} events · filterable + sortable</span></h3>
    <div class="tbl-toolbar">
      <input id="tbl-search" type="search" placeholder="Search event name…" autocomplete="off">
      <button id="tbl-reset-btn" class="chart-btn" onclick="clear_all_filters()" title="Clear all filters and reset table" style="display:none;color:#C62828;border-color:#FFCDD2;background:#FFF5F5">↺ Reset</button>
      <div class="multi-drop" id="drop-seg">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-seg')">All segments ▾</button>
        <div class="multi-drop-panel" id="panel-drop-seg">
          <div class="drop-actions"><button type="button" onclick="drop_all(\x27panel-drop-seg\x27,true)">All</button><span>|</span><button type="button" onclick="drop_all(\x27panel-drop-seg\x27,false)">None</button></div>
          <label><input type="checkbox" value="Retained" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#2e7d32"></span><span class="lbl-text">Retained</span></label>
          <label><input type="checkbox" value="Shifted" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#e65100"></span><span class="lbl-text">Shifted</span></label>
          <label><input type="checkbox" value="Tried to Return" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#bf360c"></span><span class="lbl-text">Tried to Return</span></label>
          <label><input type="checkbox" value="Lost" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#c62828"></span><span class="lbl-text">Lost</span></label>
          <label><input type="checkbox" value="Recovered" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#6a1b9a"></span><span class="lbl-text">Recovered</span></label>
          <label><input type="checkbox" value="New" onchange="update_drop_btn(\x27panel-drop-seg\x27);filter_and_sort()"><span class="dot" style="background:#006064"></span><span class="lbl-text">New</span></label>
        </div>
      </div>
      <div class="multi-drop" id="drop-type">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-type')">All types ▾</button>
        <div class="multi-drop-panel" id="panel-drop-type">
          <div class="drop-actions"><button type="button" onclick="drop_all(\x27panel-drop-type\x27,true)">All</button><span>|</span><button type="button" onclick="drop_all(\x27panel-drop-type\x27,false)">None</button></div>
          <label><input type="checkbox" value="Adult Race" onchange="update_drop_btn(\x27panel-drop-type\x27);filter_and_sort()"><span class="dot" style="background:#1565C0"></span><span class="lbl-text">Adult Race</span></label>
          <label><input type="checkbox" value="Youth Race" onchange="update_drop_btn(\x27panel-drop-type\x27);filter_and_sort()"><span class="dot" style="background:#00897B"></span><span class="lbl-text">Youth Race</span></label>
          <label><input type="checkbox" value="Adult Clinic" onchange="update_drop_btn(\x27panel-drop-type\x27);filter_and_sort()"><span class="dot" style="background:#F57C00"></span><span class="lbl-text">Adult Clinic</span></label>
          <label><input type="checkbox" value="Youth Clinic" onchange="update_drop_btn(\x27panel-drop-type\x27);filter_and_sort()"><span class="dot" style="background:#8E24AA"></span><span class="lbl-text">Youth Clinic</span></label>
        </div>
      </div>
      <div class="multi-drop" id="drop-month">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-month')">All months ▾</button>
        <div class="multi-drop-panel" id="panel-drop-month">
          <div class="drop-actions"><button type="button" onclick="drop_all(\x27panel-drop-month\x27,true)">All</button><span>|</span><button type="button" onclick="drop_all(\x27panel-drop-month\x27,false)">None</button></div>
          <label><input type="checkbox" value="Jan" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Jan</span></label>
          <label><input type="checkbox" value="Feb" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Feb</span></label>
          <label><input type="checkbox" value="Mar" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Mar</span></label>
          <label><input type="checkbox" value="Apr" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Apr</span></label>
          <label><input type="checkbox" value="May" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">May</span></label>
          <label><input type="checkbox" value="Jun" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Jun</span></label>
          <label><input type="checkbox" value="Jul" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Jul</span></label>
          <label><input type="checkbox" value="Aug" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Aug</span></label>
          <label><input type="checkbox" value="Sep" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Sep</span></label>
          <label><input type="checkbox" value="Oct" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Oct</span></label>
          <label><input type="checkbox" value="Nov" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Nov</span></label>
          <label><input type="checkbox" value="Dec" onchange="update_drop_btn(\x27panel-drop-month\x27);filter_and_sort()"><span class="dot" style="background:#78909C;opacity:.6"></span><span class="lbl-text">Dec</span></label>
        </div>
      </div>
      <span id="tbl-count" style="margin-left:auto;font-size:.72rem;color:#999"></span>
      <!-- Column picker -->
      <div class="multi-drop" id="drop-cols">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-cols')" title="Show/hide columns">⊞ Columns ▾</button>
        <div class="multi-drop-panel" id="panel-drop-cols" style="min-width:200px;right:0;left:auto">
          <div class="col-pick-group">2025</div>
          <label><input type="checkbox" id="col-sid25" onchange="toggle_col('sid25',this.checked)"><span class="lbl-text">Sanction ID 25</span></label>
          <label><input type="checkbox" id="col-date25" onchange="toggle_col('date25',this.checked)"><span class="lbl-text">Date 25</span></label>
          <div class="col-pick-group">2026</div>
          <label><input type="checkbox" id="col-sid26" onchange="toggle_col('sid26',this.checked)"><span class="lbl-text">Sanction ID 26</span></label>
          <label><input type="checkbox" id="col-date26" onchange="toggle_col('date26',this.checked)"><span class="lbl-text">Date 26</span></label>
        </div>
      </div>
      <button class="chart-btn" onclick="export_table_csv()" title="Download all visible rows as CSV">⬇ Export CSV</button>
    </div>
    <!-- Active filter chips — updated by filter_and_sort() -->
    <div class="filter-bar" id="filter-bar">
      <span class="filter-bar-lbl">Filters:</span>
    </div>
    <!-- Dynamic segment count bar — updated by filter_and_sort() -->
    <div class="seg-bar" id="seg-bar"></div>
    <button id="tbl-more" onclick="load_all()" style="display:none;margin-bottom:8px;padding:6px 14px;border:1px solid #1565C0;border-radius:5px;background:#fff;color:#1565C0;font-size:.78rem;cursor:pointer;font-family:inherit">Show all events</button>
    <div class="tbl-wrap">
      <table id="evt-tbl">
        <thead>
          <tr>
            <th style="width:42px;min-width:42px;cursor:default">#</th>
            <th data-col="seg">Segment</th><th data-col="conf">Conf</th><th data-col="type">Type</th>
            <th data-col="m25">Mo 25</th>
            <th class="col-sid25" data-col="sid25" style="font-size:.72rem">Sanction ID 25</th>
            <th class="col-date25" data-col="date25" style="font-size:.72rem">Date 25</th>
            <th data-col="name25">2025 Event Name</th>
            <th data-col="day25">Day</th><th data-col="st25">Status 25</th>
            <th data-col="m26">Mo 26</th>
            <th class="col-sid26" data-col="sid26" style="font-size:.72rem">Sanction ID 26</th>
            <th class="col-date26" data-col="date26" style="font-size:.72rem">Date 26</th>
            <th data-col="name26">2026 Event Name</th>
            <th data-col="day26">Day</th><th data-col="st26">Status 26</th>
          </tr>
        </thead>
        <tbody id="tbl-body"></tbody>
      </table>
    </div>
  </div>
</div>
` : ''}

<div class="row" style="margin-bottom:10px">
  <div class="card card-full" style="display:flex;gap:12px;align-items:center;padding:12px 16px">
    <span style="font-size:.75rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap">Download:</span>
    <a href="./2026_event_calendar_analysis_v9f.xlsx" download
       style="display:inline-flex;align-items:center;gap:6px;background:#1E7D34;color:#fff;padding:7px 14px;border-radius:6px;font-size:.78rem;font-weight:600;text-decoration:none">
      📊 Excel Workbook</a>
    <a href="./event_trends_summary_v3.pptx" download
       style="display:inline-flex;align-items:center;gap:6px;background:#BF1B2C;color:#fff;padding:7px 14px;border-radius:6px;font-size:.78rem;font-weight:600;text-decoration:none">
      📑 PowerPoint Deck</a>
    <span style="font-size:.72rem;color:#aaa;margin-left:auto">Both files are in the same folder as this dashboard</span>
  </div>
</div>

<div class="footer">
  ${ya} vs ${yb} · Retained ${seg.Retained ?? 0} · Shifted ${seg.Shifted ?? 0} · Lost ${seg.Lost ?? 0} · New ${seg.New ?? 0} · Recovered ${seg.Recovered ?? 0} · Tried to Return ${seg['Tried to Return'] ?? 0}
  ${ov_count ? ` · ${ov_count} override(s) active` : ''}
</div>

<script>
const MONTH_N25 = ${JSON.stringify(month_n25)};
const MONTH_DELTA= ${JSON.stringify(month_n26.map((v,i)=>v-month_n25[i]))};
const TYPE_DELTA_PCT = ${JSON.stringify(TYPES.map((_,i) => { const n=type_n25[i]; return n ? parseFloat(((type_deltas[i]/n)*100).toFixed(1)) : 0; }))};
const MONTH_N26 = ${JSON.stringify(month_n26)};
const RAW   = ${JSON.stringify(raw_deltas)};
const MONTH_PCT = ${JSON.stringify(month_n25.map((n,i) => n ? parseFloat((raw_deltas[i]/n*100).toFixed(1)) : 0))};
const ORG   = ${JSON.stringify(org_deltas)};
const MLBLS = ${JSON.stringify(month_labels)};
const TN25  = ${JSON.stringify(type_n25)};
const TN26  = ${JSON.stringify(type_n26)};
const TDELT = ${JSON.stringify(type_deltas)};
const TRPCT = ${JSON.stringify(type_raw_pct)};
const TOPCT = ${JSON.stringify(type_org_pct)};
const SLBLS = ${JSON.stringify(seg_labels)};
const SVALS = ${JSON.stringify(seg_values)};
const SCLR  = ${JSON.stringify(seg_colors)};
const TYPES_  = ${JSON.stringify(TYPES)};
const TCLR  = ${JSON.stringify(TYPES.map(t => TYPE_COLOR[t]))};
const CAL_D  = ${JSON.stringify(month_labels.map((_,i)=>{ const ci=cal_raw[i]; return ci ? parseFloat((ci.calTotal??0).toFixed(1)) : 0; }))};
const SAT_D  = ${JSON.stringify(month_labels.map((_,i)=>{ const ci=cal_raw[i]; return ci?.ds??0; }))};
const SUN_D  = ${JSON.stringify(month_labels.map((_,i)=>{ const ci=cal_raw[i]; return ci?.du??0; }))};
const WKND25 = ${JSON.stringify(month_labels.map((_,i)=>{ const ci=cal_raw[i]; return ci?.w25??0; }))};
const WKND26 = ${JSON.stringify(month_labels.map((_,i)=>{ const ci=cal_raw[i]; return ci?.w26??0; }))};
const CHARTS = {};       // Chart.js instances
const CHART_SNAP = {};  // Raw data snapshots for reliable expand/export (set after each chart init)
const CALPTS= ${JSON.stringify(cal_points)};

Chart.defaults.font.family = "'Segoe UI',system-ui,Arial,sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#555';

// Reusable value-label plugin for bar charts
const value_label_plugin = {
  id: 'value_labels',
  afterDatasetsDraw(chart, _, opts) {
    if(!opts.show) return;
    const ctx = chart.ctx;
    ctx.save();
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if(meta.hidden) return;
      meta.data.forEach((bar, ji) => {
        const val = ds.data[ji];
        if(val == null || val === 0) return;
        ctx.fillStyle = opts.color || '#333';
        ctx.font = (opts.bold ? 'bold ' : '') + (opts.size || 10) + 'px Segoe UI,Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(val, bar.x, bar.y - 2);
      });
    });
    ctx.restore();
  }
};
Chart.register(value_label_plugin);

// Plugin: draw count values INSIDE bars (centered vertically)
const inside_label_plugin = {
  id: 'inside_labels',
  afterDatasetsDraw(chart, _, opts) {
    if(!opts.show) return;
    const ctx = chart.ctx;
    ctx.save();
    chart.data.datasets.forEach(function(ds, di){
      // Skip line datasets
      if(ds.type === 'line') return;
      const meta = chart.getDatasetMeta(di);
      if(meta.hidden) return;
      meta.data.forEach(function(bar, ji){
        const val = ds.data[ji];
        if(val == null || val === 0) return;
        const bar_h = Math.abs(bar.base - bar.y);
        // Only draw inside if bar is tall enough
        if(bar_h < (opts.min_h || 18)) return;
        const cx = bar.x;
        const cy = bar.y + (bar.base - bar.y) / 2;
        ctx.fillStyle   = opts.color || '#fff';
        ctx.font        = 'bold ' + (opts.size || 10) + 'px Segoe UI,Arial';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(val.toLocaleString(), cx, cy);
      });
    });
    ctx.restore();
  }
};
Chart.register(inside_label_plugin);

// Plugin: draw variance Δ labels above the 2nd dataset's bars
const delta_label_plugin = {
  id: 'delta_labels',
  afterDatasetsDraw(chart, _, opts) {
    if(!opts.show || !opts.deltas) return;
    const ctx  = chart.ctx;
    const meta = chart.getDatasetMeta(opts.dataset_index ?? 1);
    if(!meta || meta.hidden) return;
    ctx.save();
    meta.data.forEach((bar, i) => {
      const d = opts.deltas[i];
      if(d == null) return;
      const sign   = d >= 0 ? '+' : '';
      const pct    = opts.pcts ? opts.pcts[i] : null;
      const label  = sign + d + (pct != null ? ' ('+sign+pct+'%)' : '');
      const col    = d > 0 ? '#1E7D34' : d < 0 ? '#C62828' : '#888';
      ctx.fillStyle = col;
      ctx.font = 'bold 9px Segoe UI,Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, bar.x, bar.y - 4);
    });
    ctx.restore();
  }
};
Chart.register(delta_label_plugin);

// 1. Monthly bar + organic line (with value labels on organic points)
CHARTS['c_monthly'] = new Chart(document.getElementById('c_monthly'),{
  type:'bar',
  data:{
    labels:MLBLS,
    datasets:[
      {label:'Raw Δ',data:RAW,order:2,
       backgroundColor:RAW.map(v=>v>0?'rgba(30,125,52,.7)':v<0?'rgba(198,40,40,.7)':'rgba(120,120,120,.3)'),
       borderColor:RAW.map(v=>v>0?'#1E7D34':v<0?'#C62828':'#888'),borderWidth:1},
      {label:'Organic Δ (raw minus calendar effect)',data:ORG,type:'line',order:1,
       borderColor:'#E65100',backgroundColor:'rgba(230,81,0,.08)',
       borderWidth:2,pointRadius:4,pointBackgroundColor:'#E65100',tension:.3,fill:false},
      {label:'Calendar expected Δ',data:CAL_D,type:'line',order:0,
       borderColor:'#7B1FA2',backgroundColor:'rgba(123,31,162,.08)',
       borderWidth:1.5,pointRadius:3,pointBackgroundColor:'#7B1FA2',
       borderDash:[5,3],tension:.3,fill:false}
    ]
  },
  plugins:[{
    id:'org_pts',
    afterDatasetsDraw(chart){
      const meta1 = chart.getDatasetMeta(1); // organic line
      if(!meta1||meta1.hidden) return;
      const ctx = chart.ctx;
      ctx.save();
      meta1.data.forEach((pt,i)=>{
        const v = ORG[i];
        if(v==null) return;
        const rv = Math.round(v*10)/10;
        ctx.fillStyle = '#E65100';
        ctx.font = 'bold 9px Segoe UI,Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = rv>=0?'bottom':'top';
        ctx.fillText((rv>=0?'+':'')+rv, pt.x, pt.y+(rv>=0?-5:5));
      });
      ctx.restore();
    }
  }],
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{position:'top',labels:{boxWidth:11,padding:10}},
      tooltip:{mode:'index',intersect:false,callbacks:{
        label:ctx=>{
          const v=Math.round(ctx.parsed.y*10)/10;
          const sign=v>=0?'+':'';
          if(ctx.datasetIndex===0) return ' Raw Δ: '+sign+v;
          if(ctx.datasetIndex===1) return ' Organic Δ: '+sign+v+' (raw minus calendar effect)';
          if(ctx.datasetIndex===2) return ' Calendar expected: '+sign+v;
          return '';
        }
      }},
      delta_labels:{show:true, deltas:RAW, pcts:MONTH_PCT, dataset_index:0},
      inside_labels:{show:true, color:'#fff', size:9, min_h:18}
    },
    scales:{y:{grid:{color:'#eee'},ticks:{callback:v=>(v>0?'+':'')+v}}}
  }
});
CHART_SNAP['c_monthly'] = { type:'bar', labels:MLBLS.slice(), datasets:[
  {label:'Raw Δ',data:RAW.slice(),backgroundColor:RAW.map(function(v){return v>0?'rgba(30,125,52,.7)':v<0?'rgba(198,40,40,.7)':'rgba(120,120,120,.3)';}),borderWidth:1},
  {label:'Organic Δ',data:ORG.slice(),type:'line',borderColor:'#E65100',borderWidth:2,pointRadius:4,fill:false},
  {label:'Calendar expected Δ',data:CAL_D.slice(),type:'line',borderColor:'#7B1FA2',borderWidth:1.5,pointRadius:3,borderDash:[5,3],fill:false}
]};

// 2. Segment donut
// Segment donut — draws count + pct label inside each arc
const seg_label_plugin = {
  id: 'seg_labels',
  afterDatasetsDraw(chart) {
    const ds  = chart.data.datasets[0];
    const meta= chart.getDatasetMeta(0);
    const tot = ds.data.reduce(function(a,b){return a+b;},0);
    const ctx = chart.ctx;
    ctx.save();
    meta.data.forEach(function(arc, i){
      const val = ds.data[i];
      if(!val || arc.endAngle - arc.startAngle < 0.18) return; // skip tiny slices
      const pct = Math.round(val/tot*100);
      const mid = arc.startAngle + (arc.endAngle - arc.startAngle)/2;
      const r   = (arc.outerRadius + arc.innerRadius) / 2;
      const x   = arc.x + Math.cos(mid)*r;
      const y   = arc.y + Math.sin(mid)*r;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = 'bold 10px Segoe UI,Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(val.toLocaleString(), x, y+1);
      ctx.font = '9px Segoe UI,Arial';
      ctx.textBaseline = 'top';
      ctx.fillText('('+pct+'%)', x, y+2);
    });
    ctx.restore();
  }
};
Chart.register(seg_label_plugin);

CHARTS['c_segment'] = new Chart(document.getElementById('c_segment'),{
  type:'doughnut',
  data:{labels:SLBLS,datasets:[{data:SVALS,backgroundColor:SCLR,borderWidth:2,borderColor:'#fff'}]},
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{
      seg_labels:{},
      legend:{position:'bottom',labels:{boxWidth:11,padding:8,
        generateLabels:function(chart){
          const ds=chart.data.datasets[0];
          const tot=ds.data.reduce(function(a,b){return a+b;},0);
          return chart.data.labels.map(function(lbl,i){
            return {text:lbl+'  '+ds.data[i].toLocaleString()+' ('+Math.round(ds.data[i]/tot*100)+'%)',
                    fillStyle:ds.backgroundColor[i],strokeStyle:'#fff',lineWidth:1,index:i};
          });
        }
      }},
      tooltip:{callbacks:{label:ctx=>' '+ctx.label+': '+ctx.parsed+' ('+Math.round(ctx.parsed/${n_baseline}*100)+'%)'}}
    }
  }
});
CHART_SNAP['c_segment'] = { type:'doughnut', labels:SLBLS.slice(), datasets:[{label:'Segments',data:SVALS.slice(),backgroundColor:SCLR,borderWidth:2,borderColor:'#fff'}] };

// 3. Type grouped bar
CHARTS['c_type'] = new Chart(document.getElementById('c_type'),{
  type:'bar',
  data:{
    labels:TYPES_,
    datasets:[
      {label:'${ya}',data:TN25,backgroundColor:'rgba(55,71,79,.5)',borderColor:'#37474F',borderWidth:1},
      {label:'${yb}',data:TN26,backgroundColor:TCLR.map(c=>c+'CC'),borderColor:TCLR,borderWidth:1}
    ]
  },
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{position:'top',labels:{boxWidth:11}},
      tooltip:{callbacks:{
        label:ctx=>{
          const v=ctx.parsed.y, yr=ctx.datasetIndex===0?'${ya}':'${yb}';
          return ' '+yr+': '+v.toLocaleString()+' events';
        },
        afterLabel:ctx=>{
          if(ctx.datasetIndex!==1) return '';
          const d=TDELT[ctx.dataIndex], p=TYPE_DELTA_PCT[ctx.dataIndex];
          return ' Change: '+(d>=0?'+':'')+d+' ('+(p>=0?'+':'')+p+'%)';
        }
      }},
      delta_labels:{show:true, deltas:TDELT, pcts:TYPE_DELTA_PCT, dataset_index:1},
      inside_labels:{show:true, color:'#fff', size:11, min_h:22}
    },
    scales:{y:{beginAtZero:true,grid:{color:'#eee'},ticks:{callback:v=>v.toLocaleString()}}}
  }
});
CHART_SNAP['c_type'] = { type:'bar', labels:TYPES_.slice(), datasets:[
  {label:'2025',data:TN25.slice(),backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
  {label:'2026',data:TN26.slice(),backgroundColor:TCLR.map(function(col){return col+'CC';}),borderColor:TCLR,borderWidth:1}
]};

// 4. Event count by month comparison: 2025 vs 2026 side-by-side bar
CHARTS['c_organic'] = new Chart(document.getElementById('c_organic'),{
  type:'bar',
  data:{
    labels:MLBLS,
    datasets:[
      {label:'2025',data:MONTH_N25,backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
      {label:'2026',data:MONTH_N26,
       backgroundColor:MONTH_N26.map((v,i)=>v<MONTH_N25[i]?'rgba(198,40,40,.7)':v>MONTH_N25[i]?'rgba(30,125,52,.7)':'rgba(21,101,192,.55)'),
       borderColor:MONTH_N26.map((v,i)=>v<MONTH_N25[i]?'#C62828':v>MONTH_N25[i]?'#1E7D34':'#1565C0'),borderWidth:1}
    ]
  },
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{position:'top',labels:{boxWidth:11}},
      tooltip:{mode:'index',intersect:false,callbacks:{
        label:ctx=>{
          const v=ctx.parsed.y, yr=ctx.datasetIndex===0?'${ya}':'${yb}';
          return ' '+yr+': '+v.toLocaleString()+' events';
        },
        afterBody:items=>{
          const i=items[0].dataIndex, d=MONTH_DELTA[i];
          const pct=MONTH_N25[i]?((d/MONTH_N25[i])*100).toFixed(1):'—';
          return ['Change: '+(d>=0?'+':'')+d+' ('+(d>=0?'+':'')+pct+'%)'];
        }
      }},
      delta_labels:{show:true, deltas:MONTH_DELTA, dataset_index:1},
      inside_labels:{show:true, color:'#fff', size:9, min_h:18}
    },
    scales:{y:{beginAtZero:false,grid:{color:'#eee'},ticks:{stepSize:20}},x:{grid:{display:false}}}
  }
});
CHART_SNAP['c_organic'] = { type:'bar', labels:MLBLS.slice(), datasets:[
  {label:'2025',data:MONTH_N25.slice(),backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
  {label:'2026',data:MONTH_N26.slice(),backgroundColor:MONTH_N26.map(function(v,i){return v<MONTH_N25[i]?'rgba(198,40,40,.7)':v>MONTH_N25[i]?'rgba(30,125,52,.7)':'rgba(21,101,192,.55)';}),borderColor:MONTH_N26.map(function(v,i){return v<MONTH_N25[i]?'#C62828':v>MONTH_N25[i]?'#1E7D34':'#1565C0';}),borderWidth:1}
]};

// 5. Weekend day shifts: Saturday Δ and Sunday Δ per month
CHARTS['c_calendar'] = new Chart(document.getElementById('c_calendar'),{
  type:'bar',
  data:{
    labels:MLBLS,
    datasets:[
      {label:'Saturday Δ',data:SAT_D,borderRadius:3,borderWidth:1.5,
       backgroundColor:SAT_D.map(v=>v>0?'rgba(30,125,52,.75)':v<0?'rgba(198,40,40,.75)':'rgba(180,180,180,.15)'),
       borderColor:SAT_D.map(v=>v>0?'#1E7D34':v<0?'#C62828':'transparent')},
      {label:'Sunday Δ',data:SUN_D,borderRadius:3,borderWidth:1.5,
       backgroundColor:SUN_D.map(v=>v>0?'rgba(21,101,192,.75)':v<0?'rgba(230,81,0,.75)':'rgba(180,180,180,.15)'),
       borderColor:SUN_D.map(v=>v>0?'#1565C0':v<0?'#E65100':'transparent')}
    ]
  },
  options:{responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{position:'top',labels:{boxWidth:11}},
      tooltip:{mode:'index',intersect:false,callbacks:{
        afterBody:items=>{
          const i=items[0].dataIndex;
          return ['Weekend days: '+WKND25[i]+' → '+WKND26[i]+(WKND26[i]-WKND25[i]!==0?' (Δ '+(WKND26[i]-WKND25[i]>0?'+':'')+(WKND26[i]-WKND25[i])+')':'  (no change)')];
        }
      }}
    },
    scales:{
      y:{grid:{color:'#eee'},ticks:{stepSize:1,callback:v=>v===0?'0':v>0?'+'+v:v},min:-2,max:2,
         title:{display:true,text:'Day count change',font:{size:9}}},
      x:{grid:{display:false}}
    }
  }
});
CHART_SNAP['c_calendar'] = { type:'bar', labels:MLBLS.slice(), datasets:[
  {label:'Saturday Δ',data:SAT_D.slice(),backgroundColor:SAT_D.map(function(v){return v>0?'rgba(30,125,52,.75)':v<0?'rgba(198,40,40,.75)':'rgba(180,180,180,.2)';}),borderWidth:1.5},
  {label:'Sunday Δ',data:SUN_D.slice(),backgroundColor:SUN_D.map(function(v){return v>0?'rgba(21,101,192,.75)':v<0?'rgba(230,81,0,.75)':'rgba(180,180,180,.2)';}),borderWidth:1.5}
]};

// ── Chart ↔ Table flip ───────────────────────────────────────────────────────
// Toggle between canvas and a plain HTML data table. Fully reversible.
function flip_chart_table(id) {
  var canvas  = document.getElementById(id);
  var tbl_div = document.getElementById('flip-tbl-'+id);
  var btn     = document.getElementById('flip-btn-'+id);
  if (!canvas || !tbl_div) return;
  var is_table_mode = (canvas.style.display === 'none');
  if (is_table_mode) {
    canvas.style.display  = '';
    tbl_div.style.display = 'none';
    if (btn) { btn.textContent='⇄ Table'; btn.title='Switch to table view'; btn.classList.remove('flip-btn-active'); }
  } else {
    canvas.style.display = 'none';
    if (!tbl_div.dataset.built) { tbl_div.innerHTML = _build_flip_html(id); tbl_div.dataset.built='1'; }
    tbl_div.style.display = 'block';
    tbl_div.style.height  = canvas.parentElement.style.height || '260px';
    if (btn) { btn.textContent='📊 Chart'; btn.title='Switch back to chart'; btn.classList.add('flip-btn-active'); }
  }
}

function _build_flip_html(id) {
  var chart = CHARTS[id];
  if (!chart) return '<p style="padding:12px;color:#999">No data</p>';
  var labels   = chart.data.labels   || [];
  var datasets = chart.data.datasets || [];
  var is_donut   = (id === 'c_segment');
  var is_delta   = (id === 'c_monthly' || id === 'c_calendar');
  // Count-compare charts: 2 bar datasets (2025 vs 2026) → add Δ and Δ% columns
  var is_compare = (id === 'c_organic' || id === 'c_type');

  // Only include datasets that have values; skip invisible overlays
  var ds_shown = datasets.filter(function(ds){
    return ds.data && ds.data.some(function(v){ return v != null; });
  });

  // ── Formatting helpers ────────────────────────────────────────────────────
  function num(v)  { return (v != null && typeof v === 'number') ? v : null; }
  function sign(v) { return v >= 0 ? '+' : ''; }

  // Colored delta cell (abs + %)
  function delta_cell(abs, base) {
    if (abs == null) return '<td>—</td><td>—</td>';
    var s_abs = sign(abs) + abs.toLocaleString();
    var pct   = base ? parseFloat((abs / base * 100).toFixed(1)) : null;
    var s_pct = pct != null ? sign(pct) + pct + '%' : '—';
    var col   = abs > 0 ? '#1E7D34' : abs < 0 ? '#C62828' : '#888';
    var sty   = 'color:'+col+';font-weight:600';
    return '<td style="'+sty+'">'+s_abs+'</td>'
         + '<td style="'+sty+';opacity:.85">'+s_pct+'</td>';
  }

  // Plain value cell
  function val_cell(v, ds_type, force_delta) {
    if (v == null) return '<td><span style="color:#ccc">—</span></td>';
    if (typeof v !== 'number') return '<td>'+v+'</td>';
    var r   = Math.round(v * 10) / 10;
    var use_delta = is_delta || force_delta || ds_type === 'line';
    var s   = use_delta ? sign(r) + r : r.toLocaleString();
    var col = (is_delta || force_delta) ? (r > 0 ? '#1E7D34' : r < 0 ? '#C62828' : '#888') : '';
    return '<td'+(col?' style="color:'+col+';font-weight:600"':'')+'>'+s+'</td>';
  }

  // ── Build header ──────────────────────────────────────────────────────────
  var hdr = '<tr><th>' + (is_donut ? 'Segment' : 'Label') + '</th>';
  ds_shown.forEach(function(ds) { hdr += '<th>' + (ds.label || '—') + '</th>'; });
  if (is_compare)          hdr += '<th>Δ Abs</th><th>Δ %</th>';
  if (is_donut)            hdr += '<th>% of total</th>';
  if (id === 'c_monthly')  hdr += '<th>% of 2025</th>';
  hdr += '</tr>';

  // ── Dataset totals ────────────────────────────────────────────────────────
  var totals = ds_shown.map(function(ds) {
    return ds.data.reduce(function(a, v) { return a + (num(v) || 0); }, 0);
  });
  var seg_tot = is_donut ? (totals[0] || 1) : 0;

  // ── Rows ──────────────────────────────────────────────────────────────────
  var rows = '';
  labels.forEach(function(lbl, i) {
    rows += '<tr><td>' + lbl + '</td>';
    ds_shown.forEach(function(ds) { rows += val_cell(num(ds.data[i]), ds.type, false); });

    if (is_compare) {
      // ds_shown[0] = 2025 (bar), ds_shown[1] = 2026 (bar)
      var v25 = num(ds_shown[0] && ds_shown[0].data[i]);
      var v26 = num(ds_shown[1] && ds_shown[1].data[i]);
      rows += delta_cell(v25 != null && v26 != null ? v26 - v25 : null, v25);
    }
    if (is_donut) {
      var v = num(ds_shown[0] && ds_shown[0].data[i]);
      var pct = v != null ? Math.round(v / seg_tot * 100) : 0;
      rows += '<td style="color:#888">' + pct + '%</td>';
    }
    if (id === 'c_monthly') {
      // MONTH_N25 is a global array of 2025 counts per month
      var base = (typeof MONTH_N25 !== 'undefined') ? (MONTH_N25[i] || 0) : 0;
      var raw  = num(ds_shown[0] && ds_shown[0].data[i]); // Raw Δ is dataset 0
      var pct_val = (base && raw != null) ? parseFloat((raw / base * 100).toFixed(1)) : null;
      var pct_s   = pct_val != null ? sign(pct_val) + pct_val + '%' : '—';
      var pct_col = pct_val != null ? (pct_val > 0 ? '#1E7D34' : pct_val < 0 ? '#C62828' : '#888') : '#888';
      rows += '<td style="color:' + pct_col + ';font-weight:600">' + pct_s + '</td>';
    }
    rows += '</tr>';
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  var foot = '';
  if (!is_donut) {
    foot = '<tfoot><tr><td>Total / Sum</td>';
    ds_shown.forEach(function(ds, di) { foot += val_cell(totals[di], ds.type, false); });
    if (is_compare) {
      var t25 = totals[0], t26 = totals[1];
      foot += delta_cell(t26 - t25, t25);
    }
    if (id === 'c_monthly') {
      // Overall % change using sum of MONTH_N25 as base
      var total_n25 = (typeof MONTH_N25 !== 'undefined') ? MONTH_N25.reduce(function(a,b){return a+b;},0) : 0;
      var total_raw = totals[0];
      var ov_pct = total_n25 ? parseFloat((total_raw / total_n25 * 100).toFixed(1)) : null;
      var ov_s   = ov_pct != null ? sign(ov_pct) + ov_pct + '%' : '—';
      var ov_col = ov_pct != null ? (ov_pct > 0 ? '#1E7D34' : ov_pct < 0 ? '#C62828' : '#888') : '#888';
      foot += '<td style="color:' + ov_col + ';font-weight:600">' + ov_s + '</td>';
    }
    foot += '</tr></tfoot>';
  }

  return '<table><thead>' + hdr + '</thead><tbody>' + rows + '</tbody>' + foot + '</table>';
}

// ── Event roster table ────────────────────────────────────────────────────
const ROSTER = ROSTER_PLACEHOLDER;
if(ROSTER && ROSTER.length > 0){
  const SEG_CLS = {'Retained':'Retained','Shifted':'Shifted','Lost':'Lost',
    'New':'New','Recovered':'Recovered','Tried to Return':'TtR'};
  const SEG_ORDER = {'Retained':0,'Shifted':1,'Tried to Return':2,'Lost':3,'Recovered':4,'New':5};
  let sort_col = '_excel', sort_dir = 1;

  const PAGE_SIZE = 20;
  let current_rows = [];

  let _row_num = 0;
  function row_html(r){
    const sc = SEG_CLS[r.seg] || r.seg.replace(/\s/g,'.');
    _row_num++;
    return '<tr>' +
      '<td style="color:#bbb;text-align:right;font-size:.7rem;padding-right:8px;font-variant-numeric:tabular-nums">'+_row_num+'</td>' +
      '<td><span class="seg-'+sc+'">'+r.seg+'</span></td>' +
      '<td>'+r.conf+'</td><td>'+r.type+'</td>' +
      '<td>'+r.m25+'</td>' +
      '<td class="col-sid25" style="font-size:.7rem;color:#666;font-family:monospace">'+r.sid25+'</td>' +
      '<td class="col-date25" style="font-size:.7rem;color:#666;white-space:nowrap">'+r.date25+'</td>' +
      '<td class="name-col">'+r.name25+'</td>' +
      '<td>'+r.day25+'</td>' +
      '<td class="st-col">'+r.st25+'</td>' +
      '<td style="color:'+(r.m26&&r.m26!==r.m25?'#E65100':'inherit')+'">'+r.m26+'</td>' +
      '<td class="col-sid26" style="font-size:.7rem;color:#666;font-family:monospace">'+r.sid26+'</td>' +
      '<td class="col-date26" style="font-size:.7rem;color:#666;white-space:nowrap">'+r.date26+'</td>' +
      '<td class="name-col">'+r.name26+'</td>' +
      '<td>'+r.day26+'</td>' +
      '<td class="st-col">'+r.st26+'</td>' +
      '</tr>';
  }

  function load_all(){
    const tbody = document.getElementById('tbl-body');
    if(!tbody) return;
    _row_num = 0;
    tbody.innerHTML = current_rows.map(row_html).join('');
    const cnt = document.getElementById('tbl-count');
    if(cnt) cnt.textContent = current_rows.length.toLocaleString()+' events shown';
    const btn = document.getElementById('tbl-more');
    if(btn) btn.style.display='none';
  }

  // Segment bar config: label → { color, bg }
  const SEG_CHIP_STYLE = {
    'Retained':        {color:'#1E7D34', bg:'#E8F5E9'},
    'Shifted':         {color:'#E65100', bg:'#FFF3E0'},
    'Tried to Return': {color:'#BF360C', bg:'#FBE9E7'},
    'Lost':            {color:'#C62828', bg:'#FFEBEE'},
    'Recovered':       {color:'#6A1B9A', bg:'#F3E5F5'},
    'New':             {color:'#1565C0', bg:'#E3F2FD'},
  };
  const SEG_ORDER_LIST = ['Retained','Shifted','Tried to Return','Lost','Recovered','New'];

  function render_seg_summary(rows){
    const bar = document.getElementById('seg-bar');
    if(!bar) return;
    const total = rows.length;
    // Count by segment in the current visible rows
    const counts = {};
    SEG_ORDER_LIST.forEach(function(s){ counts[s] = 0; });
    rows.forEach(function(r){ if(counts[r.seg] !== undefined) counts[r.seg]++; });
    // Which segments are currently checked in the dropdown?
    const active_segs = new Set(get_checked('panel-drop-seg'));

    bar.innerHTML = SEG_ORDER_LIST.map(function(seg){
      const n      = counts[seg];
      const pct    = total ? Math.round(n/total*100) : 0;
      const st     = SEG_CHIP_STYLE[seg] || {color:'#555',bg:'#eee'};
      const is_active = active_segs.has(seg);
      const classes = 'seg-chip'
        + (n===0 && !is_active ? ' zero' : '')
        + (is_active ? ' active' : '');
      // Active: solid border; inactive: faint border
      const border_col = is_active ? st.color : st.color+'33';
      const bg_col     = is_active ? st.color+'22' : st.bg;
      return '<span class="'+classes+'"'
           + ' style="background:'+bg_col+';border-color:'+border_col+';color:'+st.color+'"'
           + ' title="'+(is_active?'Remove filter: ':'Filter by: ')+seg+'"'
           + ' data-seg="'+seg+'" onclick="toggle_seg_chip(this.dataset.seg)">'
           + '<span class="chip-dot" style="background:'+st.color+'"></span>'
           + seg+' <strong>'+n.toLocaleString()+'</strong>'
           + '<span class="chip-pct">('+pct+'%)</span>'
           + (is_active ? '<span class="chip-x">✕</span>' : '')
           + '</span>';
    }).join('')
    + (total > 0 ? '<span class="seg-bar-total">'+total.toLocaleString()+' events shown</span>' : '');
  }

  // Toggle a segment chip: checks/unchecks it in the dropdown and re-filters
  function toggle_seg_chip(seg) {
    const cb = document.querySelector('#panel-drop-seg input[value="'+seg+'"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    update_drop_btn('drop-seg');
    filter_and_sort();
  }

  function render_table(rows){
    current_rows = rows;
    const tbody = document.getElementById('tbl-body');
    if(!tbody) return;
    _row_num = 0;
    tbody.innerHTML = rows.slice(0, PAGE_SIZE).map(row_html).join('');
    const cnt = document.getElementById('tbl-count');
    if(cnt) cnt.textContent = Math.min(PAGE_SIZE,rows.length)+' of '+rows.length.toLocaleString()+' shown';
    const btn = document.getElementById('tbl-more');
    if(btn){
      btn.style.display = rows.length > PAGE_SIZE ? '' : 'none';
      btn.textContent   = 'Show all '+rows.length.toLocaleString()+' events ↓';
    }
    render_seg_summary(rows);
  }

  function export_table_csv(){
    const headers = ['#','Segment','Confidence','Type','Month 2025','2025 Sanction ID','2025 Date','2025 Day','2025 Event Name','2025 Status','Month 2026','2026 Sanction ID','2026 Date','2026 Day','2026 Event Name','2026 Status'];
    const rows = [headers.join(',')];
    current_rows.forEach((r,i)=>{
      const q = v=>'"'+String(v||'').replace(/"/g,'""')+'"';
      rows.push([i+1,q(r.seg),q(r.conf),q(r.type),r.m25,q(r.sid25),r.date25||'',r.day25||'',q(r.name25),r.st25||'',r.m26,q(r.sid26),r.date26||'',r.day26||'',q(r.name26),r.st26||''].join(','));
    });
    const a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(rows.join('\\n'));
    a.download='event_roster.csv'; a.click();
  }

  function get_checked(panel_id){
    return Array.from(document.querySelectorAll('#'+panel_id+' input:checked')).map(function(el){return el.value;});
  }
  function drop_all(panel_id, check){
    document.querySelectorAll('#'+panel_id+' input[type=checkbox]').forEach(function(cb){cb.checked=check;});
    var drop_id = panel_id.replace(/^panel-/,'');
    update_drop_btn(drop_id);
    filter_and_sort();
  }
  function toggle_col(col_name, visible){
    var tbl = document.getElementById('evt-tbl');
    if(!tbl) return;
    if(visible) tbl.classList.add('show-'+col_name);
    else        tbl.classList.remove('show-'+col_name);
    // Persist choice in localStorage if available
    try { localStorage.setItem('col_'+col_name, visible ? '1' : '0'); } catch(e){}
  }
  // Restore saved column preferences on load
  (function restore_col_prefs(){
    ['sid25','date25','sid26','date26'].forEach(function(col){
      var saved;
      try { saved = localStorage.getItem('col_'+col); } catch(e){}
      if(saved === '1'){
        toggle_col(col, true);
        var cb = document.getElementById('col-'+col);
        if(cb) cb.checked = true;
      }
    });
  })();
  function update_drop_btn(drop_id){
    const checked = get_checked('panel-'+drop_id);
    const btn = document.querySelector('#'+drop_id+' .multi-drop-btn');
    if(!btn) return;
    const base = btn.dataset.base || btn.textContent.replace(/ \(\d+\)/,'').replace(' ▾','').trim();
    btn.dataset.base = base;
    if(checked.length===0){ btn.innerHTML = base+' <span style="opacity:.6">▾</span>'; btn.classList.remove('active'); }
    else { btn.innerHTML = base+' <span style="background:#1565C0;color:#fff;border-radius:10px;padding:0 5px;font-size:.7rem;margin-right:2px">'+checked.length+'</span> <span style="opacity:.6">▾</span>'; btn.classList.add('active'); }
  }
  function toggle_drop(drop_id){
    const panel = document.getElementById('panel-'+drop_id);
    const will_open = !panel.classList.contains('open');
    document.querySelectorAll('.multi-drop-panel').forEach(function(p){ p.classList.remove('open'); });
    if(will_open) panel.classList.add('open');
  }
  // Close dropdowns on outside click
  document.addEventListener('click',function(e){
    if(!e.target.closest('.multi-drop')) document.querySelectorAll('.multi-drop-panel').forEach(function(p){p.classList.remove('open');});
  });

  // ── Active filter bar ─────────────────────────────────────────────────────
  const SEG_CHIP_COLORS  = {'Retained':'#2e7d32','Shifted':'#e65100','Tried to Return':'#bf360c','Lost':'#c62828','Recovered':'#6a1b9a','New':'#006064'};
  const TYPE_CHIP_COLORS = {'Adult Race':'#1565C0','Youth Race':'#00897B','Adult Clinic':'#F57C00','Youth Clinic':'#8E24AA'};

  function render_active_filters(q, segs, typs, mons) {
    var bar = document.getElementById('filter-bar');
    if (!bar) return;
    var chips = [];

    // Search text
    if (q) {
      chips.push({label:'Search', value:'“'+q+'”', color:'#555', bg:'#f5f5f5', border:'#ddd',
        clear: function(){
          var el=document.getElementById('tbl-search'); if(el){el.value='';} filter_and_sort();
        }});
    }

    // Segment chips
    segs.forEach(function(s){
      var col = SEG_CHIP_COLORS[s] || '#555';
      chips.push({label:'Segment', value:s, color:col, bg:col+'18', border:col+'44',
        clear: function(){
          var cb=document.querySelector('#panel-drop-seg input[value="'+s+'"]');
          if(cb){cb.checked=false;} update_drop_btn('drop-seg'); filter_and_sort();
        }});
    });

    // Type chips
    typs.forEach(function(t){
      var col = TYPE_CHIP_COLORS[t] || '#555';
      chips.push({label:'Type', value:t, color:col, bg:col+'18', border:col+'44',
        clear: function(){
          var cb=document.querySelector('#panel-drop-type input[value="'+t+'"]');
          if(cb){cb.checked=false;} update_drop_btn('drop-type'); filter_and_sort();
        }});
    });

    // Month chips — group into one chip if >3 selected (to keep bar compact)
    if (mons.length > 0 && mons.length <= 3) {
      mons.forEach(function(m){
        chips.push({label:'Month', value:m, color:'#546E7A', bg:'#ECEFF1', border:'#CFD8DC',
          clear: function(){
            var cb=document.querySelector('#panel-drop-month input[value="'+m+'"]');
            if(cb){cb.checked=false;} update_drop_btn('drop-month'); filter_and_sort();
          }});
      });
    } else if (mons.length > 3) {
      chips.push({label:'Month', value:mons.length+' selected', color:'#546E7A', bg:'#ECEFF1', border:'#CFD8DC',
        clear: function(){ drop_all('panel-drop-month', false); }});
    }

    var has = chips.length > 0;
    bar.className = 'filter-bar' + (has ? ' has-filters' : '');
    var rst = document.getElementById('tbl-reset-btn');
    if (rst) rst.style.display = has ? '' : 'none';
    if (!has) { bar.innerHTML = '<span class="filter-bar-lbl">Filters:</span>'; return; }

    // Build chip HTML — store clear fn index on a data attribute, call via window helper
    window._filter_clears = chips.map(function(c){ return c.clear; });
    bar.innerHTML = '<span class="filter-bar-lbl">Filters active:</span>'
      + chips.map(function(c, i){
          return '<span class="filter-chip" style="background:'+c.bg+';border-color:'+c.border+';color:'+c.color+'">'
               + '<span class="chip-label">'+c.label+':</span>'
               + c.value
               + '<button onclick="window._filter_clears['+i+']()" title="Remove this filter">✕</button>'
               + '</span>';
        }).join('')
      + '<button class="clear-all" onclick="clear_all_filters()">Clear all ✕</button>';
  }

  function clear_all_filters() {
    var el = document.getElementById('tbl-search'); if(el) el.value='';
    ['panel-drop-seg','panel-drop-type','panel-drop-month'].forEach(function(p){
      document.querySelectorAll('#'+p+' input[type=checkbox]').forEach(function(cb){cb.checked=false;});
    });
    ['drop-seg','drop-type','drop-month'].forEach(function(d){ update_drop_btn(d); });
    filter_and_sort();
  }

  function filter_and_sort(){
    const q    = (document.getElementById('tbl-search')?.value || '').toLowerCase();
    const segs = get_checked('panel-drop-seg');
    const typs = get_checked('panel-drop-type');
    const mons = get_checked('panel-drop-month');
    render_active_filters(q, segs, typs, mons);
    let rows = ROSTER.filter(r =>
      (!q          || r.name25.toLowerCase().includes(q) || r.name26.toLowerCase().includes(q)) &&
      (!segs.length || segs.includes(r.seg)) &&
      (!typs.length || typs.includes(r.type)) &&
      (!mons.length || mons.includes(r.m25) || mons.includes(r.m26))
    );
    rows.sort((a,b) => {
      if(sort_col === '_excel'){
        // Default: Excel step_4 order — segment order → month 25 → type → name 25
        const so = (SEG_ORDER[a.seg]??99) - (SEG_ORDER[b.seg]??99);
        if(so!==0) return so;
        const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const mo = MONTHS.indexOf(a.m25) - MONTHS.indexOf(b.m25);
        if(mo!==0) return mo;
        if(a.type<b.type) return -1; if(a.type>b.type) return 1;
        return a.name25 < b.name25 ? -1 : a.name25 > b.name25 ? 1 : 0;
      }
      const av = a[sort_col] ?? '', bv = b[sort_col] ?? '';
      return av < bv ? -sort_dir : av > bv ? sort_dir : 0;
    });
    render_table(rows);
  }

  // Sort on header click
  document.querySelectorAll('#evt-tbl thead th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if(sort_col === col){ sort_dir *= -1; }
      else { sort_col = col; sort_dir = 1; }
      document.querySelectorAll('#evt-tbl thead th').forEach(h => h.classList.remove('asc','desc'));
      th.classList.add(sort_dir === 1 ? 'asc' : 'desc');
      filter_and_sort();
    });
  });

  ['tbl-search','tbl-seg','tbl-type','tbl-month'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', filter_and_sort);
  });

  filter_and_sort(); // initial render
  document.getElementById('tbl-more')?.addEventListener('click', load_all);
}
</script>
<!-- Override Manager + Command Panel -->
<div class="row" style="margin-bottom:10px">
  <div class="card card-full" id="override-panel">
    <h3 style="cursor:pointer;display:flex;align-items:center;gap:10px"
        onclick="this.parentElement.querySelector('.panel-body').classList.toggle('hidden')">
      ⚙ Override Manager &amp; Command Launcher
      <span id="srv-badge" style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;background:#eee;color:#999">
        ● Checking server…
      </span>
      <span style="font-size:.7rem;font-weight:400;color:#aaa;margin-left:4px">Click to expand</span>
    </h3>
    <div class="panel-body hidden">

      <!-- Status bar -->
      <div id="srv-status-bar" style="display:none;align-items:center;gap:10px;margin-bottom:10px;padding:7px 12px;border-radius:6px;background:#E8F5E9;border:1px solid #C8E6C9;font-size:.76rem">
        <span style="color:#2E7D32;font-weight:600">✔ Server connected at localhost:7474</span>
        <span style="color:#555">— overrides are applied live when you click Apply.</span>
        <button class="chart-btn" id="srv-rebuild-btn" style="margin-left:auto;background:#1565C0;color:#fff;border-color:#1565C0"
          onclick="server_rebuild()">▶ Rebuild now</button>
      </div>
      <div id="srv-offline-bar" style="display:none;align-items:center;gap:8px;margin-bottom:10px;padding:7px 12px;border-radius:6px;background:#FFF8E1;border:1px solid #FFE082;font-size:.76rem;flex-wrap:wrap">
        <span style="color:#F57F17;font-weight:600">⚠ Server offline</span>
        <span style="color:#555">— In your terminal run <code style="background:#fffde7;padding:1px 6px;border-radius:4px;font-size:.73rem">node server.js</code> then open
          <a href="http://localhost:7474/dashboard" target="_blank" style="color:#1565C0;font-weight:600">http://localhost:7474/dashboard</a>
          <em style="color:#888;font-size:.71rem">(opening this file directly blocks localhost connections)</em>
        </span>
      </div>
      <!-- Always-visible server tip when opened as file:// -->
      <div id="file-protocol-tip" style="display:none;margin-bottom:8px;padding:6px 12px;border-radius:6px;background:#E3F2FD;border:1px solid #90CAF9;font-size:.74rem;color:#1565C0">
        💡 <strong>Tip:</strong> You opened this as a local file. For live override writing + rebuild, run
        <code style="background:#E3F2FD;font-weight:600">node server.js</code> and visit
        <a href="http://localhost:7474/dashboard" target="_blank" style="font-weight:700">localhost:7474/dashboard</a> instead.
      </div>

      <!-- Rebuild log (shown when rebuild is running) -->
      <div id="rebuild-log" style="display:none;background:#1C2526;color:#80CBC4;border-radius:6px;padding:10px;font-size:.72rem;font-family:monospace;max-height:160px;overflow-y:auto;margin-bottom:10px;line-height:1.6"></div>

      <!-- Two-column layout: active overrides + add new -->
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">

        <!-- Current overrides list -->
        <div style="flex:1;min-width:260px">
          <div style="font-size:.78rem;font-weight:700;color:#555;margin-bottom:6px">
            Active overrides
            <button class="chart-btn" id="srv-refresh-btn" style="margin-left:8px;font-size:.67rem" onclick="load_server_overrides()">↻ Refresh</button>
          </div>
          <div id="ov-list" style="font-size:.75rem;background:#F8F9FA;border-radius:6px;padding:10px;min-height:48px;color:#444;line-height:1.9"></div>
        </div>

        <!-- Add new override form -->
        <div style="flex:2;min-width:280px">
          <div style="font-size:.78rem;font-weight:700;color:#555;margin-bottom:6px">Add new override</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select id="ov-type" style="border:1px solid #ddd;border-radius:5px;padding:5px 8px;font-size:.78rem;font-family:inherit">
                <option value="match">Force Match (link two events)</option>
                <option value="no-match-25">Force Lost (2025 event → mark as Lost)</option>
                <option value="no-match-26">Force New (2026 event → mark as New)</option>
                <option value="segment">Override Segment label</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap" id="ov-fields">
              <input id="ov-sid25" type="text" placeholder="2025 Sanction ID (e.g. 311655-Adult Race)"
                style="flex:1;min-width:200px;border:1px solid #ddd;border-radius:5px;padding:5px 8px;font-size:.78rem;font-family:inherit">
              <input id="ov-sid26" type="text" placeholder="2026 Sanction ID"
                style="flex:1;min-width:200px;border:1px solid #ddd;border-radius:5px;padding:5px 8px;font-size:.78rem;font-family:inherit">
              <select id="ov-seg" style="display:none;border:1px solid #ddd;border-radius:5px;padding:5px 8px;font-size:.78rem;font-family:inherit">
                <option value="Retained">Retained</option><option value="Shifted">Shifted</option>
                <option value="Lost">Lost</option><option value="New">New</option>
                <option value="Recovered">Recovered</option><option value="Tried to Return">Tried to Return</option>
              </select>
              <input id="ov-note" type="text" placeholder="Note (optional)"
                style="flex:1;min-width:160px;border:1px solid #ddd;border-radius:5px;padding:5px 8px;font-size:.78rem;font-family:inherit">
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="chart-btn" onclick="generate_override_cmd()">⧉ Copy command</button>
              <button class="chart-btn" id="ov-apply-btn" style="display:none;background:#2E7D32;color:#fff;border-color:#2E7D32"
                onclick="apply_override_live()">✔ Apply &amp; Write to file</button>
            </div>
            <!-- Command output (shown when server offline) -->
            <div id="ov-cmd-output" style="display:none;background:#1C2526;color:#80CBC4;border-radius:6px;padding:10px;font-size:.75rem;font-family:monospace;line-height:1.7">
              <div id="ov-cmd-text"></div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                <button class="chart-btn" style="background:#37474F;color:#fff;border-color:#37474F" onclick="copy_cmd()">⧉ Copy command</button>
                <span id="ov-copy-confirm" style="display:none;color:#A5D6A7;font-size:.72rem">Copied!</span>
                <span id="ov-apply-confirm" style="display:none;color:#A5D6A7;font-size:.72rem"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick commands -->
      <div style="font-size:.78rem;font-weight:700;color:#555;margin:10px 0 6px">Quick commands</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[
          ['node server.js',              'Start Override Manager server + open dashboard'],
          ['node build_all.js',           'Rebuild Excel + PowerPoint + Dashboard'],
          ['node check.js',               'Validate data before building'],
          ['node menu.js',                'Launch interactive menu (all features)'],
          ['node ask.js --list-overrides','Show active overrides'],
          ['node ask.js --suggest-overrides','AI-powered match suggestions'],
        ].map(([cmd, desc]) =>
          '<div style="flex:1;min-width:220px;background:#F8F9FA;border-radius:6px;padding:8px 10px;font-size:.72rem">' +
          '<div style="font-family:monospace;color:#1565C0;margin-bottom:3px;font-weight:600">' + cmd + '</div>' +
          '<div style="color:#666">' + desc + '</div>' +
          '<button class="chart-btn" style="margin-top:5px;font-size:.67rem" onclick="copy_text(' + "'"+cmd+"'" + ')">⧉ Copy</button></div>'
        ).join('')}
      </div>
    </div>
  </div>
</div>

<!-- Chart expand modal (shows chart OR table depending on current flip state) -->
<div id="chart-modal">
  <div class="modal-box">
    <div class="modal-hdr">
      <span id="modal-title"></span>
      <span id="modal-mode-badge" style="font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:10px;background:#EEF4FD;color:#1565C0;margin-left:8px"></span>
      <button class="modal-close" onclick="close_modal()">✕ Close</button>
    </div>
    <!-- Chart view -->
    <div class="modal-canvas-wrap" id="modal-canvas-wrap">
      <canvas id="modal-canvas"></canvas>
    </div>
    <!-- Table view (shown when chart is in table mode) -->
    <div id="modal-tbl-wrap" class="chart-flip-tbl" style="display:none;max-height:460px;height:auto"></div>
    <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end" id="modal-btns">
      <button class="chart-btn" id="modal-png-btn" onclick="export_modal_png()">⬇ PNG</button>
      <button class="chart-btn" onclick="export_modal_csv()">⬇ CSV</button>
    </div>
  </div>
</div>

<script>
// ── Chart expand + export ──────────────────────────────────────────────────
let _modal_chart = null;
let _modal_chart_id = null;

// Build plugin options for the modal from the source chart's registered options.
// Also carries the inline org_pts plugin (c_monthly) so values appear in expand.
function get_modal_plugin_opts(id) {
  const src_chart = CHARTS[id];
  if (!src_chart) return { plugins: [] };
  const src_opts = src_chart.config?.options?.plugins ?? {};
  const modal_opts = {};
  // Globally-registered plugins — just carry their options object
  ['inside_labels', 'delta_labels', 'value_labels'].forEach(function(k) {
    if (src_opts[k]) modal_opts[k] = Object.assign({}, src_opts[k]);
  });
  // Inline plugins (e.g. org_pts on c_monthly) — pull from chart.config.plugins array
  const inline = (src_chart.config?.plugins ?? []).filter(function(p) { return p && p.id; });
  return { plugin_opts: modal_opts, inline_plugins: inline };
}

function expand_chart(id) {
  if (!CHARTS[id]) { console.warn('expand_chart: no chart for', id); return; }
  const modal      = document.getElementById('chart-modal');
  const canvas_el  = document.getElementById(id);
  const card       = canvas_el ? canvas_el.closest('.card') : null;
  const title_node = card ? card.querySelector('h3') : null;
  const base_title = title_node
    ? (title_node.firstChild.textContent || title_node.textContent).trim().replace(/\s+/g,' ').split('  ')[0]
    : id;

  // Detect whether the card is currently in table mode
  const is_table_mode = canvas_el && canvas_el.style.display === 'none';

  document.getElementById('modal-title').textContent = base_title;
  const badge = document.getElementById('modal-mode-badge');
  if (badge) badge.textContent = is_table_mode ? '⊞ Table view' : '📊 Chart view';

  modal.classList.add('open');
  _modal_chart_id = id;

  const canvas_wrap = document.getElementById('modal-canvas-wrap');
  const tbl_wrap    = document.getElementById('modal-tbl-wrap');
  const png_btn     = document.getElementById('modal-png-btn');

  if (is_table_mode) {
    // ── Expand as table ────────────────────────────────────────────────────
    if (_modal_chart) { _modal_chart.destroy(); _modal_chart = null; }
    if (canvas_wrap) canvas_wrap.style.display = 'none';
    if (tbl_wrap) {
      tbl_wrap.style.display = 'block';
      tbl_wrap.innerHTML = _build_flip_html(id);
    }
    if (png_btn) png_btn.style.display = 'none'; // no PNG for table view
  } else {
    // ── Expand as chart ────────────────────────────────────────────────────
    if (tbl_wrap)    { tbl_wrap.style.display = 'none'; tbl_wrap.innerHTML = ''; }
    if (canvas_wrap) canvas_wrap.style.display = '';
    if (png_btn)     png_btn.style.display = '';

    const canvas = document.getElementById('modal-canvas');
    const snap   = CHART_SNAP[id];
    if (!snap) { console.warn('No CHART_SNAP for', id); return; }
    const { plugin_opts, inline_plugins } = get_modal_plugin_opts(id);
    if (_modal_chart) { _modal_chart.destroy(); _modal_chart = null; }
    try {
      _modal_chart = new Chart(canvas, {
        type: snap.type,
        data: JSON.parse(JSON.stringify(snap)),
        plugins: inline_plugins,
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          plugins: Object.assign(
            { legend: { position: snap.type === 'doughnut' ? 'bottom' : 'top',
                        labels: { boxWidth: 12, padding: 10 } } },
            plugin_opts
          ),
          scales: snap.type === 'doughnut' ? {} : {
            y: { beginAtZero: snap.type === 'bar', grid: { color: '#eee' },
                 ticks: { callback: function(v) { return v.toLocaleString(); } } },
            x: { grid: { display: false } }
          }
        }
      });
    } catch(e) { console.error('expand_chart error:', e); }
  }
}

function close_modal() {
  document.getElementById('chart-modal').classList.remove('open');
  if (_modal_chart) { _modal_chart.destroy(); _modal_chart = null; }
}
document.getElementById('chart-modal').addEventListener('click', function(e) {
  if (e.target === this) close_modal();
});
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close_modal(); });

function export_png(id) {
  const chart = CHARTS[id];
  if (!chart) return;
  const off = document.createElement('canvas');
  off.width  = chart.canvas.width  * 2;
  off.height = chart.canvas.height * 2;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(chart.canvas, 0, 0, off.width, off.height);
  const a = document.createElement('a');
  a.href = off.toDataURL('image/png'); a.download = (id||'chart')+'.png'; a.click();
}
function export_modal_png() {
  if (!_modal_chart) return;
  const off = document.createElement('canvas');
  off.width  = _modal_chart.canvas.width;
  off.height = _modal_chart.canvas.height;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(_modal_chart.canvas, 0, 0);
  const a = document.createElement('a');
  a.href = off.toDataURL('image/png'); a.download = (_modal_chart_id||'chart')+'_expanded.png'; a.click();
}

function export_csv(id) {
  const chart = CHARTS[id];
  if (!chart) return;
  const live = chart.data;
  const q = function(v) { return '"'+String(v==null?'':v).replace(/"/g,'""')+'"'; };
  const header = ['Label'].concat(live.datasets.map(function(ds){return ds.label||'';})).join(',');
  const nl = String.fromCharCode(10);
  const rows = (live.labels||[]).map(function(lbl,i){
    return [q(lbl)].concat(live.datasets.map(function(ds){return ds.data[i]??'';})).join(',');
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent([header].concat(rows).join(nl));
  a.download = (id||'chart')+'_data.csv'; a.click();
}
function export_modal_csv() { if (_modal_chart_id) export_csv(_modal_chart_id); }
</script>

<script>
// ── Override Manager ──────────────────────────────────────────────────────────

const SERVER_URL = 'http://localhost:7474';
let _server_online = false;

// Probe server on load
(function check_server(){
  // Show file-protocol tip whenever opened via file://
  if(window.location.protocol === 'file:'){
    var tip = document.getElementById('file-protocol-tip');
    if(tip) tip.style.display='block';
  }
  fetch(SERVER_URL + '/api/status', {signal: AbortSignal.timeout(1500)})
    .then(function(r){ return r.json(); })
    .then(function(d){
      _server_online = true;
      var badge = document.getElementById('srv-badge');
      if(badge){ badge.textContent='● Server online'; badge.style.background='#E8F5E9'; badge.style.color='#2E7D32'; }
      var sb = document.getElementById('srv-status-bar');
      if(sb) sb.style.display='flex';
      var ob = document.getElementById('srv-offline-bar');
      if(ob) ob.style.display='none';
      var ab = document.getElementById('ov-apply-btn');
      if(ab) ab.style.display='';
      load_server_overrides();
    })
    .catch(function(){
      _server_online = false;
      var badge = document.getElementById('srv-badge');
      if(badge){ badge.textContent='● Server offline'; badge.style.background='#FFF8E1'; badge.style.color='#F57F17'; }
      var ob = document.getElementById('srv-offline-bar');
      if(ob) ob.style.display='flex';
      render_overrides_from_roster();
    });
})();

function load_server_overrides(){
  if(!_server_online){ render_overrides_from_roster(); return; }
  fetch(SERVER_URL + '/api/overrides')
    .then(function(r){ return r.json(); })
    .then(function(ov){ render_server_overrides(ov); })
    .catch(function(){ render_overrides_from_roster(); });
}

function render_server_overrides(ov){
  var list = document.getElementById('ov-list');
  if(!list) return;
  var all = [];
  (ov.force_match||[]).forEach(function(e){ all.push({type:'force_match', label:'Force Match: '+e.sid_25+' ↔ '+e.sid_26, entry:e}); });
  (ov.force_no_match||[]).forEach(function(e){ all.push({type:'force_no_match', label:'Force '+(e.sid_25?'Lost':'New')+': '+(e.sid_25||e.sid_26), entry:e}); });
  (ov.force_segment||[]).forEach(function(e){ all.push({type:'force_segment', label:'Segment → '+e.segment+': '+(e.sid_25||e.sid_26), entry:e}); });
  if(!all.length){ list.innerHTML='<span style="color:#aaa">No active overrides</span>'; return; }
  list.innerHTML = all.map(function(item, i){
    return '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;border-bottom:1px solid #eee">' +
      '<span style="color:#E65100;flex-shrink:0">⚡</span>' +
      '<span style="flex:1;font-size:.73rem">'+item.label.slice(0,60)+(item.entry.note?'<em style=color:#999> — '+item.entry.note+'</em>':'')+'</span>' +
      (_server_online ? '<button class="chart-btn" style="font-size:.65rem;padding:2px 6px;color:#c62828;border-color:#c62828" ' +
        'onclick="remove_override('+JSON.stringify(item.type)+','+i+')">✕</button>' : '') +
      '</div>';
  }).join('');
}

function render_overrides_from_roster(){
  var list = document.getElementById('ov-list');
  if(!list) return;
  if(typeof ROSTER === 'undefined'){ list.innerHTML='<span style="color:#aaa">—</span>'; return; }
  var ov = ROSTER.filter(function(r){return r.conf==='Override';});
  if(!ov.length){ list.innerHTML='<span style="color:#aaa">No active overrides</span>'; return; }
  list.innerHTML = ov.slice(0,12).map(function(r){
    return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;border-bottom:1px solid #eee">'+
      '<span style="color:#E65100;flex-shrink:0">⚡</span>'+
      '<span style="flex:1;font-size:.73rem">'+r.seg+': '+(r.name25||r.name26||r.sid25||r.sid26||'?').slice(0,50)+'</span>'+
      '</div>';
  }).join('') + (ov.length>12?'<div style="color:#999;font-size:.71rem;padding:3px 0">…and '+(ov.length-12)+' more</div>':'');
}

function remove_override(type, index){
  if(!_server_online) return;
  if(!confirm('Remove this override?')) return;
  fetch(SERVER_URL+'/api/overrides/remove', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({type, index})
  }).then(function(r){return r.json();})
    .then(function(d){ if(d.ok) load_server_overrides(); else alert('Remove failed: '+d.error); })
    .catch(function(e){ alert('Server error: '+e.message); });
}

// Show/hide fields based on override type
document.getElementById('ov-type')?.addEventListener('change', function(){
  var t = this.value;
  var s25 = document.getElementById('ov-sid25');
  var s26 = document.getElementById('ov-sid26');
  var seg  = document.getElementById('ov-seg');
  s26.style.display  = (t==='no-match-25') ? 'none' : '';
  s25.style.display  = (t==='no-match-26') ? 'none' : '';
  seg.style.display  = (t==='segment') ? '' : 'none';
  s25.placeholder = t==='no-match-26' ? '' : '2025 Sanction ID (e.g. 311655-Adult Race)';
  s26.placeholder = t==='no-match-25' ? '' : '2026 Sanction ID';
});

function build_override_entry(){
  var ov_type = document.getElementById('ov-type').value;
  var sid25   = document.getElementById('ov-sid25').value.trim();
  var sid26   = document.getElementById('ov-sid26').value.trim();
  var seg     = document.getElementById('ov-seg').value;
  var note    = document.getElementById('ov-note').value.trim();
  var api_type, entry, cmd;
  if(ov_type==='match'){
    if(!sid25||!sid26){ alert('Both Sanction IDs required for Force Match.'); return null; }
    api_type='force_match'; entry={sid_25:sid25,sid_26:sid26};
    cmd='node ask.js --add-override match "'+sid25+'" "'+sid26+'"';
  } else if(ov_type==='no-match-25'){
    if(!sid25){ alert('2025 Sanction ID required.'); return null; }
    api_type='force_no_match'; entry={sid_25:sid25};
    cmd='node ask.js --add-override no-match 25 "'+sid25+'"';
  } else if(ov_type==='no-match-26'){
    if(!sid26){ alert('2026 Sanction ID required.'); return null; }
    api_type='force_no_match'; entry={sid_26:sid26};
    cmd='node ask.js --add-override no-match 26 "'+sid26+'"';
  } else if(ov_type==='segment'){
    var yr=sid25?'25':'26', sid=sid25||sid26;
    if(!sid||!seg){ alert('Sanction ID and segment required.'); return null; }
    api_type='force_segment'; entry=sid25?{sid_25:sid25,segment:seg}:{sid_26:sid26,segment:seg};
    cmd='node ask.js --add-override segment '+yr+' "'+sid+'" "'+seg+'"';
  } else { return null; }
  if(note){ entry.note=note; cmd+=' "'+note+'"'; }
  return {api_type, entry, cmd};
}

function generate_override_cmd(){
  var built = build_override_entry();
  if(!built) return;
  document.getElementById('ov-cmd-text').textContent = built.cmd;
  document.getElementById('ov-cmd-output').style.display = '';
}

function apply_override_live(){
  if(!_server_online){ alert('Server is offline. Use Copy command instead.'); return; }
  var built = build_override_entry();
  if(!built) return;
  fetch(SERVER_URL+'/api/overrides/add', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({type: built.api_type, entry: built.entry})
  }).then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){
        var confirm = document.getElementById('ov-apply-confirm');
        if(confirm){ confirm.textContent='✔ Applied! ('+d.total+' total)'; confirm.style.display=''; setTimeout(function(){confirm.style.display='none';},3000); }
        document.getElementById('ov-cmd-output').style.display='';
        document.getElementById('ov-cmd-text').textContent = built.cmd;
        load_server_overrides();
      } else {
        alert('Apply failed: '+d.error);
      }
    })
    .catch(function(e){ alert('Server error: '+e.message); });
}

function server_rebuild(){
  if(!_server_online){ alert('Server is offline.'); return; }
  var log = document.getElementById('rebuild-log');
  if(!log) return;
  log.style.display='block'; log.innerHTML='<span style="color:#FFD54F">▶ Build starting…</span>';
  var btn = document.getElementById('srv-rebuild-btn');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Building…'; }
  var es = new EventSource(SERVER_URL+'/api/rebuild');
  es.onmessage = function(evt){
    var d = JSON.parse(evt.data);
    if(d.type==='out')  log.innerHTML += '<span style="color:#B2EBF2">'+escHtml(d.line)+'</span>';
    else if(d.type==='err') log.innerHTML += '<span style="color:#EF9A9A">'+escHtml(d.line)+'</span>';
    else if(d.type==='done'){
      log.innerHTML += '<span style="color:'+(d.code===0?'#A5D6A7':'#EF9A9A')+'">'+(d.code===0?'✔ Build complete':'✗ Build failed (code '+d.code+')')+'</span>';
      es.close();
      if(btn){ btn.disabled=false; btn.textContent='▶ Rebuild now'; }
      if(d.code===0){
        setTimeout(function(){
          if(confirm('Build complete. Reload dashboard?')) location.reload();
        },400);
      }
    }
    log.scrollTop = log.scrollHeight;
  };
  es.onerror = function(){
    log.innerHTML += '<span style="color:#EF9A9A">Connection lost</span>';
    es.close();
    if(btn){ btn.disabled=false; btn.textContent='▶ Rebuild now'; }
  };
}

function escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function copy_cmd(){
  var txt = document.getElementById('ov-cmd-text').textContent;
  copy_text(txt);
  var confirm = document.getElementById('ov-copy-confirm');
  if(confirm){ confirm.style.display=''; setTimeout(function(){confirm.style.display='none';},2000); }
}

function copy_text(txt){
  navigator.clipboard?.writeText(txt).catch(function(){
    var el = document.createElement('textarea');
    el.value = txt; el.style.position='fixed'; el.style.opacity='0';
    document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
  });
}
</script>
</body>
</html>`;
  // Inject roster JSON after template is built (safe: JSON.stringify handles all chars)
  const html_final = has_table
    ? html.replace("ROSTER_PLACEHOLDER", JSON.stringify(roster))
    : html;
  fs.writeFileSync(out_path, html_final, 'utf8');
  return out_path;
}

module.exports = { generate_dashboard };

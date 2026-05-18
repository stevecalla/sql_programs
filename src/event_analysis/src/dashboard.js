/**
 * dashboard.js — Generate a truly self-contained HTML dashboard.
 *
 * Chart.js is embedded INLINE from the local npm copy — no CDN, no internet
 * required, works offline, works on air-gapped machines.
 *
 * Charts (matching PowerPoint data exactly):
 *   1. Monthly bar chart — raw delta bars + organic delta line
 *   2. Event type grouped bar — prior vs current year counts by type
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

  // Download filenames — build_all.js passes the real timestamped basenames
  // through results.downloads so the buttons link to files that actually
  // exist. Fallbacks keep the dashboard usable if someone calls
  // generate_dashboard() directly without setting them.
  const dl_xlsx = results.downloads?.xlsx || `${yb}_event_calendar_analysis.xlsx`;
  const dl_pptx = results.downloads?.pptx || `${yb}_event_trends_summary.pptx`;

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

  // First card: aggregate Total across all event types — gives a quick
  // "is the calendar growing or shrinking" read alongside the per-type breakdowns.
  const total_raw_pct = n_baseline ? parseFloat(((net / n_baseline) * 100).toFixed(1)) : 0;
  const total_org_delta = type_org_pct.reduce((sum, op, i) => sum + (type_n25[i] * (op / 100)), 0);
  const total_org_pct = n_baseline ? parseFloat(((total_org_delta / n_baseline) * 100).toFixed(1)) : 0;
  const total_card_html = `<div class="type-card type-card-total" style="border-top:3px solid #37474F">
      <div class="type-name">Total</div>
      <div class="counts" style="color:#37474F">${n_baseline.toLocaleString()} → ${n_analysis.toLocaleString()}</div>
      <div class="delta" style="color:${net < 0 ? '#C62828' : net > 0 ? '#1E7D34' : '#888'}">${sign(net)} (${sign(total_raw_pct)}%)</div>
      <div class="org">Organic: ${sign(total_org_pct)}%</div>
    </div>`;

  // Collect unique event statuses across both years for the roster status
  // filter dropdown. Sorted with COMPLETE/ACTIVE/etc. — whatever the live
  // DB happens to surface — so the filter list mirrors actual data.
  const status_set = new Set();
  for (const r of roster) {
    if (r.st25) status_set.add(r.st25);
    if (r.st26) status_set.add(r.st26);
  }
  const all_statuses = [...status_set].sort();

  const type_cards_html = total_card_html + '\n' + TYPES.map((t, i) => {
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

<!-- ── Rebuild overlay (must come BEFORE all other CSS so it paints first) ──
     The overlay sits over the entire page until state restoration finishes,
     covering the white-flash moment between unload + new paint. Visibility
     is driven by the .dash-ov-rebuilding class on the html element, set by
     the small inline script below as soon as the new document parses
     (reading the sessionStorage flag that the rebuild handler set just
     before reload). -->
<style id="dash-ov-overlay-css">
  #dash-ov-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: #F0F2F5;
    display: none; align-items: center; justify-content: center;
    flex-direction: column; gap: 0.85rem;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #555; font-size: 0.9rem;
    opacity: 1; transition: opacity 280ms ease-out;
  }
  html.dash-ov-rebuilding #dash-ov-overlay { display: flex; }
  #dash-ov-overlay.fade-out { opacity: 0; pointer-events: none; }
  .dash-ov-overlay-spinner {
    width: 30px; height: 30px;
    border: 3px solid #d0d4da;
    border-top-color: #BF1B2C;
    border-radius: 50%;
    animation: dash-ov-spin 0.8s linear infinite;
  }
  @keyframes dash-ov-spin { to { transform: rotate(360deg); } }
</style>
<script id="dash-ov-overlay-bootstrap">
  // Reads the rebuild-pending flag set just before location.reload(). If
  // set, we mark <html> with a class that makes the overlay div visible
  // — this happens as soon as <head> is parsed, so the very first paint
  // of the new document is the overlay (no white flash). The flag is
  // single-use; a normal page load (no flag) sees nothing.
  try {
    if (sessionStorage.getItem('dash_ov_rebuilding') === '1') {
      document.documentElement.classList.add('dash-ov-rebuilding');
      sessionStorage.removeItem('dash_ov_rebuilding');
    }
  } catch (e) {}
</script>

` + chartjs_tag + `
<style>
/* ── Reset ── */
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;background:#F0F2F5}
/* View Transitions opt-in — smooth crossfade on rebuild reload where supported.
   Browsers that don't support it (Safari ≤17, older Firefox) silently ignore. */
@supports (view-transition-name: none) {
  html { view-transition-name: dashboard-root; }
  ::view-transition-old(dashboard-root),
  ::view-transition-new(dashboard-root) { animation-duration: 180ms; }
}
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
.kpi .den{font-size:.66rem;color:#aaa;margin-top:2px;letter-spacing:.02em;font-style:italic}
.kpi.red{border-color:#C62828} .kpi.red .val{color:#C62828}
.kpi.grn{border-color:#1E7D34} .kpi.grn .val{color:#1E7D34}
.kpi.blu{border-color:#1565C0} .kpi.blu .val{color:#1565C0}
.kpi.amb{border-color:#E65100} .kpi.amb .val{color:#E65100}
.kpi.pur{border-color:#6A1B9A} .kpi.pur .val{color:#6A1B9A}
.kpi.brn{border-color:#BF360C} .kpi.brn .val{color:#BF360C}    /* Shifted */
.kpi.dor{border-color:#8D6E63} .kpi.dor .val{color:#8D6E63}    /* Tried to Return */

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
.chip-toggles{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.chip-toggles-lbl{font-size:.7rem;color:#777;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
.chip-toggle{font-family:inherit;font-size:.7rem;padding:3px 10px;border-radius:11px;cursor:pointer;background:#fff;color:#777;border:1px solid #ddd;transition:all .15s}
.chip-toggle:hover{background:#f5f5f5;color:#333;border-color:#bbb}
.chip-toggle.on{background:#1565C0;color:#fff;border-color:#1565C0}
.chip-toggle.on:hover{background:#0D47A1;border-color:#0D47A1}
#dash-glossary{padding:0;overflow:hidden}
#dash-glossary > summary{padding:14px 22px;cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;user-select:none;transition:background .15s}
#dash-glossary > summary::-webkit-details-marker{display:none}
#dash-glossary > summary:hover{background:#fafafa}
#dash-glossary[open] > summary{background:#F5F8FB;border-bottom:1px solid #E3F2FD}
#dash-glossary > summary::before{content:"▸";color:#1565C0;font-size:.9rem;transition:transform .2s;display:inline-block}
#dash-glossary[open] > summary::before{transform:rotate(90deg)}
#dash-glossary .gloss-title{font-weight:600;font-size:1.0rem;color:#222}
#dash-glossary .gloss-hint{font-size:.74rem;color:#777;font-style:italic}
#dash-glossary[open] .gloss-hint{display:none}
#dash-glossary .gloss-body{padding:6px 22px 18px}
#dash-glossary .gloss-h{margin:14px 0 8px;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:#1565C0;border-bottom:1px solid #E3F2FD;padding-bottom:4px}
#dash-glossary .gloss-h:first-of-type{margin-top:4px}
#dash-glossary .gloss-p{margin:0 0 8px;font-size:.82rem;color:#444;line-height:1.45}
#dash-glossary .gloss-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px 16px;margin:0}
#dash-glossary .gloss-grid > div{padding:8px 0}
#dash-glossary .gloss-block{margin:0}
#dash-glossary .gloss-block > div{padding:10px 0;border-bottom:1px solid #F1F3F5}
#dash-glossary .gloss-block > div:last-child{border-bottom:none}
#dash-glossary dt{font-weight:600;font-size:.82rem;color:#222;display:flex;align-items:center;gap:7px;margin-bottom:3px}
#dash-glossary dt .dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}
#dash-glossary dd{margin:0;font-size:.78rem;color:#555;line-height:1.5}
#dash-glossary dd strong{color:#222;font-weight:600}
#dash-glossary dd em{color:#1565C0;font-style:normal;font-weight:500}
#dash-glossary dd code{background:#f6f8fa;padding:1px 5px;border-radius:3px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;color:#24292f}
#dash-glossary .gloss-eg{margin-top:6px;padding:7px 10px;background:#FFF8E1;border-left:3px solid #FFC107;border-radius:3px;font-size:.74rem;color:#5D4037;line-height:1.5}
@media (max-width: 600px) {
  #dash-glossary .gloss-grid{grid-template-columns:1fr}
}
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

/* ── Override column in event roster ──────────────────────────────────── */
#evt-tbl .col-override{display:none}
#evt-tbl.show-override .col-override{display:table-cell}
#evt-tbl tbody tr{cursor:default}
#evt-tbl tbody tr.has-override{background:#fffaf2}
#evt-tbl tbody tr.dash-ov-selected{background:#e3f2fd!important;outline:2px solid #1565c0;outline-offset:-2px}
.dash-ov-pill{display:inline-block;padding:.05rem .42rem;border-radius:10px;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;vertical-align:middle}
.dash-ov-pill-match{background:#dbe7ff;color:#0a3069}
.dash-ov-pill-no-match{background:#fff1e0;color:#8b3a00}
.dash-ov-pill-segment{background:#f0e4ff;color:#4f237a}
.dash-ov-state{display:inline-block;font-size:.68rem;font-weight:500;margin-left:.3rem;vertical-align:middle}
.dash-ov-state-approved{color:#1a7f37}
.dash-ov-state-unapproved{color:#656d76}
.dash-ov-state-stale{color:#7d4e00}

/* ── Rebuild-needed banner ────────────────────────────────────────────── */
.dash-ov-rebuild-banner{position:sticky;top:0;z-index:50;display:none;align-items:center;gap:10px;padding:8px 14px;background:#fff8c5;border-bottom:1px solid #f6dc9d;color:#7d4e00;font-size:.82rem}
.dash-ov-rebuild-banner.show{display:flex}
.dash-ov-rebuild-banner code{background:rgba(0,0,0,0.07);padding:.05rem .35rem;border-radius:3px;font-family:ui-monospace,Menlo,monospace}
.dash-ov-rebuild-banner-link{margin-left:auto;color:#7d4e00;font-weight:600;text-decoration:none;border-bottom:1px solid rgba(125,78,0,0.3);font-size:.78rem}
.dash-ov-rebuild-banner-link:hover{border-bottom-color:#7d4e00}

/* ── Rebuild card at the bottom of the page ──────────────────────────── */
.dash-ov-rebuild-card{padding:14px 18px}
.dash-ov-rebuild-card h3{margin:0 0 .5rem;font-size:1rem;display:flex;align-items:center;gap:10px}
.dash-ov-rebuild-card h3 .muted{color:#656d76;font-size:.78rem;font-weight:400}
.dash-ov-rebuild-card .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.dash-ov-rebuild-card .status-dot{display:inline-flex;align-items:center;gap:.35rem;font-size:.78rem;font-weight:500;padding:.18rem .55rem;border-radius:10px;background:#dafbe1;color:#1a7f37;border:1px solid #aceebb}
.dash-ov-rebuild-card .status-dot.stale{background:#fff8c5;color:#7d4e00;border-color:#f6dc9d}
.dash-ov-rebuild-card .status-dot.running{background:#dbe7ff;color:#0a3069;border-color:#a4c2fa}
.dash-ov-rebuild-card .help{color:#656d76;font-size:.78rem}
.dash-ov-rebuild-card .help code{background:#f6f8fa;padding:.05rem .35rem;border-radius:3px;font-family:ui-monospace,Menlo,monospace;font-size:.85em}
#dash-ov-rebuild-log{display:none;background:#1c2526;color:#80cbc4;padding:10px 14px;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;max-height:240px;overflow-y:auto;line-height:1.55;white-space:pre-wrap;border-radius:6px;margin-top:8px}

/* ── Inline editor panel ──────────────────────────────────────────────── */
.dash-ov-editor{padding:14px 18px}
.dash-ov-editor h3{margin:0 0 .5rem;font-size:1rem;display:flex;align-items:center;gap:10px}
.dash-ov-editor h3 .muted{color:#656d76;font-size:.78rem;font-weight:400}
.dash-ov-editor .dash-ov-srv-status{font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:10px;background:#eee;color:#999}
.dash-ov-editor .dash-ov-srv-status.ok   {background:#dafbe1;color:#1a7f37}
.dash-ov-editor .dash-ov-srv-status.err  {background:#ffebe9;color:#82071e}
.dash-ov-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:780px){.dash-ov-grid{grid-template-columns:1fr}}

.dash-ov-list{font-size:.78rem;background:#f8f9fa;border-radius:6px;padding:10px;min-height:100px;max-height:340px;overflow-y:auto}
.dash-ov-list-item{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #eaecef}
.dash-ov-list-item:last-child{border-bottom:none}
.dash-ov-list-item.dash-ov-selected-row{background:#e3f2fd;margin:0 -4px;padding:6px 8px;border-radius:4px}
.dash-ov-list-item .sids{flex:1;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:#444}
.dash-ov-list-item .note{display:block;font-size:.7rem;color:#777;margin-top:.1rem;font-family:inherit}
.dash-ov-list-item .acts{display:flex;gap:4px;flex-shrink:0}
.dash-ov-btn{font:inherit;font-size:.7rem;font-weight:500;padding:.2rem .55rem;border-radius:4px;border:1px solid #d1d9e0;background:#fff;color:#1f2328;cursor:pointer;transition:background .12s,border-color .12s,color .12s}
.dash-ov-btn:hover{background:#f3f4f6}
.dash-ov-btn-primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
.dash-ov-btn-primary:hover{background:#1158c7;border-color:#1158c7}
.dash-ov-btn-danger{border-color:#cf222e;color:#cf222e}
.dash-ov-btn-danger:hover{background:#cf222e;color:#fff}
.dash-ov-btn-approve{border-color:#2da44e;color:#2da44e}
.dash-ov-btn-approve:hover{background:#2da44e;color:#fff}
.dash-ov-btn-unapprove{border-color:#656d76;color:#656d76}
.dash-ov-btn-unapprove:hover{background:#656d76;color:#fff}

.dash-ov-form{display:flex;flex-direction:column;gap:8px}
.dash-ov-form .row{display:flex;gap:8px;flex-wrap:wrap}
.dash-ov-form label{display:flex;flex-direction:column;gap:.18rem;font-size:.72rem;color:#656d76;font-weight:600;flex:1;min-width:120px}
.dash-ov-form input[type="text"],.dash-ov-form select{font:inherit;padding:.32rem .5rem;border:1px solid #d1d9e0;border-radius:4px;background:#fff;color:#1f2328;font-size:.8rem}
.dash-ov-form input[type="text"]:focus,.dash-ov-form select:focus{outline:none;border-color:#1f6feb;box-shadow:0 0 0 2px rgba(31,111,235,.18)}
.dash-ov-form .check{flex-direction:row;align-items:center;flex:0 0 auto;min-width:auto;cursor:pointer}
.dash-ov-form .check span{color:#1f2328;font-weight:500;margin-left:.3rem}
.dash-ov-form .actions{display:flex;align-items:center;gap:8px;margin-top:.2rem}
.dash-ov-toast{position:fixed;bottom:1.4rem;right:1.4rem;padding:.6rem .9rem;border-radius:6px;background:#1f2328;color:#fff;font-size:.82rem;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:400px;opacity:0;transform:translateY(.4rem);transition:opacity .18s,transform .18s;pointer-events:none;z-index:9999}
.dash-ov-toast.show{opacity:1;transform:translateY(0)}
.dash-ov-toast.err{background:#cf222e}
.dash-ov-toast.ok {background:#2da44e}

.dash-ov-empty{color:#999;font-size:.78rem;font-style:italic;text-align:center;padding:1.5rem .5rem}
.dash-ov-selected-card{background:#e3f2fd;border:1px solid #bbdefb;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:.76rem}
.dash-ov-selected-card .sid{font-family:ui-monospace,Menlo,monospace;font-weight:600;color:#0a3069}
.dash-ov-selected-card .clear{float:right;cursor:pointer;color:#1565c0;text-decoration:none}
.dash-ov-selected-card .clear:hover{text-decoration:underline}
</style>
</head>
<body>

<!-- Rebuild overlay (visibility controlled by html.dash-ov-rebuilding). -->
<div id="dash-ov-overlay" aria-hidden="true" role="status">
  <div class="dash-ov-overlay-spinner"></div>
  <div>Updating dashboard…</div>
</div>

<!-- ── Rebuild-needed banner (sticky; pure notification; shown after any
     override edit). The button + log moved to the bottom of the page —
     see #dash-ov-rebuild-card. ──────────────────────────────────────── -->
<div class="dash-ov-rebuild-banner" id="dash-ov-rebuild-banner">
  <span>⚠ Overrides changed since this build — analysis, charts, and segment counts are stale.</span>
  <a class="dash-ov-rebuild-banner-link" href="#dash-ov-rebuild-card">Jump to Rebuild ↓</a>
</div>

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
  <!-- Net change is now shown in the Total card in the type-strip above. -->
  <div class="kpi ${ret_pct >= 60 ? 'grn' : 'amb'}">
    <div class="val">${(seg.Retained ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${ret_pct}%)</span></div>
    <div class="lbl">Retained</div>
    <div class="den">of ${n_baseline.toLocaleString()} ${ya} events</div>
  </div>
  <div class="kpi amb">
    <div class="val">${(seg.Shifted ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.Shifted??0)/n_baseline*100)}%)</span></div>
    <div class="lbl">Shifted</div>
    <div class="den">of ${n_baseline.toLocaleString()} ${ya} events</div>
  </div>
  <div class="kpi red">
    <div class="val">${(seg.Lost ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.Lost??0)/n_baseline*100)}%)</span></div>
    <div class="lbl">Lost</div>
    <div class="den">of ${n_baseline.toLocaleString()} ${ya} events</div>
  </div>
  <div class="kpi blu">
    <div class="val">${(seg.New ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.New??0)/n_analysis*100)}%)</span></div>
    <div class="lbl">New events</div>
    <div class="den">of ${n_analysis.toLocaleString()} ${yb} events</div>
  </div>
  <div class="kpi pur">
    <div class="val">${(seg.Recovered ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg.Recovered??0)/n_analysis*100)}%)</span></div>
    <div class="lbl">Recovered</div>
    <div class="den">of ${n_analysis.toLocaleString()} ${yb} events</div>
  </div>
  <div class="kpi dor">
    <div class="val">${(seg['Tried to Return'] ?? 0).toLocaleString()} <span style="font-size:1rem;font-weight:500">(${Math.round((seg['Tried to Return']??0)/n_baseline*100)}%)</span></div>
    <div class="lbl">Tried to Return</div>
    <div class="den">of ${n_baseline.toLocaleString()} ${ya} events</div>
  </div>
  <div class="kpi amb"><div class="val">${worst_months[0]?.label ?? '?'} ${worst_months[0]?.delta ?? ''}</div><div class="lbl">Worst month</div></div>
</div>

<div class="row">
  <div class="card card-monthly">
    <h3>Event count by month comparison <span class="note">bars = actual counts · variance Δ above ${yb} bar</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_organic')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_organic')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_organic')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_organic" class="chart-btn" onclick="flip_chart_table('c_organic')" title="Switch to table view">⇄ Table</button></span></h3>
    <div style="position:relative;height:280px"><canvas id="c_organic"></canvas><div id="flip-tbl-c_organic" class="chart-flip-tbl"></div></div>
  </div>
  <div class="card card-segment">
    <h3>Event counts by type <span class="note">${ya} vs ${yb} · variance above ${yb} bar</span><span class="chart-actions"><button class="chart-btn" onclick="expand_chart('c_type')" title="Expand">⤢ Expand</button><button class="chart-btn" onclick="export_png('c_type')" title="Export PNG">⬇ PNG</button><button class="chart-btn" onclick="export_csv('c_type')" title="Export CSV">⬇ CSV</button><button id="flip-btn-c_type" class="chart-btn" onclick="flip_chart_table('c_type')" title="Switch to table view">⇄ Table</button></span></h3>
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
      <input id="tbl-search" type="search" placeholder="Search name / sanction ID…" autocomplete="off" style="max-width:200px">
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
      <!-- Status dropdown — values discovered from the roster at build time -->
      <div class="multi-drop" id="drop-status">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-status')">All statuses ▾</button>
        <div class="multi-drop-panel" id="panel-drop-status">
          <div class="drop-actions"><button type="button" onclick="drop_all(\x27panel-drop-status\x27,true)">All</button><span>|</span><button type="button" onclick="drop_all(\x27panel-drop-status\x27,false)">None</button></div>
          ${all_statuses.map(s => `<label><input type="checkbox" value="${s.replace(/"/g,'&quot;')}" onchange="update_drop_btn(\x27panel-drop-status\x27);filter_and_sort()"><span class="dot" style="background:#90A4AE;opacity:.6"></span><span class="lbl-text">${s}</span></label>`).join('')}
        </div>
      </div>
      <span id="tbl-count" style="margin-left:auto;font-size:.72rem;color:#999"></span>
      <!-- Column picker -->
      <div class="multi-drop" id="drop-cols">
        <button type="button" class="multi-drop-btn" onclick="toggle_drop('drop-cols')" title="Show/hide columns">⊞ Columns ▾</button>
        <div class="multi-drop-panel" id="panel-drop-cols" style="min-width:200px;right:0;left:auto">
          <div class="col-pick-group">${ya}</div>
          <label><input type="checkbox" id="col-sid25" onchange="toggle_col('sid25',this.checked)"><span class="lbl-text">Sanction ID ${ya}</span></label>
          <label><input type="checkbox" id="col-date25" onchange="toggle_col('date25',this.checked)"><span class="lbl-text">Date ${ya}</span></label>
          <div class="col-pick-group">${yb}</div>
          <label><input type="checkbox" id="col-sid26" onchange="toggle_col('sid26',this.checked)"><span class="lbl-text">Sanction ID ${yb}</span></label>
          <label><input type="checkbox" id="col-date26" onchange="toggle_col('date26',this.checked)"><span class="lbl-text">Date ${yb}</span></label>
        </div>
      </div>
      <button class="chart-btn" onclick="export_table_csv()" title="Download all visible rows as CSV">⬇ Export CSV</button>
    </div>
    <!-- Active filter chips — updated by filter_and_sort() -->
    <div class="filter-bar" id="filter-bar">
      <span class="filter-bar-lbl">Filters:</span>
    </div>
    <!-- Chip-bar visibility toggles. Defaults: Segments + Types visible,
         Months hidden. Choice persists in localStorage. -->
    <div class="chip-toggles" id="chip-toggles">
      <span class="chip-toggles-lbl">Show:</span>
      <button type="button" class="chip-toggle" data-bar="seg-bar"   onclick="toggle_chip_bar('seg-bar')">Segments</button>
      <button type="button" class="chip-toggle" data-bar="type-bar"  onclick="toggle_chip_bar('type-bar')">Types</button>
      <button type="button" class="chip-toggle" data-bar="month-bar" onclick="toggle_chip_bar('month-bar')">Months</button>
    </div>
    <!-- Dynamic count bars — updated by filter_and_sort(). Each chip
         shows the count + %-of-shown for that value, and clicking it
         toggles the matching dropdown filter. -->
    <div class="seg-bar" id="seg-bar"></div>
    <div class="seg-bar" id="type-bar" style="margin-top:-4px"></div>
    <div class="seg-bar" id="month-bar" style="margin-top:-4px"></div>
    <button id="tbl-more" onclick="load_all()" style="display:none;margin-bottom:8px;padding:6px 14px;border:1px solid #1565C0;border-radius:5px;background:#fff;color:#1565C0;font-size:.78rem;cursor:pointer;font-family:inherit">Show all events</button>
    <p class="muted" style="font-size:.72rem;color:#777;margin:0 0 6px;font-style:italic">
      Tip: click a row to focus the override editor below.
    </p>
    <div class="tbl-wrap">
      <table id="evt-tbl">
        <thead>
          <tr>
            <th style="width:42px;min-width:42px;cursor:default">#</th>
            <th data-col="seg">Segment</th><th data-col="conf">Conf</th><th data-col="type">Type</th>
            <th class="col-override" data-col="override" style="font-size:.72rem">Override</th>
            <th data-col="m25">Mo ${ya}</th>
            <th class="col-sid25" data-col="sid25" style="font-size:.72rem">Sanction ID ${ya}</th>
            <th class="col-date25" data-col="date25" style="font-size:.72rem">Date ${ya}</th>
            <th data-col="day25">Day</th>
            <th data-col="name25">${ya} Event Name</th>
            <th data-col="st25">Status ${ya}</th>
            <th data-col="m26">Mo ${yb}</th>
            <th class="col-sid26" data-col="sid26" style="font-size:.72rem">Sanction ID ${yb}</th>
            <th class="col-date26" data-col="date26" style="font-size:.72rem">Date ${yb}</th>
            <th data-col="day26">Day</th>
            <th data-col="name26">${yb} Event Name</th>
            <th data-col="st26">Status ${yb}</th>
          </tr>
        </thead>
        <tbody id="tbl-body"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ── Inline override editor panel (Step 9 integration) ───────────────── -->
<div class="row" style="margin-bottom:10px">
  <div class="card card-full dash-ov-editor" id="dash-ov-editor">
    <h3>
      ⚙ Override editor
      <span class="dash-ov-srv-status" id="dash-ov-srv-status">● checking server…</span>
      <span class="muted">Edits write to the DB immediately; rebuild to apply to charts.</span>
    </h3>

    <div id="dash-ov-selected" style="display:none"></div>

    <div class="dash-ov-grid">
      <!-- Left column: list of active overrides -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:#555;margin-bottom:6px;display:flex;align-items:center;gap:8px">
          Active overrides
          <span class="muted" id="dash-ov-list-summary" style="font-weight:400"></span>
          <button class="dash-ov-btn" type="button" style="margin-left:auto;font-size:.7rem"
                  onclick="dash_ov_refresh()">↻ Refresh</button>
        </div>
        <div class="dash-ov-list" id="dash-ov-list">
          <div class="dash-ov-empty">Loading…</div>
        </div>
      </div>

      <!-- Right column: add-override form -->
      <div>
        <div style="font-size:.78rem;font-weight:600;color:#555;margin-bottom:6px">Add override</div>
        <form class="dash-ov-form" id="dash-ov-form" onsubmit="return dash_ov_submit(event);">
          <div class="row">
            <label>Type
              <select id="dash-ov-type" name="type">
                <option value="force_match">force_match — link two events</option>
                <option value="force_no_match">force_no_match — unlink pair</option>
                <option value="force_segment">force_segment — set segment label</option>
              </select>
            </label>
            <label id="dash-ov-side-wrap">Side
              <select id="dash-ov-side" name="side">
                <option value="baseline">baseline (${ya})</option>
                <option value="analysis">analysis (${yb})</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label id="dash-ov-sidB-wrap">Baseline sid
              <input type="text" id="dash-ov-sidB" placeholder="e.g. 311655-Adult Race" autocomplete="off">
            </label>
            <label id="dash-ov-sidA-wrap">Analysis sid
              <input type="text" id="dash-ov-sidA" placeholder="e.g. 354307-Adult Race" autocomplete="off">
            </label>
          </div>
          <div class="row" id="dash-ov-segment-wrap" style="display:none">
            <label>Segment
              <select id="dash-ov-segment">
                <option>Retained</option><option>Shifted</option>
                <option>Lost</option><option>New</option>
                <option>Recovered</option><option>Tried to Return</option>
              </select>
            </label>
          </div>
          <div class="row" id="dash-ov-segB-wrap" style="display:none">
            <label>Baseline event → segment
              <select id="dash-ov-segB">
                <option value="Lost" selected>Lost</option><option value="Retained">Retained</option>
                <option value="Shifted">Shifted</option><option value="New">New</option>
                <option value="Recovered">Recovered</option><option value="Tried to Return">Tried to Return</option>
              </select>
            </label>
            <label>Analysis event → segment
              <select id="dash-ov-segA">
                <option value="New" selected>New</option><option value="Retained">Retained</option>
                <option value="Shifted">Shifted</option><option value="Lost">Lost</option>
                <option value="Recovered">Recovered</option><option value="Tried to Return">Tried to Return</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label style="flex:2">Note (optional)
              <input type="text" id="dash-ov-note" placeholder="Why this override exists">
            </label>
            <label class="check">
              <input type="checkbox" id="dash-ov-global"><span>Global</span>
            </label>
          </div>
          <div class="actions">
            <button type="submit" class="dash-ov-btn dash-ov-btn-primary">+ Add override</button>
            <span class="muted" id="dash-ov-server-hint" style="font-size:.7rem"></span>
          </div>
        </form>
      </div>
    </div>
  </div>
</div>

<div id="dash-ov-toast" class="dash-ov-toast" role="status" aria-live="polite"></div>

<!-- ── Rebuild dashboard (Step 9.5) — bottom anchor for the banner link ── -->
<div class="row" style="margin-bottom:10px">
  <div class="card card-full dash-ov-rebuild-card" id="dash-ov-rebuild-card">
    <h3>
      🔄 Rebuild dashboard
      <span class="muted">Regenerates Excel, PowerPoint, dashboard, JSON outputs from the current overrides.</span>
    </h3>
    <div class="row">
      <span class="status-dot" id="dash-ov-rebuild-status">✓ Up to date with current build</span>
      <button class="dash-ov-btn dash-ov-btn-primary" id="dash-ov-rebuild-btn"
              type="button" onclick="dash_ov_rebuild()">▶ Rebuild now</button>
      <span class="help">Streams live build output from <code>build_all.js</code>. On success the dashboard auto-reloads with the new data.</span>
    </div>
    <div id="dash-ov-rebuild-log"></div>
  </div>
</div>
` : ''}

<div class="row" style="margin-bottom:10px">
  <div class="card card-full" style="display:flex;gap:12px;align-items:center;padding:12px 16px">
    <span style="font-size:.75rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap">Download:</span>
    <a href="./${dl_xlsx}" download
       style="display:inline-flex;align-items:center;gap:6px;background:#1E7D34;color:#fff;padding:7px 14px;border-radius:6px;font-size:.78rem;font-weight:600;text-decoration:none">
      📊 Excel Workbook</a>
    <a href="./${dl_pptx}" download
       style="display:inline-flex;align-items:center;gap:6px;background:#BF1B2C;color:#fff;padding:7px 14px;border-radius:6px;font-size:.78rem;font-weight:600;text-decoration:none">
      📑 PowerPoint Deck</a>
    <span style="font-size:.72rem;color:#aaa;margin-left:auto">Both files are in the same folder as this dashboard</span>
  </div>
</div>

<!-- ── Definitions / glossary — bottom of dashboard ─────────────────────
     Plain-English defs for the terms that show up in the KPI cards,
     charts, and roster. Keep examples concrete; the audience is anyone
     who didn't build the model.
     Uses native <details>/<summary> so it collapses without any JS.
     Default closed — click "What do these terms mean?" to expand. ──── -->
<div class="row" style="margin-bottom:10px">
  <details class="card card-full" id="dash-glossary">
    <summary>
      <span class="gloss-title">📖 What do these terms mean?</span>
      <span class="gloss-hint">Click to expand · definitions for segments, confidence, calendar-expected, organic, and more</span>
    </summary>
    <div class="gloss-body">

    <h4 class="gloss-h">Segments — the six buckets every event lands in</h4>
    <dl class="gloss-grid">
      <div><dt><span class="dot" style="background:#1E7D34"></span>Retained</dt>
        <dd>Same event ran in <strong>both</strong> ${ya} and ${yb}, in the <strong>same month</strong>. The healthy core.</dd></div>
      <div><dt><span class="dot" style="background:#E65100"></span>Shifted</dt>
        <dd>Same event ran in both years but <strong>moved to a different month</strong>. The event is retained — the calendar slot changed.</dd></div>
      <div><dt><span class="dot" style="background:#BF360C"></span>Tried to Return</dt>
        <dd>Was active in ${ya}, the organizer <strong>tried to re-file for ${yb}</strong>, but the application was Cancelled or Declined. Actionable: these are known contacts who already raised their hand.</dd></div>
      <div><dt><span class="dot" style="background:#C62828"></span>Lost</dt>
        <dd>Active in ${ya}, <strong>no ${yb} equivalent at all</strong>. The organizer didn't even apply — a deeper churn signal than Tried to Return.</dd></div>
      <div><dt><span class="dot" style="background:#6A1B9A"></span>Recovered</dt>
        <dd>Was <strong>cancelled in ${ya}</strong>, <strong>successfully ran in ${yb}</strong>. A win-back.</dd></div>
      <div><dt><span class="dot" style="background:#1565C0"></span>New</dt>
        <dd>Active in ${yb} with <strong>no ${ya} equivalent</strong>. Brand-new events on the calendar.</dd></div>
    </dl>

    <h4 class="gloss-h">Confidence (Conf column) — how sure the matcher is about a pair</h4>
    <p class="gloss-p">When two events line up across years, the matcher records how strong the match was. Useful when scanning the roster: high-confidence pairs need no review; low-confidence ones are worth a sanity check.</p>
    <dl class="gloss-grid">
      <div><dt>Exact</dt>
        <dd>Event names are <strong>character-for-character identical</strong> and ran in the <strong>same month</strong> both years. The most confident match — no review needed.
        <div class="gloss-eg">📌 <strong>Example:</strong> "Alpha Win — Sarasota FL" in January ${ya} ↔ "Alpha Win — Sarasota FL" in January ${yb}.</div>
        </dd></div>
      <div><dt>Exact-Shifted</dt>
        <dd>Event names are <strong>character-for-character identical</strong>, but the event <strong>moved to a different month</strong>. Still confident on the pair — only the date changed.
        <div class="gloss-eg">📌 <strong>Example:</strong> "Eighth Annual Du It By The Bay" in January ${ya} ↔ "Eighth Annual Du It By The Bay" in March ${yb}. Lands in the <em>Shifted</em> segment.</div>
        </dd></div>
      <div><dt>Cross</dt>
        <dd><strong>Fuzzy name match</strong> across years — names aren't identical but token overlap is high enough (Jaccard ≥ 0.60) that the matcher thinks they're the same event under a slightly renamed banner. Worth a glance if anything looks off.
        <div class="gloss-eg">📌 <strong>Example:</strong> "Sarasota Tri 2025" ↔ "Sarasota Triathlon Festival 2026". Same physical race, organizer renamed it.</div>
        </dd></div>
      <div><dt>Override</dt>
        <dd>A <strong>manual decision</strong> overrode whatever the automatic matcher said. Either a force-match created a pair the matcher didn't find, a force-no-match split a pair it did, or a force-segment moved a record into a different segment bucket. May appear as <code>Override (was Retained)</code> when an override changed an existing match's segment.</dd></div>
      <div><dt>N/A</dt>
        <dd>The row is <strong>Lost</strong> or <strong>New</strong> — there's no pair to be confident about, only a single-year event. The Conf column shows N/A because confidence is only meaningful between two events.</dd></div>
    </dl>

    <h4 class="gloss-h">Calendar-expected vs Organic delta — why we adjust for the calendar</h4>
    <p class="gloss-p">A month can gain or lose events just because the dates fell differently between years — same demand, different calendar. We separate the two effects:</p>
    <dl class="gloss-block">
      <div><dt>Calendar-expected change</dt>
        <dd>The change we'd predict <strong>just from how the dates landed</strong>, before looking at actual events. If a month gained a weekend day this year vs last, we'd expect roughly that fraction more events even with zero new demand.
        <div class="gloss-eg">📅 <strong>Example:</strong> May ${ya} has 4 Saturdays + 4 Sundays = 8 weekend days. May ${yb} has 5 Saturdays + 4 Sundays = 9 weekend days. That's +12.5% more weekend capacity. If May ${ya} hosted 80 events, the calendar alone predicts ~+10 events in May ${yb} (8 × 1.125 − 8 = 1 extra weekend × ~10 events per weekend day).</div>
        </dd></div>
      <div><dt>Organic delta</dt>
        <dd><strong>Actual change minus calendar-expected change.</strong> This is the "real" signal after stripping out calendar noise. A month can have a flat raw delta but a strong negative organic delta — meaning demand actually fell, the calendar just bailed it out.
        <div class="gloss-eg">📅 <strong>Continuing the example:</strong> Suppose May ${yb} actually ran 85 events. Raw delta = 85 − 80 = +5. Calendar-expected = +10. Organic = 5 − 10 = <strong>−5 events</strong>. Despite a positive raw count, the month underperformed what the calendar handed it.</div>
        </dd></div>
    </dl>

    <h4 class="gloss-h">Other terms you'll see</h4>
    <dl class="gloss-grid">
      <div><dt>Net change</dt>
        <dd>Total ${yb} active events minus total ${ya} active events. The headline number. Splits into the six segments above.</dd></div>
      <div><dt>Active event</dt>
        <dd>An event that wasn't cancelled, declined, or deleted in the source data. Cancelled/Declined/Deleted rows are dropped before any of these numbers are computed.</dd></div>
      <div><dt>% of N shown</dt>
        <dd>On chip bars and KPI cards: the count divided by a specific denominator (visible-rows for chips, ${ya}/${yb} year total for KPIs). Each percentage shows its denominator inline so the math is never ambiguous.</dd></div>
      <div><dt>Sanction ID</dt>
        <dd>USAT's unique identifier for a single sanctioned event, in the format <code>309965-Adult Race</code>. The same physical event in two years has different sanction IDs.</dd></div>
      <div><dt>Override</dt>
        <dd>A manual correction telling the matcher to force a pair (<em>match</em>), prevent a pair (<em>no-match</em>), or change a segment classification (<em>segment</em>). Edited from the panel below the roster or via <code>node ask.js</code>.</dd></div>
      <div><dt>Approved / Unapproved / Stale</dt>
        <dd>Override lifecycle: <strong>unapproved</strong> still applies but emits a build warning; <strong>approved</strong> is endorsed (snapshots the event signature at approval time); <strong>stale</strong> = the underlying event changed (name, month, status) since approval, so re-review is needed.</dd></div>
      <div><dt>Worst month</dt>
        <dd>The month with the most negative net delta (biggest decline). The dashboard highlights up to two worst months because action plans usually focus on the two largest gaps.</dd></div>
    </dl>
    </div>
  </details>
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
  {label:'${ya}',data:TN25.slice(),backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
  {label:'${yb}',data:TN26.slice(),backgroundColor:TCLR.map(function(col){return col+'CC';}),borderColor:TCLR,borderWidth:1}
]};

// 4. Event count by month comparison: ${ya} vs ${yb} side-by-side bar
CHARTS['c_organic'] = new Chart(document.getElementById('c_organic'),{
  type:'bar',
  data:{
    labels:MLBLS,
    datasets:[
      {label:'${ya}',data:MONTH_N25,backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
      {label:'${yb}',data:MONTH_N26,
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
  {label:'${ya}',data:MONTH_N25.slice(),backgroundColor:'rgba(55,71,79,.55)',borderColor:'#37474F',borderWidth:1},
  {label:'${yb}',data:MONTH_N26.slice(),backgroundColor:MONTH_N26.map(function(v,i){return v<MONTH_N25[i]?'rgba(198,40,40,.7)':v>MONTH_N25[i]?'rgba(30,125,52,.7)':'rgba(21,101,192,.55)';}),borderColor:MONTH_N26.map(function(v,i){return v<MONTH_N25[i]?'#C62828':v>MONTH_N25[i]?'#1E7D34':'#1565C0';}),borderWidth:1}
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
  // Count-compare charts: 2 bar datasets (${ya} vs ${yb}) → add Δ and Δ% columns
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
  if (id === 'c_monthly')  hdr += '<th>% of ${ya}</th>';
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
      // ds_shown[0] = baseline year (bar), ds_shown[1] = analysis year (bar)
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
      // MONTH_N25 is a global array of baseline-year counts per month
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

  // Minimal HTML attribute escape — sanction IDs are well-formed (digits +
  // type name) but belt-and-suspenders since these end up in data attrs.
  function escape_attr(s){
    return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  let _row_num = 0;
  function row_html(r){
    const sc = SEG_CLS[r.seg] || r.seg.replace(/\s/g,'.');
    _row_num++;
    // Row identity for the inline editor — sid25 and/or sid26 are passed via
    // data attrs so click-delegation can route the row to the panel below.
    // data-sid is the canonical sid we use to look up overrides (prefer
    // sid25 since most overrides target the baseline year; the editor
    // handles either side from its lookup map).
    const data_sid    = r.sid25 || r.sid26 || '';
    const data_sid_b  = r.sid25 ? ' data-sid-baseline="'+escape_attr(r.sid25)+'"' : '';
    const data_sid_a  = r.sid26 ? ' data-sid-analysis="'+escape_attr(r.sid26)+'"' : '';
    return '<tr data-sid="'+escape_attr(data_sid)+'"'+data_sid_b+data_sid_a+'>' +
      '<td style="color:#bbb;text-align:right;font-size:.7rem;padding-right:8px;font-variant-numeric:tabular-nums">'+_row_num+'</td>' +
      '<td><span class="seg-'+sc+'">'+r.seg+'</span></td>' +
      '<td>'+r.conf+'</td><td>'+r.type+'</td>' +
      '<td class="col-override dash-ov-cell">—</td>' +
      '<td>'+r.m25+'</td>' +
      '<td class="col-sid25" style="font-size:.7rem;color:#666;font-family:monospace">'+r.sid25+'</td>' +
      '<td class="col-date25" style="font-size:.7rem;color:#666;white-space:nowrap">'+r.date25+'</td>' +
      '<td>'+r.day25+'</td>' +
      '<td class="name-col">'+r.name25+'</td>' +
      '<td class="st-col">'+r.st25+'</td>' +
      '<td style="color:'+(r.m26&&r.m26!==r.m25?'#E65100':'inherit')+'">'+r.m26+'</td>' +
      '<td class="col-sid26" style="font-size:.7rem;color:#666;font-family:monospace">'+r.sid26+'</td>' +
      '<td class="col-date26" style="font-size:.7rem;color:#666;white-space:nowrap">'+r.date26+'</td>' +
      '<td>'+r.day26+'</td>' +
      '<td class="name-col">'+r.name26+'</td>' +
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
           + '<span class="chip-pct">('+pct+'% of '+total.toLocaleString()+')</span>'
           + (is_active ? '<span class="chip-x">✕</span>' : '')
           + '</span>';
    }).join('');
  }

  // Toggle a segment chip: checks/unchecks it in the dropdown and re-filters
  function toggle_seg_chip(seg) {
    const cb = document.querySelector('#panel-drop-seg input[value="'+seg+'"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    update_drop_btn('drop-seg');
    filter_and_sort();
  }

  // ── Type + Month chip bars — same pattern as render_seg_summary ──────────
  // Counts and percentages recompute against the visible total whenever
  // filter_and_sort() runs, so the chips always describe the table state.
  const TYPE_CHIP_STYLE = {
    'Adult Race':   {color:'#1565C0', bg:'#E3F2FD'},
    'Youth Race':   {color:'#00897B', bg:'#E0F2F1'},
    'Adult Clinic': {color:'#F57C00', bg:'#FFF3E0'},
    'Youth Clinic': {color:'#8E24AA', bg:'#F3E5F5'},
  };
  const TYPE_ORDER_LIST = ['Adult Race','Youth Race','Adult Clinic','Youth Clinic'];

  function render_type_summary(rows){
    const bar = document.getElementById('type-bar');
    if(!bar) return;
    const total = rows.length;
    const counts = {};
    TYPE_ORDER_LIST.forEach(function(t){ counts[t] = 0; });
    rows.forEach(function(r){ if(counts[r.type] !== undefined) counts[r.type]++; });
    const active = new Set(get_checked('panel-drop-type'));
    bar.innerHTML = TYPE_ORDER_LIST.map(function(t){
      const n = counts[t];
      const pct = total ? Math.round(n/total*100) : 0;
      const st  = TYPE_CHIP_STYLE[t] || {color:'#555',bg:'#eee'};
      const is_active = active.has(t);
      const classes = 'seg-chip'
        + (n===0 && !is_active ? ' zero' : '')
        + (is_active ? ' active' : '');
      const border_col = is_active ? st.color : st.color+'33';
      const bg_col     = is_active ? st.color+'22' : st.bg;
      return '<span class="'+classes+'"'
           + ' style="background:'+bg_col+';border-color:'+border_col+';color:'+st.color+'"'
           + ' title="'+(is_active?'Remove filter: ':'Filter by: ')+t+'"'
           + ' data-type="'+t+'" onclick="toggle_type_chip(this.dataset.type)">'
           + '<span class="chip-dot" style="background:'+st.color+'"></span>'
           + t+' <strong>'+n.toLocaleString()+'</strong>'
           + '<span class="chip-pct">('+pct+'% of '+total.toLocaleString()+')</span>'
           + (is_active ? '<span class="chip-x">✕</span>' : '')
           + '</span>';
    }).join('');
  }
  function toggle_type_chip(t) {
    const cb = document.querySelector('#panel-drop-type input[value="'+t+'"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    update_drop_btn('drop-type');
    filter_and_sort();
  }

  const MONTH_ORDER_LIST = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_CHIP_STYLE_DEFAULT = {color:'#546E7A', bg:'#ECEFF1'};

  function render_month_summary(rows){
    const bar = document.getElementById('month-bar');
    if(!bar) return;
    // A row can have a baseline month, an analysis month, or both. The
    // dropdown filter uses OR logic across the two — match the same here
    // so the chip count and the filter agree. A Shifted row in Jan/Feb
    // therefore counts toward BOTH the Jan and Feb chips.
    const total = rows.length;
    const counts = {};
    MONTH_ORDER_LIST.forEach(function(m){ counts[m] = 0; });
    rows.forEach(function(r){
      if(r.m25 && counts[r.m25] !== undefined) counts[r.m25]++;
      // Only count m26 if it differs from m25 — otherwise a Retained row
      // (same month both years) would be double-counted.
      if(r.m26 && r.m26 !== r.m25 && counts[r.m26] !== undefined) counts[r.m26]++;
    });
    const active = new Set(get_checked('panel-drop-month'));
    bar.innerHTML = MONTH_ORDER_LIST.map(function(m){
      const n = counts[m];
      const pct = total ? Math.round(n/total*100) : 0;
      const st  = MONTH_CHIP_STYLE_DEFAULT;
      const is_active = active.has(m);
      const classes = 'seg-chip'
        + (n===0 && !is_active ? ' zero' : '')
        + (is_active ? ' active' : '');
      const border_col = is_active ? st.color : st.color+'33';
      const bg_col     = is_active ? st.color+'22' : st.bg;
      return '<span class="'+classes+'"'
           + ' style="background:'+bg_col+';border-color:'+border_col+';color:'+st.color+'"'
           + ' title="'+(is_active?'Remove filter: ':'Filter by: ')+m+'"'
           + ' data-mon="'+m+'" onclick="toggle_month_chip(this.dataset.mon)">'
           + '<span class="chip-dot" style="background:'+st.color+'"></span>'
           + m+' <strong>'+n.toLocaleString()+'</strong>'
           + '<span class="chip-pct">('+pct+'% of '+total.toLocaleString()+')</span>'
           + (is_active ? '<span class="chip-x">✕</span>' : '')
           + '</span>';
    }).join('');
  }
  function toggle_month_chip(m) {
    const cb = document.querySelector('#panel-drop-month input[value="'+m+'"]');
    if (!cb) return;
    cb.checked = !cb.checked;
    update_drop_btn('drop-month');
    filter_and_sort();
  }

  // ── Chip-bar visibility toggles ──────────────────────────────────────────
  // Defaults: segments + types ON, months OFF. Choice persists in
  // localStorage under 'chip_bar_visibility'. Hidden bars still get their
  // innerHTML refreshed by filter_and_sort() — cheap, and the next time the
  // user shows the bar it's already up to date.
  const CHIP_BAR_LS_KEY = 'chip_bar_visibility';
  const CHIP_BAR_DEFAULTS = { 'seg-bar': true, 'type-bar': true, 'month-bar': false };

  function load_chip_bar_visibility(){
    try {
      const saved = JSON.parse(localStorage.getItem(CHIP_BAR_LS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        return { ...CHIP_BAR_DEFAULTS, ...saved };
      }
    } catch {}
    return { ...CHIP_BAR_DEFAULTS };
  }

  function apply_chip_bar_visibility(){
    const state = load_chip_bar_visibility();
    Object.keys(state).forEach(function(bar_id){
      const bar = document.getElementById(bar_id);
      if (bar) bar.style.display = state[bar_id] ? '' : 'none';
      const btn = document.querySelector('.chip-toggle[data-bar="'+bar_id+'"]');
      if (btn) btn.classList.toggle('on', !!state[bar_id]);
    });
  }

  function toggle_chip_bar(bar_id){
    const state = load_chip_bar_visibility();
    state[bar_id] = !state[bar_id];
    try { localStorage.setItem(CHIP_BAR_LS_KEY, JSON.stringify(state)); } catch {}
    apply_chip_bar_visibility();
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
    render_type_summary(rows);
    render_month_summary(rows);
  }

  function export_table_csv(){
    const headers = ['#','Segment','Confidence','Type','Month ${ya}','${ya} Sanction ID','${ya} Date','${ya} Day','${ya} Event Name','${ya} Status','Month ${yb}','${yb} Sanction ID','${yb} Date','${yb} Day','${yb} Event Name','${yb} Status'];
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

  function render_active_filters(q, segs, typs, mons, sts) {
    sts = sts || [];
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

    // Status chips — same compaction rule as months.
    if (sts.length > 0 && sts.length <= 3) {
      sts.forEach(function(s){
        chips.push({label:'Status', value:s, color:'#37474F', bg:'#ECEFF1', border:'#B0BEC5',
          clear: function(){
            var cb=document.querySelector('#panel-drop-status input[value="'+s.replace(/"/g,'&quot;')+'"]');
            if(cb){cb.checked=false;} update_drop_btn('drop-status'); filter_and_sort();
          }});
      });
    } else if (sts.length > 3) {
      chips.push({label:'Status', value:sts.length+' selected', color:'#37474F', bg:'#ECEFF1', border:'#B0BEC5',
        clear: function(){ drop_all('panel-drop-status', false); }});
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
    ['panel-drop-seg','panel-drop-type','panel-drop-month','panel-drop-status'].forEach(function(p){
      document.querySelectorAll('#'+p+' input[type=checkbox]').forEach(function(cb){cb.checked=false;});
    });
    ['drop-seg','drop-type','drop-month','drop-status'].forEach(function(d){ update_drop_btn(d); });
    filter_and_sort();
  }

  function filter_and_sort(){
    const q    = (document.getElementById('tbl-search')?.value || '').toLowerCase();
    const segs = get_checked('panel-drop-seg');
    const typs = get_checked('panel-drop-type');
    const mons = get_checked('panel-drop-month');
    const sts  = get_checked('panel-drop-status');
    render_active_filters(q, segs, typs, mons, sts);
    let rows = ROSTER.filter(r =>
      // Search matches across either year's event name OR sanction ID — so
      // a paste like "311655-Adult Race" filters down to that exact row,
      // and partial sid prefixes (e.g. "311655") also work. Each field is
      // null-checked since unmatched rows have only one side populated.
      (!q || (r.name25 && r.name25.toLowerCase().includes(q))
          || (r.name26 && r.name26.toLowerCase().includes(q))
          || (r.sid25  && r.sid25.toLowerCase().includes(q))
          || (r.sid26  && r.sid26.toLowerCase().includes(q))) &&
      (!segs.length || segs.includes(r.seg)) &&
      (!typs.length || typs.includes(r.type)) &&
      (!mons.length || mons.includes(r.m25) || mons.includes(r.m26)) &&
      // Status matches if either year's status is in the checked set.
      // Lost/New rows only have one side populated; the OR handles that.
      (!sts.length  || sts.includes(r.st25) || sts.includes(r.st26))
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
  apply_chip_bar_visibility(); // restore saved show/hide state for chip bars
  document.getElementById('tbl-more')?.addEventListener('click', load_all);

  // ── Wire row clicks → focus the inline override editor below ─────────
  // Click delegation on tbody. Skip header rows / cells without a sid.
  const _ov_tbody = document.getElementById('tbl-body');
  if (_ov_tbody) {
    _ov_tbody.addEventListener('click', function(e){
      var tr = e.target.closest('tr');
      if (!tr || !tr.dataset.sid) return;
      var sid_b = tr.dataset.sidBaseline || '';
      var sid_a = tr.dataset.sidAnalysis || '';
      if (typeof dash_ov_focus_row === 'function') {
        dash_ov_focus_row(tr.dataset.sid, sid_b, sid_a);
      }
    });
  }
}
</script>

<!-- ─────────────────────────────────────────────────────────────────────
     Inline override editor (Step 9 — integrated dashboard view)
     Same API as the standalone /editor/ SPA — see public/editor.js.
     Talks to the local server on the same origin. file:// degrades
     gracefully: the panel renders but shows a "server offline" hint.
     ───────────────────────────────────────────────────────────────────── -->
<script>
(function dash_ov_init(){
  // No editor panel rendered (e.g. roster empty) → nothing to do.
  if (!document.getElementById('dash-ov-editor')) return;

  // Same-origin only — for file:// we skip the API calls and show a hint.
  var IS_SERVED = location.protocol === 'http:' || location.protocol === 'https:';
  var API_BASE  = IS_SERVED ? '' : null;

  // ── State ───────────────────────────────────────────────────────────
  var _overrides    = { force_match: [], force_no_match: [], force_segment: [], stats: { total: 0 } };
  var _by_sid       = {};   // sid → array of override rows targeting it
  var _selected_sid = null; // currently-selected sid (from row click)
  var _dirty        = false;
  var _toast_t      = null;

  // ── Helpers ─────────────────────────────────────────────────────────
  function $id(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function show_toast(msg, kind){
    var t = $id('dash-ov-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'dash-ov-toast show ' + (kind || '');
    if (_toast_t) clearTimeout(_toast_t);
    _toast_t = setTimeout(function(){ t.classList.remove('show'); }, 3200);
  }
  function set_srv_status(state, label){
    var el = $id('dash-ov-srv-status');
    if (!el) return;
    el.className = 'dash-ov-srv-status ' + (state || '');
    el.textContent = label;
    var hint = $id('dash-ov-server-hint');
    if (hint) hint.textContent = state === 'ok' ? 'POST /api/overrides' : 'server offline — start: node server_event_analysis_8016.js';
  }
  function mark_dirty(){
    _dirty = true;
    var banner = $id('dash-ov-rebuild-banner');
    if (banner) banner.classList.add('show');
    // Also flag the rebuild card at the bottom — both surfaces signal the
    // same state so the operator sees it whether they're at the top or
    // bottom of the page.
    var status = $id('dash-ov-rebuild-status');
    if (status) {
      status.classList.remove('running');
      status.classList.add('stale');
      status.textContent = '⚠ Stale — rebuild to apply override changes';
    }
  }

  // ── HTTP wrapper ────────────────────────────────────────────────────
  function api(method, path, body){
    if (!IS_SERVED) return Promise.reject(new Error('opened as file://; start the server to enable edits'));
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(json){
        if (!res.ok) {
          var err = new Error((json && json.error) || ('HTTP ' + res.status));
          err.status = res.status; err.body = json;
          throw err;
        }
        return json;
      });
    });
  }

  // ── Override-status column updater ──────────────────────────────────
  function pill_for(t){
    if (t === 'force_match')    return '<span class="dash-ov-pill dash-ov-pill-match">match</span>';
    if (t === 'force_no_match') return '<span class="dash-ov-pill dash-ov-pill-no-match">no-match</span>';
    if (t === 'force_segment')  return '<span class="dash-ov-pill dash-ov-pill-segment">seg</span>';
    return '';
  }
  function state_for(ov){
    if (ov.approval_state === 'stale') return '<span class="dash-ov-state dash-ov-state-stale">⚠ stale</span>';
    if (ov.approved)                   return '<span class="dash-ov-state dash-ov-state-approved">✓ approved</span>';
    return '<span class="dash-ov-state dash-ov-state-unapproved">◦ unapproved</span>';
  }
  function refresh_status_column(){
    document.querySelectorAll('#tbl-body tr').forEach(function(tr){
      var sid_b = tr.dataset.sidBaseline || '';
      var sid_a = tr.dataset.sidAnalysis || '';
      var ov = (_by_sid[sid_b] && _by_sid[sid_b][0]) || (_by_sid[sid_a] && _by_sid[sid_a][0]);
      var cell = tr.querySelector('.dash-ov-cell');
      if (!cell) return;
      if (!ov) {
        cell.innerHTML = '<span style="color:#bbb">—</span>';
        tr.classList.remove('has-override');
      } else {
        cell.innerHTML = pill_for(ov.override_type) + state_for(ov);
        tr.classList.add('has-override');
      }
    });
    var tbl = $id('evt-tbl');
    if (tbl) tbl.classList.add('show-override');
  }

  // ── Render: active overrides list ───────────────────────────────────
  function render_list(){
    var list = $id('dash-ov-list');
    var summary = $id('dash-ov-list-summary');
    if (!list) return;

    var all = []
      .concat((_overrides.force_match || []).map(function(o){ return Object.assign({}, o, { _type: 'force_match' }); }))
      .concat((_overrides.force_no_match || []).map(function(o){ return Object.assign({}, o, { _type: 'force_no_match' }); }))
      .concat((_overrides.force_segment || []).map(function(o){ return Object.assign({}, o, { _type: 'force_segment' }); }))
      .sort(function(a,b){ return a.id - b.id; });

    var stats = _overrides.stats || {};
    if (summary) {
      summary.textContent = all.length
        ? '· ' + all.length + ' total · ' + (stats.approved||0) + ' approved · ' + (stats.unapproved||0) + ' unapproved · ' + (stats.stale||0) + ' stale'
        : '';
    }

    if (!all.length) {
      list.innerHTML = '<div class="dash-ov-empty">No active overrides in this year scope.</div>';
      return;
    }

    list.innerHTML = all.map(function(o){
      var sid = o.sid_baseline || o.sid_analysis;
      var label;
      if (o._type === 'force_match' && o.sid_baseline && o.sid_analysis) {
        label = esc(o.sid_baseline) + ' ↔ ' + esc(o.sid_analysis) + (o.segment_baseline ? ' → ' + esc(o.segment_baseline) : '');
      } else if (o._type === 'force_no_match' && o.sid_baseline && o.sid_analysis) {
        label = esc(o.sid_baseline) + ' → ' + esc(o.segment_baseline || 'Lost')
          + ' ↔ ' + esc(o.sid_analysis) + ' → ' + esc(o.segment_analysis || 'New');
      } else {
        label = esc(sid) + (o._type === 'force_segment' ? ' → ' + esc(o.segment) : '');
      }
      var selected = (_selected_sid && (sid === _selected_sid || o.sid_baseline === _selected_sid || o.sid_analysis === _selected_sid))
        ? ' dash-ov-selected-row' : '';
      var approve_btn = (o.approved && o.approval_state !== 'stale')
        ? '<button class="dash-ov-btn dash-ov-btn-unapprove" data-act="unapprove" data-sid="'+esc(sid)+'">↶</button>'
        : '<button class="dash-ov-btn dash-ov-btn-approve" data-act="approve" data-sid="'+esc(sid)+'" title="Approve (refreshes signature)">✓</button>';
      return '<div class="dash-ov-list-item' + selected + '">' +
        '<div style="flex:0 0 auto">' + pill_for(o._type) + '</div>' +
        '<div class="sids">' + label +
          (o.note ? '<span class="note">' + esc(o.note) + '</span>' : '') +
          '<span class="note">' + state_for(o).replace(/<[^>]+>/g, '').trim() + '</span>' +
        '</div>' +
        '<div class="acts">' +
          approve_btn +
          '<button class="dash-ov-btn dash-ov-btn-danger" data-act="delete" data-sid="'+esc(sid)+'" title="Soft-delete">✕</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Selected-event card ─────────────────────────────────────────────
  function render_selected(){
    var card = $id('dash-ov-selected');
    if (!card) return;
    if (!_selected_sid) {
      card.style.display = 'none';
      card.innerHTML = '';
      return;
    }
    card.style.display = 'block';
    card.innerHTML = '<div class="dash-ov-selected-card">' +
      '<a class="clear" href="#" onclick="dash_ov_clear_selection();return false">clear</a>' +
      'Focused on: <span class="sid">' + esc(_selected_sid) + '</span>' +
    '</div>';
  }

  // ── Public action: focus a row ──────────────────────────────────────
  window.dash_ov_focus_row = function(sid, sid_baseline, sid_analysis){
    _selected_sid = sid || null;
    document.querySelectorAll('#tbl-body tr.dash-ov-selected').forEach(function(el){ el.classList.remove('dash-ov-selected'); });
    var row = document.querySelector('#tbl-body tr[data-sid="' + (sid || '').replace(/"/g,'\\"') + '"]');
    if (row) row.classList.add('dash-ov-selected');
    if (sid_baseline) $id('dash-ov-sidB').value = sid_baseline;
    if (sid_analysis) $id('dash-ov-sidA').value = sid_analysis;
    render_selected();
    render_list();
    var editor = $id('dash-ov-editor');
    if (editor) editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.dash_ov_clear_selection = function(){
    _selected_sid = null;
    document.querySelectorAll('#tbl-body tr.dash-ov-selected').forEach(function(el){ el.classList.remove('dash-ov-selected'); });
    render_selected();
    render_list();
  };

  // ── Form visibility ─────────────────────────────────────────────────
  function refresh_form_vis(){
    var type = $id('dash-ov-type').value;
    var side = $id('dash-ov-side').value;
    var show_both_sids = type === 'force_match' || type === 'force_no_match';
    var show_segment   = type === 'force_segment' || type === 'force_match';
    var show_unlink    = type === 'force_no_match';
    var need_side      = type === 'force_segment';
    $id('dash-ov-side-wrap').style.display     = need_side     ? '' : 'none';
    $id('dash-ov-segment-wrap').style.display  = show_segment  ? '' : 'none';
    var segBWrap = $id('dash-ov-segB-wrap');
    if (segBWrap) segBWrap.style.display = show_unlink ? '' : 'none';
    $id('dash-ov-sidB-wrap').style.display = (show_both_sids || (need_side && side === 'baseline')) ? '' : 'none';
    $id('dash-ov-sidA-wrap').style.display = (show_both_sids || (need_side && side === 'analysis')) ? '' : 'none';
  }

  // ── Form submit ─────────────────────────────────────────────────────
  window.dash_ov_submit = function(e){
    if (e && e.preventDefault) e.preventDefault();
    if (!IS_SERVED) { show_toast('Server offline. Start: node server_event_analysis_8016.js', 'err'); return false; }
    var type = $id('dash-ov-type').value;
    var body = {
      type: type,
      note:   ($id('dash-ov-note').value.trim() || undefined),
      global: $id('dash-ov-global').checked || undefined,
    };
    if (type === 'force_match' || type === 'force_no_match') {
      body.sid_baseline = $id('dash-ov-sidB').value.trim();
      body.sid_analysis = $id('dash-ov-sidA').value.trim();
      if (!body.sid_baseline || !body.sid_analysis) {
        show_toast(type === 'force_match' ? 'force_match needs both sids' : 'unlink needs both sids', 'err');
        return false;
      }
      if (type === 'force_match') {
        body.segment_baseline = $id('dash-ov-segment').value || undefined;
      }
      if (type === 'force_no_match') {
        var segBEl = $id('dash-ov-segB');
        var segAEl = $id('dash-ov-segA');
        body.segment_baseline = segBEl ? segBEl.value : 'Lost';
        body.segment_analysis = segAEl ? segAEl.value : 'New';
      }
    } else {
      // force_segment
      body.side = $id('dash-ov-side').value;
      if (body.side === 'baseline') body.sid_baseline = $id('dash-ov-sidB').value.trim();
      else                          body.sid_analysis = $id('dash-ov-sidA').value.trim();
      if (!(body.sid_baseline || body.sid_analysis)) { show_toast('missing sid', 'err'); return false; }
      body.segment = $id('dash-ov-segment').value;
    }
    api('POST', '/api/overrides', body).then(function(res){
      if (res.status === 'inserted')      show_toast('Inserted override #' + res.id, 'ok');
      else if (res.status === 'exists')   show_toast('Override already existed (#' + res.id + ')', 'ok');
      else if (res.status === 'updated')  show_toast('Updated override #' + res.id, 'ok');
      else                                 show_toast('OK', 'ok');
      mark_dirty();
      $id('dash-ov-form').reset();
      refresh_form_vis();
      dash_ov_refresh();
    }).catch(function(err){ show_toast('Add failed: ' + err.message, 'err'); });
    return false;
  };

  // ── List action delegation ──────────────────────────────────────────
  function wire_list_actions(){
    var list = $id('dash-ov-list');
    if (!list) return;
    list.addEventListener('click', function(e){
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      var sid = btn.dataset.sid;
      if (!sid) return;
      btn.disabled = true;
      var p = null;
      if (act === 'delete') {
        if (!confirm('Soft-delete every active override for ' + sid + '?')) { btn.disabled = false; return; }
        p = api('DELETE', '/api/overrides/' + encodeURIComponent(sid))
          .then(function(r){ show_toast('Soft-deleted ' + r.removed + ' row(s)', 'ok'); });
      } else if (act === 'approve') {
        p = api('POST', '/api/approve/' + encodeURIComponent(sid))
          .then(function(r){ show_toast('Approved ' + r.approved + ' row(s)', 'ok'); });
      } else if (act === 'unapprove') {
        p = api('POST', '/api/unapprove/' + encodeURIComponent(sid))
          .then(function(r){ show_toast('Unapproved ' + r.unapproved + ' row(s)', 'ok'); });
      }
      if (p) p.then(function(){ mark_dirty(); dash_ov_refresh(); })
              .catch(function(err){ show_toast(act + ' failed: ' + err.message, 'err'); btn.disabled = false; });
    });
  }

  // ── Load + refresh ──────────────────────────────────────────────────
  window.dash_ov_refresh = function(){
    if (!IS_SERVED) {
      set_srv_status('err', '● server offline (file://)');
      var list = $id('dash-ov-list');
      if (list) list.innerHTML = '<div class="dash-ov-empty">Open via <a href="http://localhost:8016/output/dashboard.html">http://localhost:8016/output/dashboard.html</a> to load overrides.</div>';
      return Promise.resolve();
    }
    return api('GET', '/api/status').then(function(){
      set_srv_status('ok', '● connected');
      return api('GET', '/api/overrides');
    }).then(function(data){
      _overrides = data;
      _by_sid = {};
      ['force_match','force_no_match','force_segment'].forEach(function(t){
        (data[t] || []).forEach(function(o){
          var rec = Object.assign({ override_type: t }, o);
          if (o.sid_baseline) (_by_sid[o.sid_baseline] = _by_sid[o.sid_baseline] || []).push(rec);
          if (o.sid_analysis) (_by_sid[o.sid_analysis] = _by_sid[o.sid_analysis] || []).push(rec);
        });
      });
      render_list();
      refresh_status_column();
    }).catch(function(err){
      set_srv_status('err', '● ' + err.message);
      show_toast('Load failed: ' + err.message, 'err');
    });
  };

  // ── Rebuild trigger (Step 9.5) ──────────────────────────────────────
  window.dash_ov_rebuild = function(){
    if (!IS_SERVED) { show_toast('Server offline.', 'err'); return; }
    var btn = $id('dash-ov-rebuild-btn');
    var log = $id('dash-ov-rebuild-log');
    var status = $id('dash-ov-rebuild-status');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Building…'; }
    if (status) {
      status.classList.remove('stale');
      status.classList.add('running');
      status.textContent = '⏳ Build in progress…';
    }
    if (log) { log.style.display = 'block'; log.textContent = '▶ Build starting…\\n'; }
    // Scroll the rebuild card into view so the operator sees live output.
    var card = $id('dash-ov-rebuild-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var es = new EventSource('/api/build');
    es.addEventListener('out',  function(e){ if (log) { log.textContent += e.data + '\\n'; log.scrollTop = log.scrollHeight; } });
    es.addEventListener('err',  function(e){ if (log) { log.textContent += e.data + '\\n'; log.scrollTop = log.scrollHeight; } });
    es.addEventListener('done', function(e){
      var code = parseInt(e.data, 10);
      if (log) log.textContent += (code === 0 ? '\\n✔ Build complete.' : '\\n✗ Build failed (exit code ' + code + ').') + '\\n';
      es.close();
      if (btn) { btn.disabled = false; btn.textContent = '▶ Rebuild now'; }
      if (code === 0) {
        show_toast('Build complete — reloading…', 'ok');
        // Bridge the reload with a full-page overlay so the user never
        // sees a white flash. The overlay shows on this page (final
        // moments before unload) AND on the new page's first paint
        // (via the sessionStorage flag read by the boot script in <head>).
        setTimeout(function(){
          try { _save_dashboard_state(); } catch (e) {}
          try { sessionStorage.setItem('dash_ov_rebuilding', '1'); } catch (e) {}
          // Show overlay on the current page so the transition is seamless
          // between old-page-overlay → unload → new-page-overlay.
          document.documentElement.classList.add('dash-ov-rebuilding');
          // Give the overlay one frame to paint before triggering reload.
          // Append a cache-busting query param so the browser is forced to
          // re-fetch dashboard.html instead of serving from cache. (The
          // server now sends no-cache headers too, but this is belt-and-
          // suspenders for browsers that aggressively cache static HTML.)
          var bust = '?v=' + Date.now();
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              location.href = location.pathname + bust + location.hash;
            });
          });
        }, 1000);
      } else {
        show_toast('Build failed (code ' + code + ')', 'err');
      }
    });
    es.onerror = function(){
      if (log) log.textContent += '\\nConnection lost.\\n';
      es.close();
      if (btn) { btn.disabled = false; btn.textContent = '▶ Rebuild now'; }
    };
  };

  // ── State save / restore across rebuild reload ──────────────────────
  // We can't avoid the reload (new build = new ROSTER + new chart data),
  // but we CAN preserve the user's view state across it. sessionStorage
  // persists across same-tab reloads. We save before reload, restore on
  // page boot, then delete the key so stale state never leaks forward.
  var STATE_KEY = 'dash_ov_state_v1';

  function _collect_drop(panel_id) {
    return Array.prototype.map.call(
      document.querySelectorAll('#' + panel_id + ' input[type=checkbox]:checked'),
      function(cb){ return cb.value; }
    );
  }
  function _apply_drop(panel_id, values) {
    if (!Array.isArray(values)) return;
    var set = {};
    values.forEach(function(v){ set[v] = true; });
    document.querySelectorAll('#' + panel_id + ' input[type=checkbox]').forEach(function(cb){
      cb.checked = !!set[cb.value];
    });
    if (typeof window.update_drop_btn === 'function') window.update_drop_btn(panel_id);
  }
  function _save_dashboard_state() {
    try {
      var search_el = $id('tbl-search');
      var th_sorted = document.querySelector('#evt-tbl thead th.asc, #evt-tbl thead th.desc');
      var more_btn  = $id('tbl-more');
      var state = {
        v: 1,
        scroll:   window.scrollY,
        search:   search_el ? search_el.value : '',
        seg:      _collect_drop('panel-drop-seg'),
        type:     _collect_drop('panel-drop-type'),
        month:    _collect_drop('panel-drop-month'),
        cols:     _collect_drop('panel-drop-cols'),
        sort_col: th_sorted ? th_sorted.dataset.col : null,
        sort_dir: th_sorted && th_sorted.classList.contains('desc') ? -1 : 1,
        selected: _selected_sid,
        show_all: more_btn ? (more_btn.style.display === 'none') : false,
      };
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) { /* sessionStorage may be unavailable — silently skip */ }
  }
  window.dash_ov_save_state = _save_dashboard_state; // expose for rebuild handler

  function _restore_dashboard_state() {
    var raw = null;
    try { raw = sessionStorage.getItem(STATE_KEY); } catch (e) { return; }
    if (!raw) return;
    try { sessionStorage.removeItem(STATE_KEY); } catch (e) {}

    var state;
    try { state = JSON.parse(raw); } catch (e) { return; }
    if (!state || state.v !== 1) return;

    // Apply filter inputs + dropdowns. The HTML inline handlers (onchange)
    // won't fire when we set .value / .checked programmatically — we trigger
    // a final filter_and_sort() after applying.
    var search_el = $id('tbl-search');
    if (search_el && typeof state.search === 'string') search_el.value = state.search;
    _apply_drop('panel-drop-seg',   state.seg);
    _apply_drop('panel-drop-type',  state.type);
    _apply_drop('panel-drop-month', state.month);
    _apply_drop('panel-drop-cols',  state.cols);

    // The column-picker checkboxes drive a toggle_col() function that adds
    // .show-* classes on the table. Trigger each restored col to apply.
    (state.cols || []).forEach(function(col_id){
      if (typeof window.toggle_col === 'function') {
        // checkbox id format is "col-sid25" / "col-date25" / "col-sid26" / "col-date26"
        window.toggle_col(col_id, true);
      }
    });

    // Sort: simulate clicking the sorted header. Fresh load starts at
    // sort_col='_excel'. One click → that col asc; two clicks → desc.
    if (state.sort_col && state.sort_col !== '_excel') {
      var th = document.querySelector('#evt-tbl thead th[data-col="' + state.sort_col + '"]');
      if (th) {
        th.click();                            // asc
        if (state.sort_dir === -1) th.click(); // desc
      }
    } else if (typeof window.filter_and_sort === 'function') {
      window.filter_and_sort();
    }

    // "Show all" — only meaningful when the table has paginated rows.
    if (state.show_all && typeof window.load_all === 'function') window.load_all();

    // Selected event in editor — defer until /api/overrides has loaded so
    // the row is in the DOM and dash_ov_focus_row can pull sid_baseline /
    // sid_analysis from its data attrs.
    if (state.selected) {
      var attempts = 0;
      (function try_focus(){
        attempts++;
        var row = document.querySelector('#tbl-body tr[data-sid="' + state.selected.replace(/"/g, '\\"') + '"]');
        if (row) {
          window.dash_ov_focus_row(state.selected, row.dataset.sidBaseline || '', row.dataset.sidAnalysis || '');
          return;
        }
        if (attempts < 30) setTimeout(try_focus, 100);
      })();
    }

    // Scroll — defer until layout has settled so the position is accurate.
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        window.scrollTo(0, state.scroll || 0);
      });
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────
  $id('dash-ov-type').addEventListener('change', refresh_form_vis);
  $id('dash-ov-side').addEventListener('change', refresh_form_vis);
  refresh_form_vis();
  wire_list_actions();
  dash_ov_refresh();
  _restore_dashboard_state();

  // If we arrived here from a rebuild reload, the overlay is currently
  // covering the page. Hold it briefly so charts have time to animate
  // in (250ms entrance animation set on each Chart.js chart), then
  // crossfade it out.
  if (document.documentElement.classList.contains('dash-ov-rebuilding')) {
    setTimeout(function(){
      var ov = $id('dash-ov-overlay');
      if (ov) ov.classList.add('fade-out');
      setTimeout(function(){
        document.documentElement.classList.remove('dash-ov-rebuilding');
      }, 320); // slightly longer than the CSS transition (280ms)
    }, 450);
  }
})();
</script>

<!-- Chart expand modal (shows chart OR table depending on current flip state) -->
<div id="chart-modal">
  <div class="modal-box">
    <div class="modal-hdr">
      <span id="modal-title"></span>
      <span id="modal-mode-badge" style="font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:10px;background:#EEF4FD;color:#1565C0;margin-left:8px"></span>
      <button class="modal-close" onclick="close_modal()">✕ Close</button>
    </div>
    <div class="modal-canvas-wrap" id="modal-canvas-wrap">
      <canvas id="modal-canvas"></canvas>
    </div>
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

function get_modal_plugin_opts(id) {
  const src_chart = CHARTS[id];
  if (!src_chart) return { plugin_opts: {}, inline_plugins: [] };
  const opts = src_chart.options?.plugins || {};
  // Forward EVERY plugin's options block from the source chart so the modal
  // renders identical data labels. The dashboard has several globally-
  // registered plugins (value_labels, inside_labels, delta_labels) that only
  // draw when opts.show === true — which lives in this options.plugins map.
  // Previously we only forwarded datalabels + tooltip, which left the modal
  // looking bare. We exclude 'legend' because expand_chart() builds a fresh
  // legend with modal-appropriate positioning below.
  const modal_opts = {};
  for (const key of Object.keys(opts)) {
    if (key === 'legend') continue;
    modal_opts[key] = opts[key];
  }
  const inline = (src_chart.config.plugins || []).filter(p => p && p.id === 'org_pts');
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
    if (_modal_chart) { _modal_chart.destroy(); _modal_chart = null; }
    if (canvas_wrap) canvas_wrap.style.display = 'none';
    if (tbl_wrap) {
      tbl_wrap.style.display = 'block';
      tbl_wrap.innerHTML = _build_flip_html(id);
    }
    if (png_btn) png_btn.style.display = 'none';
  } else {
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
  a.href = 'data:text/csv;charset=utf-8,﻿'+encodeURIComponent([header].concat(rows).join(nl));
  a.download = (id||'chart')+'_data.csv'; a.click();
}
function export_modal_csv() { if (_modal_chart_id) export_csv(_modal_chart_id); }
</script>
</body>
</html>`;
  const html_final = has_table
    ? html.replace("ROSTER_PLACEHOLDER", JSON.stringify(roster))
    : html;
  fs.writeFileSync(out_path, html_final, 'utf8');
  return out_path;
}

module.exports = { generate_dashboard };

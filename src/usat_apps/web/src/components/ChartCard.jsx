import { useEffect, useRef, useState } from 'react';

// Metrics dashboard cards. ChartCard (a Chart.js bar with a flip-to-table view) and TablePanel (a
// plain data table) share a COLLAPSIBLE header and an Expand / PNG / CSV toolbar. Expand and PNG act
// on WHATEVER is currently in view — the chart when the chart is showing, the table when flipped to
// the table. Uses the global window.Chart (loaded from CDN in index.html); no bundler dependency.
let _registered = false;
function ensureRegistered() { if (_registered) return; try { if (window.Chart && window.ChartDataLabels) window.Chart.register(window.ChartDataLabels); } catch (e) { /* ignore */ } _registered = true; }
function cssvar(n) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; } catch (e) { return '#888'; } }
function download(name, href) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function toCsv(headers, rows) {
  const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [headers.map(esc).join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n');
}
function csvUrl(headers, rows) { return URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: 'text/csv' })); }

// Chart -> a titled PNG (card background + title header above the canvas).
function chartPng(chart, title) {
  if (!chart) return '';
  const src = chart.canvas;
  const fnt = (z) => '700 ' + z + 'px system-ui,Arial,sans-serif';
  let fs = Math.max(14, Math.round(src.width / 48)); let margin = Math.round(fs * 0.8);
  if (title) { const m = document.createElement('canvas').getContext('2d'); m.font = fnt(fs); while (fs > 9 && m.measureText(title).width > (src.width - margin * 2)) { fs--; margin = Math.round(fs * 0.8); m.font = fnt(fs); } }
  const pad = title ? Math.round(fs * 2.0) : 0;
  const off = document.createElement('canvas'); off.width = src.width; off.height = src.height + pad;
  const ctx = off.getContext('2d');
  ctx.fillStyle = cssvar('--card'); ctx.fillRect(0, 0, off.width, off.height);
  if (title) { ctx.fillStyle = cssvar('--ink'); ctx.textBaseline = 'top'; ctx.font = fnt(fs); ctx.fillText(title, margin, Math.round(fs * 0.55)); }
  ctx.drawImage(src, 0, pad);
  return off.toDataURL('image/png');
}

// Table -> a PNG (draw a simple themed grid: title, header row, alternating rows).
function tablePng(title, headers, rows) {
  const pad = 12, cellPad = 10, fs = 13, rowH = fs + 12;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = fs + 'px system-ui,Arial,sans-serif';
  const widths = headers.map((h, c) => {
    let wmax = meas.measureText(String(h)).width;
    rows.forEach((r) => { wmax = Math.max(wmax, meas.measureText(String(r[c] == null ? '' : r[c])).width); });
    return Math.ceil(wmax) + cellPad * 2;
  });
  const titleH = title ? rowH + 6 : 0;
  const W = Math.max(220, widths.reduce((a, b) => a + b, 0)) + pad * 2;
  const H = titleH + rowH * (rows.length + 1) + pad * 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = cssvar('--card'); ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  let y = pad;
  if (title) { ctx.fillStyle = cssvar('--ink'); ctx.font = '700 ' + (fs + 2) + 'px system-ui,Arial,sans-serif'; ctx.fillText(title, pad, y + rowH / 2); y += titleH; }
  ctx.font = '700 ' + fs + 'px system-ui,Arial,sans-serif'; ctx.fillStyle = cssvar('--muted');
  let x = pad; headers.forEach((h, c) => { ctx.fillText(String(h), x + cellPad, y + rowH / 2); x += widths[c]; });
  y += rowH;
  ctx.font = fs + 'px system-ui,Arial,sans-serif';
  rows.forEach((r, ri) => {
    if (ri % 2) { ctx.fillStyle = cssvar('--hover'); ctx.fillRect(pad, y, W - pad * 2, rowH); }
    ctx.fillStyle = cssvar('--ink');
    let xx = pad; r.forEach((cell, c) => { ctx.fillText(String(cell == null ? '' : cell), xx + cellPad, y + rowH / 2); xx += widths[c]; });
    y += rowH;
  });
  return cv.toDataURL('image/png');
}

function GenericTable({ headers, rows }) {
  return (
    <table>
      <thead><tr><th className="mx-rn">#</th>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td className="dim">none</td></tr>}
        {rows.map((r, i) => (<tr key={i}><td className="mx-rn">{i + 1}</td>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>))}
      </tbody>
    </table>
  );
}

// Collapsible header: a caret toggles the whole card body; the toolbar sits on the right (only shown
// when the card is open).
function Head({ title, subtitle, open, setOpen, children }) {
  return (
    <div className="mx-ph">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        style={{ border: 'none', background: 'none', color: 'var(--ink)', cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0 }}>
        <span className="rail-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <h2 style={{ margin: 0 }}>{title}{subtitle ? <span className="dim" style={{ fontWeight: 400, fontSize: 12, textTransform: 'none', letterSpacing: 0 }}> {subtitle}</span> : null}</h2>
      </button>
      {open ? <div className="mx-tools">{children}</div> : null}
    </div>
  );
}

function Modal({ content, onClose }) {
  if (!content) return null;
  return (
    <div className="mx-modal" onClick={(e) => { if (e.target.className === 'mx-modal' || e.target.className === 'x') onClose(); }}>
      <div className="mx-modal-inner"><button className="x" title="Close" onClick={onClose}>✕</button>{content.img ? <img alt="" src={content.img} /> : <div className="mx-modal-table">{content.node}</div>}</div>
    </div>
  );
}

export default function ChartCard({ id, title, subtitle, type = 'bar', labels = [], values = [], series = [], color, headers = [], rows = [], height = 230, theme }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState('chart');   // 'chart' | 'table'
  const [modal, setModal] = useState(null);

  useEffect(() => {
    if (!open || view !== 'chart') { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } return; }
    ensureRegistered();
    if (!window.Chart || !canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const ink = cssvar('--dim'); const grid = cssvar('--line');
    const acc = color || cssvar('--accent');
    let cfg;
    if (type === 'multibar') {
      cfg = { type: 'bar', data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 3 })) },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: ink, boxWidth: 12 } }, datalabels: { display: false } }, scales: { x: { ticks: { color: ink }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } } } } };
    } else {
      cfg = { type: 'bar', data: { labels, datasets: [{ data: values, backgroundColor: acc, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: '#fff', anchor: 'end', align: 'start', offset: 4, clamp: true, font: { size: 10, weight: '700' }, formatter: (v) => (v ? v : '') } }, scales: { x: { ticks: { color: ink }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } } } } };
    }
    chartRef.current = new window.Chart(canvasRef.current, cfg);
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [JSON.stringify(labels), JSON.stringify(values), JSON.stringify(series), color, type, theme, open, view]);

  const doPng = () => (view === 'table' ? download((id || 'table') + '.png', tablePng(typeof title === 'string' ? title : (id || 'table'), headers, rows)) : download((id || 'chart') + '.png', chartPng(chartRef.current, typeof title === 'string' ? title : '')));
  const doExpand = () => setModal(view === 'table' ? { node: <GenericTable headers={headers} rows={rows} /> } : { img: chartPng(chartRef.current, typeof title === 'string' ? title : '') });
  const doCsv = () => download((id || 'chart') + '.csv', csvUrl(headers, rows));

  return (
    <div className="mx-panel">
      <Head title={title} subtitle={subtitle} open={open} setOpen={setOpen}>
        <button type="button" onClick={doExpand}>⤢ Expand</button>
        <button type="button" onClick={doPng}>⬇ PNG</button>
        <button type="button" onClick={doCsv}>⬇ CSV</button>
        <button type="button" onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>⇄ {view === 'chart' ? 'Table' : 'Chart'}</button>
      </Head>
      {open ? (
        <>
          <div className="mx-canvas-wrap" style={{ height, display: view === 'chart' ? 'block' : 'none' }}><canvas ref={canvasRef} /></div>
          {view === 'table' ? <div className="mx-flip"><GenericTable headers={headers} rows={rows} /></div> : null}
        </>
      ) : null}
      <Modal content={modal} onClose={() => setModal(null)} />
    </div>
  );
}

// A plain data table with the SAME collapsible header + Expand / PNG / CSV toolbar. `children` is the
// rendered table (keeps custom cell styling); headers/rows drive CSV + PNG export.
export function TablePanel({ id, title, subtitle, headers = [], rows = [], children }) {
  const [open, setOpen] = useState(true);
  const [modal, setModal] = useState(null);
  const doExpand = () => setModal({ node: children || <GenericTable headers={headers} rows={rows} /> });
  const doPng = () => download((id || 'table') + '.png', tablePng(typeof title === 'string' ? title : (id || 'table'), headers, rows));
  const doCsv = () => download((id || 'table') + '.csv', csvUrl(headers, rows));
  return (
    <div className="mx-panel">
      <Head title={title} subtitle={subtitle} open={open} setOpen={setOpen}>
        <button type="button" onClick={doExpand}>⤢ Expand</button>
        <button type="button" onClick={doPng}>⬇ PNG</button>
        <button type="button" onClick={doCsv}>⬇ CSV</button>
      </Head>
      {open ? (children || <GenericTable headers={headers} rows={rows} />) : null}
      <Modal content={modal} onClose={() => setModal(null)} />
    </div>
  );
}

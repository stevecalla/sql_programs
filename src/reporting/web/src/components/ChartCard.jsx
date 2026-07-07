import { useEffect, useRef, useState } from 'react';

// A chart panel ported from the merge Metrics dashboard's chart cards: a Chart.js bar (or grouped
// "multibar") with an Expand / PNG / CSV / Table toolbar and a flip-to-table view. Uses the global
// window.Chart (loaded from CDN in index.html), so no bundler dependency. Colors follow the app's CSS
// theme variables.
let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  try { if (window.Chart && window.ChartDataLabels) window.Chart.register(window.ChartDataLabels); } catch (e) { /* ignore */ }
  _registered = true;
}
function cssvar(n) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; } catch (e) { return '#888'; } }

// Build a titled PNG (card background + title header above the canvas) — ported from the original.
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
function download(name, href) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

export default function ChartCard({ id, title, type = 'bar', labels = [], values = [], series = [], color, headers = [], rows = [], height = 230, theme }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [flip, setFlip] = useState(false);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    ensureRegistered();
    if (!window.Chart || !canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const ink = cssvar('--dim'); const grid = cssvar('--line');
    const acc = color || cssvar('--accent');
    let cfg;
    if (type === 'multibar') {
      cfg = {
        type: 'bar',
        data: { labels, datasets: series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 3 })) },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: true, labels: { color: ink, boxWidth: 12 } }, datalabels: { display: false } },
          scales: { x: { ticks: { color: ink }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } } } },
      };
    } else {
      cfg = {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: acc, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, datalabels: { color: '#fff', anchor: 'end', align: 'start', offset: 4, clamp: true, font: { size: 10, weight: '700' }, formatter: (v) => (v ? v : '') } },
          scales: { x: { ticks: { color: ink }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } } } },
      };
    }
    chartRef.current = new window.Chart(canvasRef.current, cfg);
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [JSON.stringify(labels), JSON.stringify(values), JSON.stringify(series), color, type, theme]);

  const doPng = () => download((id || 'chart') + '.png', chartPng(chartRef.current, title));
  const doExpand = () => setModal(chartPng(chartRef.current, title));
  const doCsv = () => {
    const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = [headers.map(esc).join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n');
    download((id || 'chart') + '.csv', URL.createObjectURL(new Blob([csv], { type: 'text/csv' })));
  };

  return (
    <div className="mx-panel">
      <div className="mx-ph">
        <h2>{title}</h2>
        <div className="mx-tools">
          <button type="button" onClick={doExpand}>⤢ Expand</button>
          <button type="button" onClick={doPng}>⬇ PNG</button>
          <button type="button" onClick={doCsv}>⬇ CSV</button>
          <button type="button" onClick={() => setFlip((f) => !f)}>⇄ Table</button>
        </div>
      </div>
      {/* Keep the canvas mounted (only hidden) when flipped to the table, so the Chart instance stays
          alive — otherwise Expand/PNG break in table mode and flipping back renders blank. */}
      <div className="mx-canvas-wrap" style={{ height, display: flip ? 'none' : 'block' }}><canvas ref={canvasRef} /></div>
      {flip && (
        <div className="mx-flip">
          <table>
            <thead><tr><th className="mx-rn">#</th>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td className="dim">none</td></tr>}
              {rows.map((r, i) => (<tr key={i}><td className="mx-rn">{i + 1}</td>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>))}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <div className="mx-modal" onClick={(e) => { if (e.target.className === 'mx-modal' || e.target.className === 'x') setModal(null); }}>
          <div className="mx-modal-inner"><button className="x" title="Close" onClick={() => setModal(null)}>✕</button><img alt={title} src={modal} /></div>
        </div>
      )}
    </div>
  );
}

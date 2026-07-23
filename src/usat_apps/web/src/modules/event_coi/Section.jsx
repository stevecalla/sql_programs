// event_coi — Event / Race Certificate Request builder.
// Enter the event, requestor, and coverage/delivery options once, upload the certificate-holder list,
// review/edit, then (Phase 3-4) drive the CSR24 portal to submit one certificate per holder. Phase 1 =
// UI/UX only; the run is mocked.
//
// Reuses the platform shell primitives (.page, .card, .btn), the merge app's CollapsibleCard, and its
// client CSV/Excel export approach; only the COI form, holder table, and test-fill tool are unique.
// Portal field-name mapping lives in plans_and_notes/insurance_coi/RECON_portal_form_map.md.
// Only Holder Name + Holder Email are required by the portal; the coverage/delivery fields are optional.
import { useEffect, useMemo, useRef, useState } from 'react';
import CollapsibleCard from '../salesforce_merge/components/CollapsibleCard.jsx'; // shared UI primitive (could move to web/src/components later)
import HolderTable from './components/HolderTable.jsx';
import RunPanel, { openFull } from './components/RunPanel.jsx';
import { api } from '../../lib/api.js';
import { exportCsv, exportExcel } from './lib/exportRows.js';
import { makeZip, b64ToBytes } from './lib/zip.js';
import { TEST_EVENT, TEST_REQUESTOR, TEST_OPTIONS, TEST_HOLDERS } from './lib/testData.js';
import { anyHolderHasCoverage } from './lib/coverage.js';
import { usePersistentHeight } from './lib/persistResize.js';
import './event_coi.css';


const DEFAULTS_KEY = 'usatapps_event_coi_defaults';   // localStorage; Phase 2 can move to a server settings store like merge.

const EVENT_FIELDS = [
  { key: 'sanctionId', label: 'USA Triathlon Sanction ID #', digits: 6, ph: '6-digit number', req: true },
  { key: 'eventName', label: 'Event Name', req: true, maxLen: 150 },
  { key: 'eventLocationName', label: 'Event Location Name', maxLen: 150 },
  { key: 'eventAddress', label: 'Event Address', maxLen: 150 },
  { key: 'eventStartDate', label: 'Event Start Date', req: true, date: true },
  { key: 'eventEndDate', label: 'Event End Date', req: true, date: true },
];
const REQUESTOR_FIELDS = [
  { key: 'name', label: 'Your Name', req: true, maxLen: 100 },
  { key: 'email', label: 'Your Email Address', type: 'email', req: true, maxLen: 100 },
  { key: 'phone', label: 'Your Phone Number', maxLen: 12, ph: 'e.g. 555-010-2026' }, // portal caps this at 12 chars
];
// Exact wording from the portal form (see RECON_portal_form_map.md / the original screenshot).
const COVERAGE = [
  ['additionalInsured', 'Additional Insured'],
  ['aiPrimaryNonContrib', 'Additional Insured - Primary & Non-Contributory'],
  ['waiverOfSubrogation', 'Waiver of Subrogation'],
  ['noticeOfCancellation', 'Notice of Cancellation *(60 Day Notice of Cancellation Provided with policy language)'],
];
const RELATIONSHIP = [
  ['landlord', 'Landlord or Owner of Building or Premises that you are renting for 30 days or less'],
  ['stateGov', 'State or Governmental Agency requiring a permit or authorization'],
];
const DELIVERY = [
  ['requestor', 'Deliver to Requestor'],
  ['requestorAndHolder', 'Deliver to Requestor & Certificate Holder'],
];
const HOLDER_COLS = [
  { key: 'name', label: 'Holder Name' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
  { key: 'state', label: 'State' }, { key: 'zip', label: 'Zip' }, { key: 'email', label: 'Holder Email' },
];
const LOG_COLS = [{ key: 'num', label: '#' }, { key: 'time', label: 'Time' }, { key: 'holder', label: 'Holder' }, { key: 'status', label: 'Status' }, { key: 'confirmation', label: 'Confirmation' }, { key: 'detail', label: 'Detail' }];

const EMPTY_OPTS = {
  additionalInsured: false, aiPrimaryNonContrib: false, waiverOfSubrogation: false, noticeOfCancellation: false,
  coverageOther: false, coverageOtherText: '',
  contract: '', relationship: '', relationshipOtherText: '', additionalInfo: '',
  delivery: '', deliveryOtherText: '',
};

const TEMPLATE_URL = (((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/').replace(/\/+$/, '')) + '/event_coi_template.xlsx';
const BLANK_HOLDER = () => ({ name: '', address: '', city: '', state: '', zip: '', email: '' });

// The portal stores dates as MM/DD/YYYY (maxlength 10); the native date picker speaks YYYY-MM-DD.
const mdyToIso = (mdy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy || ''); return m ? `${m[3]}-${m[1]}-${m[2]}` : ''; };
const isoToMdy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };

// Submission-log timestamp: full date AND time, with the local timezone abbreviation (e.g. "7/23/2026,
// 2:04:11 PM CDT"). Falls back to a plain locale string if the runtime can't emit a timezone name.
function fmtLogTime(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(undefined, { timeZoneName: 'short' }); }
  catch (e) { return new Date(ms).toLocaleString(); }
}

// Uploads are parsed server-side (modules/event_coi/store/holder_parse) so CSV and .xlsx share one
// tested parser with the fuzzy header matching. Encode the file to base64 in chunks (avoids call-stack
// limits) and POST it to /api/event-coi/parse.
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

export default function EventCoiSection({ title }) {
  const logRef = usePersistentHeight('log');
  const [event, setEvent] = useState({});
  const [requestor, setRequestor] = useState({});
  const [opts, setOpts] = useState(EMPTY_OPTS);
  const [holders, setHolders] = useState([]);
  const [defaultEmail, setDefaultEmail] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [defaultsNote, setDefaultsNote] = useState('');
  const [runLog, setRunLog] = useState([]);
  const dropInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [coverageMode, setCoverageMode] = useState('all');   // 'all' = Step 2 for everyone; 'perHolder' = each holder's own columns
  const [cardForce, setCardForce] = useState({ open: false, n: 0 });   // collapse/expand-all signal for the step cards
  const [runPanelKey, setRunPanelKey] = useState(0);   // bump to remount RunPanel (clears its screenshot/results) on a full reset

  const setEventField = (k, v) => setEvent((s) => ({ ...s, [k]: v }));
  const setReqField = (k, v) => setRequestor((s) => ({ ...s, [k]: v }));
  const setOpt = (k, v) => setOpts((s) => ({ ...s, [k]: v }));
  const updateHolder = (i, k, v) => setHolders((l) => l.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  const fillColumn = (k, v) => setHolders((l) => l.map((h) => ({ ...h, [k]: v })));   // populate one column for every holder
  const removeHolder = (i) => setHolders((l) => l.filter((_, j) => j !== i));
  const addHolder = () => setHolders((l) => [...l, BLANK_HOLDER()]);

  // Saved defaults (localStorage): the batch-invariant fields — requestor, coverage/delivery, and the
  // default holder email. Auto-applied on first load; the per-event fields are never saved.
  function applyDefaults(d) {
    if (!d) return false;
    if (d.requestor) setRequestor(d.requestor);
    if (d.opts) setOpts({ ...EMPTY_OPTS, ...d.opts });
    if (typeof d.defaultEmail === 'string') setDefaultEmail(d.defaultEmail);
    return true;
  }
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || 'null'); if (d) { applyDefaults(d); setDefaultsNote('Loaded your saved defaults.'); } } catch (e) { /* ignore */ }
  }, []);
  function saveDefaults() {
    try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ requestor, opts, defaultEmail })); setDefaultsNote('Defaults saved (requestor + coverage/delivery + default email).'); }
    catch (e) { setDefaultsNote('Could not save defaults.'); }
  }
  function loadDefaults() {
    try { const d = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || 'null'); setDefaultsNote(applyDefaults(d) ? 'Defaults loaded.' : 'No saved defaults yet.'); }
    catch (e) { setDefaultsNote('No saved defaults yet.'); }
  }
  function clearDefaults() {
    try { localStorage.removeItem(DEFAULTS_KEY); } catch (e) { /* ignore */ }
    setDefaultsNote('Saved defaults cleared.');
  }

  async function onFile(file) {
    if (!file) return;
    setFileNote(`Parsing “${file.name}”…`);
    try {
      const buf = await file.arrayBuffer();
      const r = await api.coiParse(file.name, bufToB64(buf));
      if (r.status === 200 && r.body && r.body.ok) {
        const hs = r.body.holders || [];
        setHolders(hs);
        if (anyHolderHasCoverage(hs)) setCoverageMode('perHolder');
        const sheetNote = r.body.sheet && r.body.sheet !== '(csv)' ? ` (sheet: ${r.body.sheet})` : '';
        setFileNote(`Loaded ${r.body.count} holders from “${file.name}”${sheetNote}.`);
      } else {
        setFileNote((r.body && r.body.error) || 'Could not parse that file.');
      }
    } catch (e) {
      setFileNote('Upload failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  function applyDefaultEmail() {
    if (!defaultEmail) return;
    setHolders((l) => l.map((h) => ({ ...h, email: h.email || defaultEmail })));
  }
  function fillTestValues() {
    setEvent(TEST_EVENT); setRequestor(TEST_REQUESTOR); setOpts(TEST_OPTIONS);
    setHolders(TEST_HOLDERS.map((h) => ({ ...h }))); setDefaultEmail(TEST_REQUESTOR.email);
    setCoverageMode('perHolder'); setFileNote('Filled with test values (per-holder coverage).');
  }
  // Complete reset: wipe every field the user entered — event, requestor, coverage/delivery, holders,
  // notes, and the submission log — and best-effort clear any lingering server-side run so the next
  // Start is clean. Saved defaults (localStorage) are intentionally kept; use "Clear defaults" for those.
  async function resetAll() {
    if (typeof window !== 'undefined' && window.confirm &&
        !window.confirm('Reset the whole page? This clears the event, requestor, coverage/delivery options, all holders, and the submission log. Your saved defaults are kept.')) return;
    setEvent({}); setRequestor({}); setOpts(EMPTY_OPTS); setHolders([]); setDefaultEmail('');
    setFileNote(''); setRunLog([]); setDefaultsNote('Page reset — saved defaults kept.');
    setRunPanelKey((k) => k + 1); setCoverageMode('all');   // remount RunPanel so its displayed screenshot + results clear too
    try { await api.coiRunReset(); } catch (e) { /* best-effort: clear any stuck run on the server */ }
  }
  // Clear ONLY the run / generated form below (remount RunPanel + drop the log + stop any server run).
  // Keeps the event, requestor, holders, and Step 2 — use after editing the grid so no stale form lingers.
  function resetRunPanel() {
    setRunPanelKey((k) => k + 1);
    setRunLog([]);
    try { api.coiRunReset(); } catch (e) { /* best-effort */ }
  }

  const missingNames = useMemo(() => holders.filter((h) => !String(h.name || '').trim()).length, [holders]);
  const missingEmails = useMemo(() => holders.filter((h) => !String(h.email || '').trim()).length, [holders]);
  const sanctionOk = /^\d{6}$/.test(event.sanctionId || '');
  const emailOk = /.+@.+\..+/.test((requestor.email || '').trim());
  // Required to enable the run: key Step-1 fields + at least one holder, each with the portal-required
  // Holder Name + Holder Email. `problems` lists what's still missing so the user knows why it's disabled.
  const problems = [];
  if (!sanctionOk) problems.push('Sanction ID (6 digits)');
  if (!(event.eventName || '').trim()) problems.push('Event Name');
  if (!(event.eventStartDate || '').trim()) problems.push('Event Start Date');
  if (!(event.eventEndDate || '').trim()) problems.push('Event End Date');
  if (!(requestor.name || '').trim()) problems.push('Your Name');
  if (!(requestor.email || '').trim()) problems.push('Your Email Address');
  else if (!emailOk) problems.push('a valid requestor email');
  if (holders.length === 0) problems.push('at least one holder');
  if (missingNames) problems.push(`${missingNames} holder name${missingNames === 1 ? '' : 's'}`);
  if (missingEmails) problems.push(`${missingEmails} holder email${missingEmails === 1 ? '' : 's'}`);
  const ready = problems.length === 0;

  const stepTitle = (n, label, sub) => (
    <span className="coi-cardhead">
      <span className="coi-step-n">{n}</span>
      <span className="coi-cardtitle">{label}</span>
      {sub ? <span className="muted small coi-cardsub">{sub}</span> : null}
    </span>
  );
  const holderExport = holders.length ? (
    <span className="coi-export">
      <span className="muted small">Export</span>
      <a className="coi-dl" title="Download holders as CSV" onClick={() => exportCsv(HOLDER_COLS, holders, 'event_coi_holders')}>CSV</a>
      <a className="coi-dl" title="Download holders as Excel" onClick={() => exportExcel(HOLDER_COLS, holders, 'event_coi_holders')}>Excel</a>
    </span>
  ) : null;

  const logRows = runLog.map((j, i) => ({ num: (j.index != null ? j.index : i) + 1, time: fmtLogTime(j.at), holder: j.name, status: j.status, confirmation: j.confirmation || '', detail: j.error || '' }));

  // Export the results as a ZIP bundling the CSV together with the captured PNG screenshots — an .xls
  // can't embed images, so the download is a folder: results.csv + form/<n>.png + confirmation/<n>.png.
  // The CSV gains two columns pointing at each row's image files so the sheet stays cross-referenced.
  function exportZip() {
    if (!runLog.length) return;
    const safe = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'holder';
    const entries = [];
    const rows = runLog.map((j, i) => {
      const n = (j.index != null ? j.index : i) + 1;
      const base = `${String(n).padStart(3, '0')}_${safe(j.name)}`;
      let formFile = '', confFile = '';
      if (j.formScreenshot) { formFile = `form/${base}.png`; entries.push({ name: formFile, data: b64ToBytes(j.formScreenshot) }); }
      if (j.confirmScreenshot) { confFile = `confirmation/${base}.png`; entries.push({ name: confFile, data: b64ToBytes(j.confirmScreenshot) }); }
      return { num: n, time: fmtLogTime(j.at), holder: j.name, status: j.status, confirmation: j.confirmation || '', detail: j.error || '', form_image: formFile, confirmation_image: confFile };
    });
    const cols = [...LOG_COLS, { key: 'form_image', label: 'Form Image' }, { key: 'confirmation_image', label: 'Confirmation Image' }];
    const esc = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n');
    entries.unshift({ name: 'results.csv', data: new TextEncoder().encode(csv) });
    const blob = makeZip(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'event_coi_results.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const hasShots = runLog.some((j) => j.formScreenshot || j.confirmScreenshot);

  return (
    <div className="page">
      <h2>{title || 'Insurance COI'}</h2>
      <p className="muted">
        Request a Certificate of Insurance for each holder on a sanctioned event. Enter the event,
        requestor, and coverage options once, upload the holder list, review, then submit — one
        certificate per holder.
      </p>

      <div className="coi-defaults">
        <button className="btn" onClick={saveDefaults}>Save as defaults</button>
        <button className="btn" onClick={loadDefaults}>Load defaults</button>
        <button className="btn" onClick={clearDefaults}>Clear defaults</button>
        <span className="muted small">{defaultsNote || 'Saves requestor + coverage/delivery + default email for next time.'}</span>
        <button className="btn coi-collapse" style={{ marginLeft: 'auto' }} onClick={() => setCardForce((c) => ({ open: !c.open, n: c.n + 1 }))} title="Collapse or expand all step cards">{cardForce.open ? 'Collapse all' : 'Expand all'}</button>
        <button className="btn coi-reset" style={{ marginLeft: 0 }} onClick={resetAll} title="Clear everything on the page — event, requestor, coverage/delivery, all holders, and the submission log. Saved defaults are kept.">Form reset</button>
      </div>


      {/* Prominent dropzone — upload the certificate-holder list up front (parsed on the server, nothing stored). */}
      <div
        className={'coi-drop' + (dragOver ? ' coi-drop-over' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); }}
        onClick={() => dropInputRef.current && dropInputRef.current.click()}
        role="button" tabIndex={0}
      >
        <input ref={dropInputRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; onFile(f); }} />
        <div className="coi-drop-icon" aria-hidden="true">&uarr;</div>
        <div className="coi-drop-title">Drop a certificate-holder .xlsx or .csv file here</div>
        <div className="coi-drop-sub">or tap to choose &mdash; parsed on the server, nothing is stored</div>
        <div className="coi-drop-actions">
          <button type="button" className="btn" onClick={(e) => { e.stopPropagation(); fillTestValues(); }}>&#9654; Try me (fake data)</button>
          <a className="btn" href={TEMPLATE_URL} download onClick={(e) => e.stopPropagation()}>&darr; Template</a>
        </div>
        {fileNote && <div className="muted small coi-drop-note">{fileNote}</div>}
      </div>

      {/* STEP 1 — Event + Requestor (entered once) */}
      <CollapsibleCard defaultOpen={cardForce.open} forceOpen={cardForce.open} forceKey={cardForce.n} title={stepTitle('1', 'Event & requestor', 'Entered once — applied to every certificate.')}>
        <div className="coi-cols">
          <div>
            <div className="coi-subhead">Event details</div>
            <div className="coi-form">
              {EVENT_FIELDS.map((f) => {
                const invalid = f.digits && (event[f.key] || '').length > 0 && !new RegExp(`^\\d{${f.digits}}$`).test(event[f.key] || '');
                return (
                  <label key={f.key} className="coi-row"><span>{f.label}{f.req ? <span className="coi-req"> *</span> : null}</span>
                    {f.date ? (
                      <input
                        type="date"
                        className="coi-input coi-date"
                        value={mdyToIso(event[f.key] || '')}
                        onChange={(e) => setEventField(f.key, isoToMdy(e.target.value))}
                      />
                    ) : (
                      <input
                        className={'coi-input' + (invalid ? ' coi-input-warn' : '')}
                        placeholder={f.ph || ''}
                        inputMode={f.digits ? 'numeric' : undefined}
                        maxLength={f.digits || f.maxLen || undefined}
                        title={f.digits ? `Must be a ${f.digits}-digit number` : undefined}
                        value={event[f.key] || ''}
                        onChange={(e) => { let v = e.target.value; if (f.digits) v = v.replace(/\D/g, '').slice(0, f.digits); else if (f.maxLen) v = v.slice(0, f.maxLen); setEventField(f.key, v); }}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="coi-subhead">Requestor's contact information</div>
            <div className="coi-form">
              {REQUESTOR_FIELDS.map((f) => (
                <label key={f.key} className="coi-row"><span>{f.label}{f.req ? <span className="coi-req"> *</span> : null}</span>
                  <input
                    className="coi-input"
                    type={f.type || 'text'}
                    placeholder={f.ph || ''}
                    maxLength={f.maxLen || undefined}
                    value={requestor[f.key] || ''}
                    onChange={(e) => setReqField(f.key, f.maxLen ? e.target.value.slice(0, f.maxLen) : e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* STEP 2 — Coverage & delivery (entered once) */}
      <CollapsibleCard defaultOpen={cardForce.open} forceOpen={cardForce.open} forceKey={cardForce.n} title={stepTitle('2', 'Coverage & delivery', 'Entered once — optional on the portal.')}>
        <div className="coi-covtoggle">
          <label className={'coi-covopt' + (coverageMode === 'perHolder' ? ' sel' : '')}>
            <input type="radio" name="coi-covmode" checked={coverageMode === 'perHolder'} onChange={() => setCoverageMode('perHolder')} />
            <span><b>Use per-holder info from the sheet</b> <span className="muted small">- each certificate uses that holder's own coverage columns in the grid below.</span></span>
          </label>
          <label className={'coi-covopt' + (coverageMode === 'all' ? ' sel' : '')}>
            <input type="radio" name="coi-covmode" checked={coverageMode === 'all'} onChange={() => setCoverageMode('all')} />
            <span><b>Apply the same options to all</b> <span className="muted small">- one coverage set stamped on every certificate (below).</span></span>
          </label>
        </div>
        <div className={'coi-cov-body' + (coverageMode === 'perHolder' ? ' coi-cov-off' : '')}>
          {coverageMode === 'perHolder' ? <div className="coi-cov-note">Managed per holder in the grid below &darr;</div> : null}
        <div className="coi-optrow">
          <div className="coi-optlabel">Does the Holder require any of the following to be included on the certificate of insurance? <span className="muted small">(Check All That Apply)</span></div>
          <div className="coi-optbody">
            {COVERAGE.map(([k, label]) => (
              <label key={k} className="coi-check"><input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpt(k, e.target.checked)} /> {label}</label>
            ))}
            <label className="coi-check"><input type="checkbox" checked={!!opts.coverageOther} onChange={(e) => setOpt('coverageOther', e.target.checked)} /> <span>Other</span>
              <input className="coi-otherinput" placeholder="specify" maxLength={100} value={opts.coverageOtherText} onChange={(e) => setOpt('coverageOtherText', e.target.value.slice(0, 100))} /></label>
          </div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">Is a Written Contract in Place? <span className="muted small">Additional Insured and Waiver of Subrogation requests require a written contract to be in place between the Club and the Certificate Holder</span></div>
          <div className="coi-optbody">
            <label className="coi-check"><input type="radio" name="coi-contract" checked={opts.contract === 'yes'} onChange={() => setOpt('contract', 'yes')} /> Yes</label>
            <label className="coi-check"><input type="radio" name="coi-contract" checked={opts.contract === 'no'} onChange={() => setOpt('contract', 'no')} /> No</label>
          </div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">What is the relationship between the Sanctioned Event and the Certificate Holder? <span className="muted small">(Check only 1 option)</span></div>
          <div className="coi-optbody">
            {RELATIONSHIP.map(([k, label]) => (
              <label key={k} className="coi-check"><input type="radio" name="coi-rel" checked={opts.relationship === k} onChange={() => setOpt('relationship', k)} /> {label}</label>
            ))}
            <label className="coi-check"><input type="radio" name="coi-rel" checked={opts.relationship === 'other'} onChange={() => setOpt('relationship', 'other')} /> <span>Other</span>
              <input className="coi-otherinput" placeholder="specify" maxLength={150} value={opts.relationshipOtherText} onChange={(e) => setOpt('relationshipOtherText', e.target.value.slice(0, 150))} /></label>
          </div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">Additional Information</div>
          <div className="coi-optbody"><input className="coi-input" maxLength={500} value={opts.additionalInfo} onChange={(e) => setOpt('additionalInfo', e.target.value.slice(0, 500))} /></div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">Delivery Method</div>
          <div className="coi-optbody">
            {DELIVERY.map(([k, label]) => (
              <label key={k} className="coi-check"><input type="radio" name="coi-delivery" checked={opts.delivery === k} onChange={() => setOpt('delivery', k)} /> {label}</label>
            ))}
            <label className="coi-check"><input type="radio" name="coi-delivery" checked={opts.delivery === 'other'} onChange={() => setOpt('delivery', 'other')} /> <span>Other</span>
              <input className="coi-otherinput" placeholder="specify" maxLength={100} value={opts.deliveryOtherText} onChange={(e) => setOpt('deliveryOtherText', e.target.value.slice(0, 100))} /></label>
          </div>
        </div>
        </div>
      </CollapsibleCard>

      {/* STEP 3 — Holders */}
      <CollapsibleCard defaultOpen={cardForce.open} forceOpen={cardForce.open} forceKey={cardForce.n} title={stepTitle('3', 'Certificate holders', `${holders.length} holder${holders.length === 1 ? '' : 's'} — one certificate each.`)} actions={holderExport}>
        <div className="coi-toolrow">
          <label className="btn coi-filebtn">Upload CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; onFile(f); }} /></label>
          <a className="btn" href={TEMPLATE_URL} download>↓ Template</a>
          <button className="btn" onClick={addHolder}>+ Add row</button>
          <span className="coi-defemail">Default holder email
            <input className="coi-input" style={{ width: 220 }} placeholder="fills blank emails" value={defaultEmail} onChange={(e) => setDefaultEmail(e.target.value)} />
            <button className="btn" onClick={applyDefaultEmail}>Apply</button>
          </span>
        </div>
        {fileNote && <p className="muted small coi-note">{fileNote}</p>}
        <HolderTable holders={holders} onChange={updateHolder} onRemove={removeHolder} showCoverage={coverageMode === 'perHolder'} sharedOptions={opts} onFillColumn={fillColumn} />
      </CollapsibleCard>

      {/* STEP 4 — Review & run (mocked in Phase 1) */}
      <CollapsibleCard defaultOpen={cardForce.open} forceOpen={cardForce.open} forceKey={cardForce.n} title={stepTitle('4', 'Review & submit')} actions={<a className="coi-dl" title="Clear the generated form / run below and start fresh (keeps your event, requestor, and holders)" onClick={resetRunPanel}>Reset</a>}>
        <dl className="coi-summary">
          <div><dt>Event</dt><dd>{event.eventName || <span className="coi-req">— missing —</span>}{sanctionOk ? ` · Sanction ${event.sanctionId}` : <span className="coi-req"> · Sanction ID must be 6 digits</span>}</dd></div>
          <div><dt>Dates</dt><dd>{event.eventStartDate || '—'} → {event.eventEndDate || '—'}</dd></div>
          <div><dt>Requestor</dt><dd>{requestor.name || <span className="coi-req">— missing —</span>}{requestor.email ? ` · ${requestor.email}` : ''}</dd></div>
          <div><dt>Certificates</dt><dd>{holders.length}{missingNames || missingEmails ? <span className="coi-req"> · {missingNames} missing name, {missingEmails} missing email</span> : ''}</dd></div>
        </dl>
        <RunPanel key={runPanelKey} request={{ event, requestor, options: opts }} holders={holders} ready={ready} problems={problems} onLog={setRunLog} coverageMode={coverageMode} />
      </CollapsibleCard>

      {/* STEP 5 — Submission log */}
      <CollapsibleCard defaultOpen={cardForce.open} forceOpen={cardForce.open} forceKey={cardForce.n}
        title={stepTitle('5', 'Submission log', runLog.length ? `${runLog.length} processed` : 'Each certificate as it is submitted')}
        actions={runLog.length ? (
          <span className="coi-export">
            <span className="muted small">Export</span>
            <a className="coi-dl" onClick={() => exportCsv(LOG_COLS, logRows, 'event_coi_results')}>CSV</a>
            <a className="coi-dl" onClick={() => exportExcel(LOG_COLS, logRows, 'event_coi_results')}>Excel</a>
            <a className="coi-dl" title={hasShots ? 'Download a ZIP: results CSV + the captured form/confirmation images' : 'No captured images yet'} onClick={hasShots ? exportZip : undefined} style={hasShots ? undefined : { opacity: 0.5, cursor: 'default' }}>ZIP + images</a>
          </span>
        ) : null}
      >
        {runLog.length === 0 ? (
          <p className="muted">Jobs appear here as the run processes each holder — time, status, confirmation number, and a link to view the form.</p>
        ) : (
          <div className="coi-log-wrap" ref={logRef}>
            <table className="grid coi-log">
              <thead><tr><th>#</th><th>Time</th><th>Holder</th><th>Status</th><th>Confirmation</th><th>Detail</th><th>Form</th></tr></thead>
              <tbody>
                {runLog.map((j, i) => (
                  <tr key={i}>
                    <td className="coi-rownum">{(j.index != null ? j.index : i) + 1}</td>
                    <td className="muted small coi-log-time">{fmtLogTime(j.at)}</td>
                    <td>{j.name}</td>
                    <td className={j.status === 'failed' ? 'coi-req' : ''}>{j.status}</td>
                    <td>{j.confirmation || ''}{j.confirmScreenshot ? <>{' '}<a className="coi-dl" href="#" onClick={(e) => { e.preventDefault(); openFull(j.confirmScreenshot); }}>page ↗</a></> : null}</td>
                    <td className="muted small">{j.error || ''}</td>
                    <td>{j.formScreenshot ? <a className="coi-dl" href="#" onClick={(e) => { e.preventDefault(); openFull(j.formScreenshot); }}>View ↗</a> : <span className="muted small">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

    </div>
  );
}

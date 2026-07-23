// event_coi — Event / Race Certificate Request builder.
// Enter the event, requestor, and coverage/delivery options once, upload the certificate-holder list,
// review/edit, then (Phase 3-4) drive the CSR24 portal to submit one certificate per holder. Phase 1 =
// UI/UX only; the run is mocked.
//
// Reuses the platform shell primitives (.page, .card, .btn), the merge app's CollapsibleCard, and its
// client CSV/Excel export approach; only the COI form, holder table, and test-fill tool are unique.
// Portal field-name mapping lives in plans_and_notes/insurance_coi/RECON_portal_form_map.md.
// Only Holder Name + Holder Email are required by the portal; the coverage/delivery fields are optional.
import { useEffect, useMemo, useState } from 'react';
import CollapsibleCard from '../salesforce_merge/components/CollapsibleCard.jsx'; // shared UI primitive (could move to web/src/components later)
import HolderTable from './components/HolderTable.jsx';
import { exportCsv, exportExcel } from './lib/exportRows.js';
import { TEST_EVENT, TEST_REQUESTOR, TEST_OPTIONS, TEST_HOLDERS } from './lib/testData.js';
import './event_coi.css';

// Flip to false (or delete the testData import + this block) to hide the test-fill tools for production.
const SHOW_TEST_TOOLS = true;

const DEFAULTS_KEY = 'usatapps_event_coi_defaults';   // localStorage; Phase 2 can move to a server settings store like merge.

const EVENT_FIELDS = [
  { key: 'sanctionId', label: 'USA Triathlon Sanction ID #', digits: 6, ph: '6-digit number', req: true },
  { key: 'eventName', label: 'Event Name', req: true },
  { key: 'eventLocationName', label: 'Event Location Name' },
  { key: 'eventAddress', label: 'Event Address' },
  { key: 'eventStartDate', label: 'Event Start Date', ph: 'MM/DD/YYYY', req: true },
  { key: 'eventEndDate', label: 'Event End Date', ph: 'MM/DD/YYYY', req: true },
];
const REQUESTOR_FIELDS = [
  { key: 'name', label: 'Your Name', req: true },
  { key: 'email', label: 'Your Email Address', type: 'email', req: true },
  { key: 'phone', label: 'Your Phone Number' },
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

const EMPTY_OPTS = {
  additionalInsured: false, aiPrimaryNonContrib: false, waiverOfSubrogation: false, noticeOfCancellation: false,
  coverageOther: false, coverageOtherText: '',
  contract: '', relationship: '', relationshipOtherText: '', additionalInfo: '',
  delivery: '', deliveryOtherText: '',
};

const TEMPLATE_URL = (((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/').replace(/\/+$/, '')) + '/event_coi_template.xlsx';
const BLANK_HOLDER = () => ({ name: '', address: '', city: '', state: '', zip: '', email: '' });

// Fuzzy header matching so uploads work even when columns are named loosely ("st" for State,
// "Postal Code" for Zip, "Holder Name" for Name, etc.). Headers are normalized (lowercased, all
// non-alphanumerics stripped) then matched against these alias sets. Phase 2 mirrors this server-side.
const HEADER_ALIASES = {
  name: ['name', 'holdername', 'holder', 'certificateholder', 'certholder', 'company', 'companyname', 'organization', 'organizationname', 'entity', 'businessname', 'insured'],
  address: ['addressline1', 'address1', 'address', 'addr', 'street', 'streetaddress', 'mailingaddress', 'addressline', 'line1'],
  address2: ['addressline2', 'address2', 'addr2', 'line2', 'suite', 'unit', 'apt'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province', 'stateprovince', 'region'],
  zip: ['zip', 'zipcode', 'postalcode', 'postal', 'postcode', 'zippostalcode'],
  email: ['email', 'emailaddress', 'holderemail', 'holderemailaddress', 'mail', 'contactemail', 'emailaddr'],
};
const normHeader = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Minimal CSV reader for the Phase-1 UI (full xlsx parsing moves server-side in Phase 2, reusing the
// same HEADER_ALIASES).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  const H = split(lines[0]).map(normHeader);
  const find = (key) => H.findIndex((h) => HEADER_ALIASES[key].includes(h));
  const iName = find('name'), iA1 = find('address'), iA2 = find('address2');
  const iCity = find('city'), iState = find('state'), iZip = find('zip'), iEmail = find('email');
  const out = [];
  for (let r = 1; r < lines.length; r++) {
    const c = split(lines[r]);
    const address = [iA1 >= 0 ? c[iA1] : '', iA2 >= 0 ? c[iA2] : ''].filter(Boolean).join(' ');
    const row = {
      name: iName >= 0 ? c[iName] || '' : '', address,
      city: iCity >= 0 ? c[iCity] || '' : '', state: iState >= 0 ? c[iState] || '' : '',
      zip: iZip >= 0 ? c[iZip] || '' : '', email: iEmail >= 0 ? c[iEmail] || '' : '',
    };
    if (row.name || row.address) out.push(row);
  }
  return out;
}

export default function EventCoiSection({ title }) {
  const [event, setEvent] = useState({});
  const [requestor, setRequestor] = useState({});
  const [opts, setOpts] = useState(EMPTY_OPTS);
  const [holders, setHolders] = useState([]);
  const [defaultEmail, setDefaultEmail] = useState('');
  const [fileNote, setFileNote] = useState('');
  const [defaultsNote, setDefaultsNote] = useState('');

  const setEventField = (k, v) => setEvent((s) => ({ ...s, [k]: v }));
  const setReqField = (k, v) => setRequestor((s) => ({ ...s, [k]: v }));
  const setOpt = (k, v) => setOpts((s) => ({ ...s, [k]: v }));
  const updateHolder = (i, k, v) => setHolders((l) => l.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
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

  function onFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setFileNote('Excel (.xlsx) parsing arrives in Phase 2 (server-side). For now upload a CSV, or use “Fill test values”.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCsv(String(e.target.result));
      setHolders(rows);
      setFileNote(`Loaded ${rows.length} holders from “${file.name}”.`);
    };
    reader.readAsText(file);
  }

  function applyDefaultEmail() {
    if (!defaultEmail) return;
    setHolders((l) => l.map((h) => ({ ...h, email: h.email || defaultEmail })));
  }
  function fillTestValues() {
    setEvent(TEST_EVENT); setRequestor(TEST_REQUESTOR); setOpts(TEST_OPTIONS);
    setHolders(TEST_HOLDERS.map((h) => ({ ...h }))); setDefaultEmail(TEST_REQUESTOR.email);
    setFileNote('Filled with test values.');
  }
  function clearAll() {
    setEvent({}); setRequestor({}); setOpts(EMPTY_OPTS); setHolders([]); setDefaultEmail(''); setFileNote('Cleared.');
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
    <>
      <span className="coi-step-n">{n}</span>
      <span className="coi-cardtitle">{label}</span>
      {sub ? <span className="muted small coi-cardsub">{sub}</span> : null}
    </>
  );
  const holderExport = holders.length ? (
    <span className="coi-export">
      <span className="muted small">Export</span>
      <a className="coi-dl" title="Download holders as CSV" onClick={() => exportCsv(HOLDER_COLS, holders, 'event_coi_holders')}>CSV</a>
      <a className="coi-dl" title="Download holders as Excel" onClick={() => exportExcel(HOLDER_COLS, holders, 'event_coi_holders')}>Excel</a>
    </span>
  ) : null;

  return (
    <div className="page">
      <h2>{title || 'Event COI'}</h2>
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
      </div>

      {SHOW_TEST_TOOLS && (
        <div className="coi-testbar">
          <span className="coi-testbar-label">🧪 Test tools</span>
          <button className="btn" onClick={fillTestValues}>Fill test values</button>
          <button className="btn" onClick={clearAll}>Clear values</button>
          <span className="muted small">Fill populates the form + sample holders; Clear resets everything.</span>
        </div>
      )}

      {/* STEP 1 — Event + Requestor (entered once) */}
      <CollapsibleCard title={stepTitle('1', 'Event & requestor', 'Entered once — applied to every certificate.')}>
        <div className="coi-cols">
          <div>
            <div className="coi-subhead">Event details</div>
            <div className="coi-form">
              {EVENT_FIELDS.map((f) => {
                const invalid = f.digits && (event[f.key] || '').length > 0 && !new RegExp(`^\\d{${f.digits}}$`).test(event[f.key] || '');
                return (
                  <label key={f.key} className="coi-row"><span>{f.label}{f.req ? <span className="coi-req"> *</span> : null}</span>
                    <input
                      className={'coi-input' + (invalid ? ' coi-input-warn' : '')}
                      placeholder={f.ph || ''}
                      inputMode={f.digits ? 'numeric' : undefined}
                      maxLength={f.digits || undefined}
                      title={f.digits ? `Must be a ${f.digits}-digit number` : undefined}
                      value={event[f.key] || ''}
                      onChange={(e) => setEventField(f.key, f.digits ? e.target.value.replace(/\D/g, '').slice(0, f.digits) : e.target.value)}
                    />
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
                  <input className="coi-input" type={f.type || 'text'} value={requestor[f.key] || ''} onChange={(e) => setReqField(f.key, e.target.value)} />
                </label>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* STEP 2 — Coverage & delivery (entered once) */}
      <CollapsibleCard title={stepTitle('2', 'Coverage & delivery', 'Entered once — optional on the portal.')}>
        <div className="coi-optrow">
          <div className="coi-optlabel">Does the Holder require any of the following to be included on the certificate of insurance? <span className="muted small">(Check All That Apply)</span></div>
          <div className="coi-optbody">
            {COVERAGE.map(([k, label]) => (
              <label key={k} className="coi-check"><input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpt(k, e.target.checked)} /> {label}</label>
            ))}
            <label className="coi-check"><input type="checkbox" checked={!!opts.coverageOther} onChange={(e) => setOpt('coverageOther', e.target.checked)} /> <span>Other</span>
              <input className="coi-otherinput" placeholder="specify" value={opts.coverageOtherText} onChange={(e) => setOpt('coverageOtherText', e.target.value)} /></label>
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
              <input className="coi-otherinput" placeholder="specify" value={opts.relationshipOtherText} onChange={(e) => setOpt('relationshipOtherText', e.target.value)} /></label>
          </div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">Additional Information</div>
          <div className="coi-optbody"><input className="coi-input" value={opts.additionalInfo} onChange={(e) => setOpt('additionalInfo', e.target.value)} /></div>
        </div>
        <div className="coi-optrow">
          <div className="coi-optlabel">Delivery Method</div>
          <div className="coi-optbody">
            {DELIVERY.map(([k, label]) => (
              <label key={k} className="coi-check"><input type="radio" name="coi-delivery" checked={opts.delivery === k} onChange={() => setOpt('delivery', k)} /> {label}</label>
            ))}
            <label className="coi-check"><input type="radio" name="coi-delivery" checked={opts.delivery === 'other'} onChange={() => setOpt('delivery', 'other')} /> <span>Other</span>
              <input className="coi-otherinput" placeholder="specify" value={opts.deliveryOtherText} onChange={(e) => setOpt('deliveryOtherText', e.target.value)} /></label>
          </div>
        </div>
      </CollapsibleCard>

      {/* STEP 3 — Holders */}
      <CollapsibleCard title={stepTitle('3', 'Certificate holders', `${holders.length} holder${holders.length === 1 ? '' : 's'} — one certificate each.`)} actions={holderExport}>
        <div className="coi-toolrow">
          <label className="btn coi-filebtn">Upload CSV<input type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => onFile(e.target.files[0])} /></label>
          <a className="btn" href={TEMPLATE_URL} download>↓ Template</a>
          <button className="btn" onClick={addHolder}>+ Add row</button>
          <span className="coi-defemail">Default holder email
            <input className="coi-input" style={{ width: 220 }} placeholder="fills blank emails" value={defaultEmail} onChange={(e) => setDefaultEmail(e.target.value)} />
            <button className="btn" onClick={applyDefaultEmail}>Apply</button>
          </span>
        </div>
        {fileNote && <p className="muted small coi-note">{fileNote}</p>}
        <HolderTable holders={holders} onChange={updateHolder} onRemove={removeHolder} />
      </CollapsibleCard>

      {/* STEP 4 — Review & run (mocked in Phase 1) */}
      <CollapsibleCard title={stepTitle('4', 'Review & submit')}>
        <dl className="coi-summary">
          <div><dt>Event</dt><dd>{event.eventName || <span className="coi-req">— missing —</span>}{sanctionOk ? ` · Sanction ${event.sanctionId}` : <span className="coi-req"> · Sanction ID must be 6 digits</span>}</dd></div>
          <div><dt>Dates</dt><dd>{event.eventStartDate || '—'} → {event.eventEndDate || '—'}</dd></div>
          <div><dt>Requestor</dt><dd>{requestor.name || <span className="coi-req">— missing —</span>}{requestor.email ? ` · ${requestor.email}` : ''}</dd></div>
          <div><dt>Certificates</dt><dd>{holders.length}{missingNames || missingEmails ? <span className="coi-req"> · {missingNames} missing name, {missingEmails} missing email</span> : ''}</dd></div>
        </dl>
        <div className="coi-runrow">
          <button className="btn primary" disabled={!ready} onClick={() => alert('Phase 1 preview — the Playwright login + per-holder submit loop is wired in Phase 3-4.')}>Start submission loop →</button>
          {ready
            ? <span className="muted small">Login + per-certificate review/submit runs in a later phase.</span>
            : <span className="coi-req small">Complete before submitting: {problems.join(', ')}.</span>}
        </div>
      </CollapsibleCard>
    </div>
  );
}

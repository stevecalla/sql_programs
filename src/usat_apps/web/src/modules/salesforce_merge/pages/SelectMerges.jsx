import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DatasetStamp from '../components/DatasetStamp.jsx';
import { api, exportUrl } from '../lib/api.js';

const PAGE = 200;

const isBlank = (v) => v == null || String(v).trim() === '';
const val = (v) => (isBlank(v) ? '—' : String(v));
const shortId = (id) => (id && id.length > 8 ? '…' + id.slice(-5) : id || '');
const acctName = (a) => (a.Name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || '—');
const acctCreated = (a) => a.CreatedDate || '';
const acctMergeId = (a) => a.usat_Salesforce_Merge_Id__pc || a.merge_id || '';
const acctMember = (a) => String(a.member_number || a.cfg_Member_Number__pc || '').trim();
const acctContact = (a) => a.contact || '';
const fmtNames = (s) => (s ? String(s).split(';').map((x) => x.trim()).filter(Boolean).join(', ') : '');
const firstName = (s) => (s ? String(s).split(';')[0].trim() : '');

const RULE_TEXT = 'Merge id → lowest member # → most children → oldest';
const RULE_TOOLTIP = 'Survivor is chosen by this cascade: 1) the account whose Salesforce Id equals the merge id; else 2) the lowest membership number, if any; else 3) the account with the most Salesforce child records; else 4) the oldest account. A merge also needs at least one other account.';
const RULE_LABELS = { merge_id: 'merge id', member_number: 'lowest member #', children: 'most children', oldest: 'oldest', cascade: 'cascade' };
const STXT = { kept: 'kept', filled: 'filled', conflict: 'conflict', empty: 'empty', override: 'override' };

const STATUS = {
  kept: { label: 'master', color: '#1a8a4f' },
  filled: { label: 'filled from other', color: '#185fa5' },
  conflict: { label: 'conflict', color: '#854f0b' },
  override: { label: 'overridden', color: 'var(--accent)' },
  empty: { label: '—', color: 'var(--dim)' },
};

// Accounts-in-cluster columns (resizable; account/merge-id default wider to show full ids).
const ACC_COLS = [
  { id: 'num', label: '#' }, { id: 'master', label: 'Master' }, { id: 'merge', label: 'Merge' },
  { id: 'name', label: 'Name' }, { id: 'account', label: 'Account' }, { id: 'mergeid', label: 'Merge id' },
  { id: 'member', label: 'Member #' }, { id: 'created', label: 'Created' }, { id: 'children', label: 'Children' },
];

// Skeleton primitives — keep the detail area the same height before/while a cluster loads.
const Skel = ({ w = '100%', h = 13, mt = 6 }) => (
  <span className="skel" style={{ display: 'block', width: w, height: h, marginTop: mt }} />
);
const SkelRows = ({ n = 5 }) => (
  <>{Array.from({ length: n }).map((_, i) => <Skel key={i} w={(60 + ((i * 11) % 35)) + '%'} />)}</>
);

function survivorship(accounts, masterId, overrides, fields) {
  const master = accounts.find((a) => a.account === masterId);
  const others = accounts.filter((a) => a !== master);
  return fields.map((f) => {
    if (overrides[f]) {
      const a = accounts.find((x) => x.account === overrides[f]);
      return { field: f, value: a ? a[f] : '', sourceId: overrides[f], status: 'override' };
    }
    const mv = master ? master[f] : '';
    if (!isBlank(mv)) {
      const conflict = others.some((o) => !isBlank(o[f]) && String(o[f]).trim() !== String(mv).trim());
      return { field: f, value: mv, sourceId: masterId, status: conflict ? 'conflict' : 'kept' };
    }
    const fill = others.find((o) => !isBlank(o[f]));
    return { field: f, value: fill ? fill[f] : '', sourceId: fill ? fill.account : null, status: fill ? 'filled' : 'empty' };
  });
}

// Survivor cascade: 1) Salesforce Id = merge id; 2) lowest membership number; 3) most child
// records (when counts are loaded); 4) oldest. A merge also needs at least one other account.
function pickMaster(accounts, children, groupMergeId) {
  if (!accounts.length) return null;
  const gm = groupMergeId || accounts.map((a) => acctMergeId(a)).find(Boolean) || '';
  const byMerge = accounts.find((a) => gm && a.account === gm);
  if (byMerge) return byMerge.account;
  const withMem = accounts.filter((a) => acctMember(a) !== '');
  if (withMem.length) {
    return withMem.reduce((best, a) => {
      const va = Number(acctMember(a)); const vb = Number(acctMember(best));
      return (Number.isFinite(va) && (!Number.isFinite(vb) || va < vb)) ? a : best;
    }, withMem[0]).account;
  }
  if (children) {
    let best = null, bestN = -1;
    for (const a of accounts) { const n = (children[a.account] && children[a.account].total) || 0; if (n > bestN) { bestN = n; best = a; } }
    if (best && bestN > 0) return best.account;
  }
  const dated = accounts.filter((a) => acctCreated(a));
  if (dated.length) return dated.reduce((m, a) => (acctCreated(a) < acctCreated(m) ? a : m), dated[0]).account;
  return accounts[0].account;
}

export default function SelectMerges() {
  const [source, setSource] = useState('merge_id');
  const [midState, setMidState] = useState('');
  const [memState, setMemState] = useState('');
  const [bkState, setBkState] = useState('');
  const [foundationState, setFoundationState] = useState(''); // '' all · 'has' · 'none' (both sources)

  const [clusters, setClusters] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');

  const [selKey, setSelKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [master, setMaster] = useState(null);
  const [manualMaster, setManualMaster] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [children, setChildren] = useState(null);
  const [mergeSel, setMergeSel] = useState(() => new Set());

  const [queue, setQueue] = useState([]);
  const [qSel, setQSel] = useState(() => new Set());
  const [qStatus, setQStatus] = useState('queued');
  const [err, setErr] = useState('');
  const [addErr, setAddErr] = useState('');
  const [note, setNote] = useState('');
  const [railSel, setRailSel] = useState(() => new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [cmpConflictsOnly, setCmpConflictsOnly] = useState(false);
  const [openAccts, setOpenAccts] = useState(true);
  const [openCmp, setOpenCmp] = useState(false);
  const [openQueue, setOpenQueue] = useState(true);
  const [cmpSort, setCmpSort] = useState({ key: null, dir: 'asc' });
  const detailRef = useRef(null);
  const restoreSel = useRef(null);
  const [railH, setRailH] = useState(null);
  useLayoutEffect(() => {
    const el = detailRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRailH(el.offsetHeight));
    ro.observe(el); setRailH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  const [colW, setColW] = useState({ num: 40, master: 64, merge: 64, account: 200, mergeid: 150, name: 170, member: 110, created: 100, children: 80 });
  const accTotalW = ACC_COLS.reduce((t, c) => t + (colW[c.id] || 80), 0);
  const startResize = (id) => (e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = colW[id];
    const onMove = (ev) => setColW((w) => ({ ...w, [id]: Math.max(40, startW + (ev.clientX - startX)) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const load = source === 'merge_id'
      ? api.mergeGroups({ page, page_size: PAGE, q: filter, bucket: bkState, foundation_state: foundationState })
      : api.duplicates({ page, page_size: PAGE, sort: 'size', dir: 'desc', q: filter, merge_id_state: midState, member_number_state: memState, foundation_state: foundationState });
    load.then((r) => { setClusters(r.rows || []); setTotal(Number(r.total) || 0); }).catch((e) => setErr(e.message));
  }, [source, page, filter, midState, memState, bkState, foundationState]);

  useEffect(() => { setRailSel(new Set()); setSelectAllMatching(false); setBulkMsg(''); }, [source, filter, bkState, foundationState]);

  const loadQueue = useCallback(() => {
    api.mergeQueue(qStatus).then((r) => { const rows = r.rows || []; setQueue(rows); setQSel(new Set(rows.map((x) => x.id))); }).catch((e) => setErr(e.message));
  }, [qStatus]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const loadCluster = useCallback((key) => {
    setSelKey(key); setDetail(null); setMaster(null); setManualMaster(false);
    setOverrides({}); setChildren(null); setMergeSel(new Set()); setAddErr(''); setNote('');
    api.clusterDetail(key, source)
      .then((r) => {
        setDetail(r);
        if (r.source === 'salesforce') api.clusterChildren(key, source).then((cr) => setChildren(cr.children || {})).catch(() => setChildren({}));
        else setChildren({});
      })
      .catch((e) => setErr(e.message));
  }, [source]);

  const loadFromQueue = (q) => {
    setSource(q.source_type);
    setSelKey(q.source_key); setDetail(null); setChildren(null); setManualMaster(true);
    setOverrides({}); setAddErr(''); setNote('');
    restoreSel.current = new Set(String(q.loser_accounts || '').split(';').map((x) => x.trim()).filter(Boolean));
    api.clusterDetail(q.source_key, q.source_type)
      .then((r) => {
        setDetail(r); setMaster(q.survivor_account);
        if (r.source === 'salesforce') api.clusterChildren(q.source_key, q.source_type).then((cr) => setChildren(cr.children || {})).catch(() => setChildren({}));
        else setChildren({});
      })
      .catch((e) => setErr(e.message));
  };
  const toggleQ = (id) => setQSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const approveSelected = async () => {
    const ids = [...qSel];
    if (!ids.length) return;
    if (!window.confirm(`Approve ${ids.length} merge${ids.length === 1 ? '' : 's'} for processing? Execution still happens in Phase 3; you can move them back by removing while queued.`)) return;
    try { await api.mergeQueueApprove(ids); loadQueue(); } catch (e) { setErr(e.message); }
  };

  const accounts = (detail && detail.accounts) || [];
  const fields = (detail && detail.fields) || [];

  useEffect(() => {
    if (!detail || manualMaster) return;
    const gm = source === 'merge_id' ? selKey : null;
    const m = pickMaster(accounts, children, gm);
    if (m) setMaster(m);
  }, [detail, children, manualMaster, source, selKey]);

  useEffect(() => {
    if (!detail || !master) return;
    if (restoreSel.current) { setMergeSel(restoreSel.current); restoreSel.current = null; return; }
    setMergeSel(new Set(accounts.filter((a) => a.account !== master).map((a) => a.account)));
  }, [detail, master]);

  const rows = useMemo(() => (accounts.length && master ? survivorship(accounts, master, overrides, fields) : []),
    [accounts, master, overrides, fields]);
  const conflictCount = rows.filter((r) => r.status === 'conflict').length;
  const visibleRows = conflictsOnly ? rows.filter((r) => r.status === 'conflict') : rows;
  const fieldConflict = (fld) => new Set(accounts.map((a) => String(a[fld] == null ? '' : a[fld]).trim()).filter(Boolean)).size > 1;
  const cmpBase = fields.filter((fld) => fld !== 'Name');
  const cmpConflictCount = cmpBase.filter(fieldConflict).length;
  const cmpFields = cmpConflictsOnly ? cmpBase.filter(fieldConflict) : cmpBase;
  const cmpVal = (a, key) => (key === 'name' ? acctName(a) : key === 'account' ? a.account : a[key]);
  const sortedAccounts = useMemo(() => {
    if (!cmpSort.key) return accounts;
    return [...accounts].sort((x, y) => {
      const vx = String(cmpVal(x, cmpSort.key) == null ? '' : cmpVal(x, cmpSort.key)).trim();
      const vy = String(cmpVal(y, cmpSort.key) == null ? '' : cmpVal(y, cmpSort.key)).trim();
      const nx = Number(vx); const ny = Number(vy);
      const c = (vx !== '' && vy !== '' && Number.isFinite(nx) && Number.isFinite(ny)) ? nx - ny : vx.localeCompare(vy);
      return cmpSort.dir === 'asc' ? c : -c;
    });
  }, [accounts, cmpSort]);
  const sortBy = (key) => setCmpSort((st) => ({ key, dir: st.key === key && st.dir === 'asc' ? 'desc' : 'asc' }));
  const sortInd = (key) => (cmpSort.key === key ? (cmpSort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const isSf = detail && detail.source === 'salesforce';
  const childrenLoading = isSf && children === null;
  const childBy = useMemo(() => {
    if (!children) return [];
    const agg = {};
    accounts.filter((a) => a.account !== master).forEach((a) => {
      const by = (children[a.account] && children[a.account].by) || {};
      for (const [k, v] of Object.entries(by)) agg[k] = (agg[k] || 0) + v;
    });
    return Object.entries(agg).sort((x, y) => y[1] - x[1]);
  }, [children, accounts, master]);
  const selLosers = [...mergeSel].filter((id) => id !== master);
  const childTotal = (children && selLosers.reduce((s, id) => s + ((children[id] && children[id].total) || 0), 0)) || 0;
  const apexCalls = Math.ceil(selLosers.length / 2) || 0;

  const isQueued = !!(selKey && master && queue.some((q) => String(q.source_key) === String(selKey) && String(q.survivor_account) === String(master)));

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const setSrc = (s) => { setSource(s); setPage(1); setSelKey(null); setDetail(null); };
  const onFilter = (v) => { setFilter(v); setPage(1); };
  const toggleMerge = (id) => setMergeSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const addToQueue = async () => {
    setAddErr(''); setNote('');
    const masterAcct = accounts.find((a) => a.account === master);
    if (!master || !selLosers.length) { setAddErr('Pick a master and at least one account to merge.'); return; }
    try {
      const childAgg = {}; let ctot = 0;
      selLosers.forEach((id) => { const c = children && children[id]; if (c) { ctot += c.total || 0; for (const [k, v] of Object.entries(c.by || {})) childAgg[k] = (childAgg[k] || 0) + v; } });
      const child_counts = isSf ? { total: ctot, by: childAgg } : null;
      const field_overrides = Object.keys(overrides).length ? overrides : null;
      const r = await api.mergeQueueAdd({ source_type: source, source_key: selKey, survivor_account: master,
        survivor_contact: masterAcct ? acctContact(masterAcct) : '', survivor_name: masterAcct ? acctName(masterAcct) : '',
        loser_accounts: selLosers, master_rule: 'cascade', field_overrides, child_counts });
      setNote(`Queued: master ${shortId(master)} + ${r.loser_count} account${r.loser_count === 1 ? '' : 's'}.`);
      loadQueue();
    } catch (e) { setAddErr(e.message); }
  };
  const removeQueue = async (id) => { try { await api.mergeQueueRemove(id); loadQueue(); } catch (e) { setErr(e.message); } };

  const listLabel = source === 'merge_id' ? 'Merge-id groups' : 'Duplicate groups';
  const addDisabled = !detail || isQueued || !selLosers.length;
  const pageKeys = clusters.map((c) => c.cluster);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => railSel.has(k));
  const selCount = selectAllMatching ? total : railSel.size;
  const toggleRail = (k) => { setSelectAllMatching(false); setRailSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };
  const togglePage = () => { setSelectAllMatching(false); setRailSel((p) => { const n = new Set(p); if (allPageSelected) pageKeys.forEach((k) => n.delete(k)); else pageKeys.forEach((k) => n.add(k)); return n; }); };
  const bulkAdd = async () => {
    const n = selCount;
    if (!n) return;
    if (!window.confirm(`Add ${n} merge${n === 1 ? '' : 's'} to the queue using the survivor cascade (merge id, then lowest membership number)? Groups that need a child-count or oldest tie-break are skipped for single review.`)) return;
    setErr(''); setBulkMsg('');
    try {
      const payload = selectAllMatching ? { source: 'merge_id', q: filter, bucket: bkState, foundation_state: foundationState } : { source: 'merge_id', keys: [...railSel] };
      const r = await api.mergeQueueBulk(payload);
      setBulkMsg(`Queued ${r.queued}` + (r.skipped ? `, ${r.skipped} already queued` : '') + (r.unresolved ? `, ${r.unresolved} skipped (no clear survivor)` : '') + (r.capped ? ' — capped at 1000' : '') + '.');
      setRailSel(new Set()); setSelectAllMatching(false);
      loadQueue();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="mtbl">
      <h2>Select Merges</h2>
      <p className="muted small">Choose what to review, pick the surviving master, select accounts to merge, and add the set to the queue. Read-only — execution is a later phase.</p>
      <DatasetStamp />

      <div style={{ background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', margin: '8px 0 12px', fontSize: 13 }}>
        <strong>Merge execution is OFF</strong> — the queue stages merge sets only. Processing is locked until Phase 3 (write chokepoint, snapshot + history, typed confirm).
      </div>
      {err && <p className="err">{err}</p>}

      {/* DATA SELECT PANEL */}
      <div className="card" style={{ margin: '0 0 12px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <div className="muted small" style={{ marginBottom: 3 }}>Review</div>
            <div className="seg">
              <button type="button" className={'seg-btn' + (source === 'group' ? ' on' : '')} onClick={() => setSrc('group')}>Duplicate groups</button>
              <button type="button" className={'seg-btn' + (source === 'merge_id' ? ' on' : '')} onClick={() => setSrc('merge_id')}>Accounts with merge ids</button>
            </div>
          </div>
          {source === 'group' && (
            <>
              <div>
                <div className="muted small" style={{ marginBottom: 3 }}>Merge ID</div>
                <select className="tb-select" value={midState} onChange={(e) => { setMidState(e.target.value); setPage(1); }}>
                  <option value="">All</option><option value="has">Has merge ID</option><option value="none">No merge ID</option>
                </select>
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 3 }}>Membership #</div>
                <select className="tb-select" value={memState} onChange={(e) => { setMemState(e.target.value); setPage(1); }}>
                  <option value="">All</option><option value="has">Has member #</option><option value="none">No member #</option>
                </select>
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 3 }}>Foundation</div>
                <select className="tb-select" value={foundationState} onChange={(e) => { setFoundationState(e.target.value); setPage(1); }}>
                  <option value="">All</option><option value="has">Is foundation</option><option value="none">Not foundation</option>
                </select>
              </div>
            </>
          )}
          {source === 'merge_id' && (
            <>
              <div>
                <div className="muted small" style={{ marginBottom: 3 }}>Bucket</div>
                <select className="tb-select" value={bkState} onChange={(e) => { setBkState(e.target.value); setPage(1); }}>
                  <option value="">All</option><option value="in_both">In both</option><option value="sf_only">ID only</option>
                </select>
              </div>
              <div>
                <div className="muted small" style={{ marginBottom: 3 }}>Foundation</div>
                <select className="tb-select" value={foundationState} onChange={(e) => { setFoundationState(e.target.value); setPage(1); }}>
                  <option value="">All</option><option value="has">Is foundation</option><option value="none">Not foundation</option>
                </select>
              </div>
            </>
          )}
          <div title={RULE_TOOLTIP} style={{ cursor: 'help' }}>
            <div className="muted small" style={{ marginBottom: 3 }}>Master survivor rule</div>
            <div className="tb-select" style={{ width: 250, display: 'flex', alignItems: 'center' }}>{RULE_TEXT}</div>
          </div>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0', borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          Survivor rule: {RULE_TEXT}. You can override the master below.
        </p>
      </div>

      {/* CARD GROUP: list rail + analysis */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '0 0 280px', minWidth: 0, margin: 0, height: railH || 574, display: 'flex', flexDirection: 'column' }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{listLabel} <span className="muted small" style={{ fontWeight: 400 }}>({total.toLocaleString()})</span></p>
          <input className="search" style={{ width: '100%', marginBottom: 8 }} placeholder="Search: name, id…" value={filter} onChange={(e) => onFilter(e.target.value)} />
          {source === 'merge_id' && (
            <div className="ma-bulk">
              <label className="ma-bulk-all"><input type="checkbox" checked={allPageSelected} onChange={togglePage} /> Page</label>
              <span className="muted small">{selCount} selected</span>
              <button className="btn" style={{ width: 'auto', marginLeft: 'auto' }} disabled={selCount === 0} onClick={bulkAdd}>Add selected</button>
            </div>
          )}
          {source === 'merge_id' && allPageSelected && !selectAllMatching && total > clusters.length && (
            <button type="button" className="linkbtn" style={{ marginBottom: 6 }} onClick={() => setSelectAllMatching(true)}>Select all {total.toLocaleString()} matching</button>
          )}
          {source === 'merge_id' && selectAllMatching && (
            <p className="muted small" style={{ margin: '0 0 6px' }}>All {total.toLocaleString()} matching selected. <button type="button" className="linkbtn" onClick={() => { setSelectAllMatching(false); setRailSel(new Set()); }}>Clear</button></p>
          )}
          {bulkMsg && <p className="muted small" style={{ color: 'var(--accent)', margin: '0 0 6px' }}>{bulkMsg}</p>}
          <div className="dt-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {clusters.map((c, i) => (
              <div key={c.cluster} className="ma-cluster-row">
                {source === 'merge_id' && <input type="checkbox" checked={selectAllMatching || railSel.has(c.cluster)} onChange={() => toggleRail(c.cluster)} aria-label={'Select ' + c.cluster} />}
                <button type="button" onClick={() => loadCluster(c.cluster)} style={{ flex: 1, minWidth: 0 }}
                  className={'ma-cluster' + (selKey === c.cluster ? ' on' : '')}>
                  <div className="ma-cluster-key" title={fmtNames(c.names) || c.cluster}>{(page - 1) * PAGE + i + 1}. {firstName(c.names) || c.cluster}</div>
                  <div className="muted small">{c.size} records · {c.signal}</div>
                </button>
              </div>
            ))}
            {clusters.length === 0 && <p className="muted small">No records.</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button className="btn" style={{ width: 'auto' }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <span className="muted small" style={{ flex: 1, textAlign: 'center' }}>Page {page} of {pages.toLocaleString()}</span>
            <button className="btn" style={{ width: 'auto' }} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Next</button>
          </div>
        </div>

        <div ref={detailRef} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!detail ? (
            <>
              <div className="card" style={{ margin: 0, padding: '8px 14px', height: 48, display: 'flex', alignItems: 'center' }}>
                {!selKey
                  ? <span className="muted">Select a record on the left to review and stage a merge.</span>
                  : <Skel w="42%" h={18} mt={0} />}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'var(--card)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Impact preview (dry-run)</p>
                  <Skel w="80%" /><Skel w="70%" /><Skel w="60%" />
                </div>
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'var(--card)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Child records reparented</p>
                  <Skel w="75%" /><Skel w="65%" /><Skel w="70%" />
                </div>
              </div>
              <div className="card" style={{ margin: 0, background: 'var(--card)', minHeight: 314 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Field survivorship</p>
                <SkelRows n={5} />
              </div>
            </>
          ) : (
            <>
              <div className="card" style={{ margin: 0, padding: '8px 14px', height: 48, display: 'flex', alignItems: 'center', overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%' }}>
                <span style={{ fontWeight: 700, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selKey}>{source === 'merge_id' ? 'merge id ' : ''}{selKey}</span>
                <span className="pill">{accounts.length} accounts</span>
                <span className="pill">{isSf ? 'live Salesforce' : 'local snapshot'}</span>
                {!manualMaster && master && <span className="pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>master auto-picked</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--amber)', background: 'var(--amber-bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '3px 9px' }}>preview only</span>
              </div></div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'var(--card)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Impact preview (dry-run)</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                    <li>{selLosers.length} account{selLosers.length === 1 ? '' : 's'} selected to merge into the master</li>
                    <li>{selLosers.length} losing account{selLosers.length === 1 ? '' : 's'} → Recycle Bin (~15 days)</li>
                    <li>~{apexCalls} merge operation{apexCalls === 1 ? '' : 's'} <span className="muted">(see the Reference page)</span></li>
                  </ul>
                </div>

                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'var(--card)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Child records reparented</p>
                  {!isSf ? (
                    <p className="muted small" style={{ margin: 0 }}>Child-record counts need live Salesforce.</p>
                  ) : childrenLoading ? (
                    <div><Skel w="75%" /><Skel w="65%" /><Skel w="70%" /></div>
                  ) : childBy.length === 0 ? (
                    <p className="muted small" style={{ margin: 0 }}>No child records on the selected accounts.</p>
                  ) : (
                    <div className="dt-scroll" style={{ maxHeight: 150 }}>
                      <table className="modal-table ma-child-table">
                        <thead><tr><th>Object</th><th>Records</th></tr></thead>
                        <tbody>
                          {childBy.map(([label, n]) => (
                            <tr key={label}><td>{label}</td><td>{n}</td></tr>
                          ))}
                          <tr style={{ fontWeight: 700, borderTop: '1px solid var(--line)' }}><td>Total reparented</td><td>{childTotal}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="card" style={{ margin: 0, background: 'var(--card)', minHeight: 314 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
                  <span style={{ fontWeight: 700 }}>Field survivorship</span>
                  {conflictCount > 0 && <span className="pill" style={{ color: '#854f0b', background: 'var(--amber-bg)' }}>{conflictCount} conflict{conflictCount === 1 ? '' : 's'}</span>}
                  <label className="muted small" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={conflictsOnly} onChange={() => setConflictsOnly((v) => !v)} /> Conflicts only</label>
                </div>
                <div className="dt-scroll" style={{ maxHeight: 240 }}>
                  <table className="modal-table">
                    <thead><tr><th>Field</th><th>Result</th><th>From</th><th>Status</th><th>Override</th></tr></thead>
                    <tbody>
                      {visibleRows.map((r) => (
                        <tr key={r.field} style={{ background: r.status === 'conflict' ? 'rgba(180,120,0,.10)' : undefined }}>
                          <td>{r.field}</td>
                          <td title={val(r.value)}>{val(r.value)}</td>
                          <td style={{ color: (STATUS[r.status] || STATUS.empty).color }}>
                            {r.sourceId === master ? 'master' : (r.sourceId ? shortId(r.sourceId) : (STATUS[r.status] || STATUS.empty).label)}
                          </td>
                          <td><span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 20, background: 'rgba(127,127,127,.12)', color: (STATUS[r.status] || STATUS.empty).color }}>{STXT[r.status] || r.status}</span></td>
                          <td>
                            <select style={{ width: 140 }} value={overrides[r.field] || ''} onChange={(e) => setOverrides((o) => { const n = { ...o }; if (e.target.value) n[r.field] = e.target.value; else delete n[r.field]; return n; })}>
                              <option value="">default</option>
                              {accounts.map((a) => <option key={a.account} value={a.account}>{shortId(a.account)}: {val(a[r.field]).slice(0, 24)}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small" style={{ margin: '8px 0 0' }}>Defaults: master keeps its value; blanks fill from another record. Override picks a specific record.</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ACCOUNTS — master + merge selection (skeleton keeps height constant until loaded) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="collapse-btn" onClick={() => setOpenAccts((v) => !v)}>{openAccts ? '▾' : '▸'} Accounts in this cluster</button>
          <span className="muted small">Master = survivor · Merge = include in this set</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {detail && (<span className="dl-group"><span className="muted small">Export</span><a className="dl-link" href={exportUrl('/api/salesforce-merge/cluster/detail/export', { key: selKey, source, format: 'csv' })}>CSV</a><a className="dl-link" href={exportUrl('/api/salesforce-merge/cluster/detail/export', { key: selKey, source, format: 'xlsx' })}>Excel</a></span>)}
            <button className="btn primary" style={{ width: 'auto' }} disabled={addDisabled} onClick={addToQueue}>Add to merge queue</button>
          </span>
        </div>
        {openAccts && (<>
        {addErr && <p className="err" style={{ margin: '0 0 8px' }}>{addErr}</p>}
        {isQueued && !addErr && <p className="muted small" style={{ margin: '0 0 8px' }}>This set is already in the queue — remove it below to re-add.</p>}
        {note && <p className="muted small" style={{ color: 'var(--accent)', margin: '0 0 8px' }}>{note}</p>}
        {!detail ? (
          <><div style={{ height: 300, overflow: 'hidden' }}><SkelRows n={6} /></div><Skel w="42%" mt={8} /></>
        ) : (
          <>
            <div className="dt-scroll" style={{ height: 300 }}>
              <table className="modal-table acc-fixed" style={{ tableLayout: 'fixed', width: '100%', minWidth: accTotalW }}>
                <colgroup>{ACC_COLS.map((c) => <col key={c.id} style={{ width: colW[c.id] }} />)}</colgroup>
                <thead><tr>{ACC_COLS.map((c) => <th key={c.id} className="acc-th">{c.label}<span className="col-resize" onMouseDown={startResize(c.id)} /></th>)}</tr></thead>
                <tbody>
                  {accounts.map((a, i) => {
                    const isMaster = master === a.account;
                    const idMatch = acctMergeId(a) && a.account === acctMergeId(a);
                    return (
                      <tr key={a.account} className={isMaster ? 'row-sel' : undefined}>
                        <td>{i + 1}</td>
                        <td><input type="radio" name="master" checked={isMaster} onChange={() => { setMaster(a.account); setManualMaster(true); }} aria-label={'Master ' + a.account} /></td>
                        <td>{isMaster ? <span className="muted small">master</span> : <input type="checkbox" checked={mergeSel.has(a.account)} onChange={() => toggleMerge(a.account)} aria-label={'Merge ' + a.account} />}</td>
                        <td>{acctName(a)}</td>
                        <td title={a.account}>{a.account} {idMatch ? <span className="pill" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>= merge id</span> : null}</td>
                        <td title={acctMergeId(a)}>{acctMergeId(a) || '—'}</td>
                        <td>{val(a.member_number || a.cfg_Member_Number__pc)}</td>
                        <td>{val(acctCreated(a)).slice(0, 10)}</td>
                        <td>{!isSf ? '—' : (children === null ? '…' : ((children[a.account] && children[a.account].total) || 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>{selLosers.length} of {Math.max(0, accounts.length - 1)} losing account{Math.max(0, accounts.length - 1) === 1 ? '' : 's'} selected to merge into master {shortId(master)}.</p>
          </>
        )}
        </>)}
      </div>

      {/* ACCOUNT FIELD COMPARISON — accounts down, fields across; conflicts flagged */}
      {selKey && detail && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" className="collapse-btn" onClick={() => setOpenCmp((v) => !v)}>{openCmp ? '▾' : '▸'} Account field comparison</button>
            <span className="muted small">Accounts down, fields across — master ★ row, differing fields flagged</span>
            {cmpConflictCount > 0 && <span className="pill" style={{ color: '#854f0b', background: 'var(--amber-bg)' }}>{cmpConflictCount} differ</span>}
            <span className="dl-group" style={{ marginLeft: 'auto' }}><span className="muted small">Export</span><a className="dl-link" href={exportUrl('/api/salesforce-merge/cluster/detail/export', { key: selKey, source, format: 'csv' })}>CSV</a><a className="dl-link" href={exportUrl('/api/salesforce-merge/cluster/detail/export', { key: selKey, source, format: 'xlsx' })}>Excel</a></span>
            <label className="muted small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={cmpConflictsOnly} onChange={() => setCmpConflictsOnly((v) => !v)} /> Conflicts only</label>
          </div>
          {openCmp && (
          <div className="dt-scroll" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="modal-table cmp-table">
              <thead><tr>
                <th>#</th>
                <th onClick={() => sortBy('name')} style={{ cursor: 'pointer' }}>Name{sortInd('name')}</th>
                <th onClick={() => sortBy('account')} style={{ cursor: 'pointer' }}>Account{sortInd('account')}</th>
                {cmpFields.map((fld) => (<th key={fld} onClick={() => sortBy(fld)} style={{ cursor: 'pointer', ...(fieldConflict(fld) ? { background: 'var(--amber-bg)' } : {}) }}>{fld}{sortInd(fld)}</th>))}
              </tr></thead>
              <tbody>
                {sortedAccounts.map((a, i) => (
                  <tr key={a.account} className={a.account === master ? 'row-sel' : undefined}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{a.account === master ? '★ ' : ''}{acctName(a)}</td>
                    <td title={a.account}>{a.account}</td>
                    {cmpFields.map((fld) => (<td key={fld} title={val(a[fld])} style={fieldConflict(fld) ? { background: 'rgba(180,120,0,.10)' } : undefined}>{val(a[fld])}</td>))}
                  </tr>
                ))}
                {cmpFields.length === 0 && <tr><td className="muted small">No fields.</td></tr>}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* MERGE QUEUE */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <button type="button" className="collapse-btn" onClick={() => setOpenQueue((v) => !v)}>{openQueue ? '▾' : '▸'} Merge queue</button>
          <span className="pill">{queue.length} {qStatus === 'all' ? 'total' : qStatus}</span>
          <select className="tb-select" style={{ width: 120 }} value={qStatus} onChange={(e) => setQStatus(e.target.value)} title="Filter the queue by status">
            <option value="queued">Queued</option><option value="approved">Approved</option><option value="done">Done</option><option value="failed">Failed</option><option value="all">All</option>
          </select>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {queue.length > 0 && (<span className="dl-group"><span className="muted small">Export</span><a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { format: 'csv' })}>CSV</a><a className="dl-link" href={exportUrl('/api/salesforce-merge/merge-queue/export', { format: 'xlsx' })}>Excel</a></span>)}
            {qStatus === 'queued' && <button className="btn primary" style={{ width: 'auto' }} disabled={qSel.size === 0} onClick={approveSelected} title="Approve the selected sets for Phase 3 processing">Approve selected</button>}
          </span>
        </div>
        {openQueue && (<div style={{ minHeight: 180 }}>
        {queue.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Nothing queued yet. Add a merge set above.</p>
        ) : (
          <div className="dt-scroll" style={{ height: 180 }}>
            <table className="modal-table queue-fixed" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup><col style={{ width: 34 }} /><col style={{ width: 34 }} /><col style={{ width: 160 }} /><col style={{ width: 200 }} /><col style={{ width: 90 }} /><col style={{ width: 200 }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 40 }} /></colgroup>
              <thead><tr><th><input type="checkbox" checked={queue.length > 0 && qSel.size === queue.length} onChange={() => setQSel(qSel.size === queue.length ? new Set() : new Set(queue.map((q) => q.id)))} aria-label="Select all" /></th><th>#</th><th>Name</th><th>Survivor (master)</th><th>Merging</th><th>Source</th><th>Rule</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {queue.map((q, i) => (
                  <tr key={q.id} onClick={() => loadFromQueue(q)} className={selKey === q.source_key ? 'row-sel' : undefined} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={qSel.has(q.id)} onChange={() => toggleQ(q.id)} aria-label={'Select ' + q.id} /></td>
                    <td>{i + 1}</td>
                    <td title={q.survivor_name}>{q.survivor_name || '—'}</td>
                    <td title={q.survivor_account} style={{ whiteSpace: 'nowrap' }}>{q.survivor_account}</td>
                    <td>{q.loser_count} account{Number(q.loser_count) === 1 ? '' : 's'}</td>
                    <td title={q.source_key}>{q.source_type === 'merge_id' ? 'merge id ' : 'group '}{shortId(q.source_key)}</td>
                    <td title={RULE_TOOLTIP}>{RULE_LABELS[q.master_rule] || q.master_rule || 'cascade'}</td>
                    <td><span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>{q.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>{(q.status === 'queued' || q.status === 'approved') ? <button className="btn" style={{ width: 'auto', padding: '2px 8px' }} onClick={() => removeQueue(q.id)} aria-label="Remove">✕</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>)}
        <p className="muted small" style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          The queue holds merge sets for review. Processing is Phase 3 — execution is off (write chokepoint, snapshot, typed confirm).
        </p>
      </div>

      {/* Caveats and how-merge-works detail moved to the Reference page. */}
      <p className="muted small" style={{ marginTop: 12 }}>
        How the survivor is chosen, how a merge runs, and what it does not touch (Marketing Cloud and
        other external systems) are explained on the <strong>Reference</strong> page.
      </p>
    </div>
  );
}

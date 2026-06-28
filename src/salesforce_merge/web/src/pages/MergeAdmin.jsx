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
const acctContact = (a) => a.contact || '';
const fmtNames = (s) => (s ? String(s).split(';').map((x) => x.trim()).filter(Boolean).join(', ') : '');
const firstName = (s) => (s ? String(s).split(';')[0].trim() : '');

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

// Default master: account whose SF Id equals the merge id, else oldest; 'children' = most child records.
function pickMaster(accounts, rule, children, groupMergeId) {
  if (!accounts.length) return null;
  const oldest = () => {
    const dated = accounts.filter((a) => acctCreated(a));
    if (!dated.length) return accounts[0].account;
    return dated.reduce((m, a) => (acctCreated(a) < acctCreated(m) ? a : m), dated[0]).account;
  };
  if (rule === 'children' && children) {
    let best = null, bestN = -1;
    for (const a of accounts) {
      const n = (children[a.account] && children[a.account].total) || 0;
      if (n > bestN) { bestN = n; best = a; }
    }
    return best ? best.account : oldest();
  }
  const gm = groupMergeId || accounts.map((a) => acctMergeId(a)).find(Boolean) || '';
  const w = accounts.find((a) => gm && a.account === gm);
  return w ? w.account : oldest();
}

export default function MergeAdmin() {
  const [source, setSource] = useState('merge_id');
  const [midState, setMidState] = useState('');
  const [memState, setMemState] = useState('');
  const [bkState, setBkState] = useState('');
  const [rule, setRule] = useState('mergeid');

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
  const [err, setErr] = useState('');
  const [addErr, setAddErr] = useState('');
  const [note, setNote] = useState('');
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
      ? api.mergeGroups({ page, page_size: PAGE, q: filter, bucket: bkState })
      : api.duplicates({ page, page_size: PAGE, sort: 'size', dir: 'desc', q: filter, merge_id_state: midState, member_number_state: memState });
    load.then((r) => { setClusters(r.rows || []); setTotal(Number(r.total) || 0); }).catch((e) => setErr(e.message));
  }, [source, page, filter, midState, memState, bkState]);

  const loadQueue = useCallback(() => {
    api.mergeQueue().then((r) => { const rows = r.rows || []; setQueue(rows); setQSel(new Set(rows.map((x) => x.id))); }).catch((e) => setErr(e.message));
  }, []);
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
  const processQueue = () => {
    const ids = [...qSel];
    if (!ids.length) return;
    const ok = window.confirm(`Process ${ids.length} selected merge${ids.length === 1 ? '' : 's'}? This will permanently merge the losing accounts into each survivor in Salesforce and cannot be undone here. (Execution is a Phase 3 capability and is not yet enabled — no changes will be made.)`);
    if (!ok) return;
    setNote('Processing is a Phase 3 capability — not yet enabled. No changes were made.');
  };

  const accounts = (detail && detail.accounts) || [];
  const fields = (detail && detail.fields) || [];

  useEffect(() => {
    if (!detail || manualMaster) return;
    const gm = source === 'merge_id' ? selKey : null;
    const m = pickMaster(accounts, rule, children, gm);
    if (m) setMaster(m);
  }, [detail, rule, children, manualMaster, source, selKey]);

  useEffect(() => {
    if (!detail || !master) return;
    if (restoreSel.current) { setMergeSel(restoreSel.current); restoreSel.current = null; return; }
    setMergeSel(new Set(accounts.filter((a) => a.account !== master).map((a) => a.account)));
  }, [detail, master]);

  const rows = useMemo(() => (accounts.length && master ? survivorship(accounts, master, overrides, fields) : []),
    [accounts, master, overrides, fields]);

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
      const r = await api.mergeQueueAdd({ source_type: source, source_key: selKey, survivor_account: master,
        survivor_contact: masterAcct ? acctContact(masterAcct) : '', loser_accounts: selLosers, master_rule: rule });
      setNote(`Queued: master ${shortId(master)} + ${r.loser_count} account${r.loser_count === 1 ? '' : 's'}.`);
      loadQueue();
    } catch (e) { setAddErr(e.message); }
  };
  const removeQueue = async (id) => { try { await api.mergeQueueRemove(id); loadQueue(); } catch (e) { setErr(e.message); } };

  const ruleLabel = rule === 'children' ? 'most child records' : 'Salesforce Id = merge id, else oldest';
  const listLabel = source === 'merge_id' ? 'Merge-id groups' : 'Duplicate groups';
  const addDisabled = !detail || isQueued || !selLosers.length;

  return (
    <div className="mergeadmin">
      <h2>Merge Admin</h2>
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
            </>
          )}
          {source === 'merge_id' && (
            <div>
              <div className="muted small" style={{ marginBottom: 3 }}>Bucket</div>
              <select className="tb-select" value={bkState} onChange={(e) => { setBkState(e.target.value); setPage(1); }}>
                <option value="">All</option><option value="in_both">In both</option><option value="sf_only">ID only</option>
              </select>
            </div>
          )}
          <div>
            <div className="muted small" style={{ marginBottom: 3 }}>Master survivor rule</div>
            <select className="tb-select" style={{ width: 250 }} value={rule} onChange={(e) => { setRule(e.target.value); setManualMaster(false); }}>
              <option value="mergeid">Salesforce Id = merge id, else oldest</option>
              <option value="children">Account with most child records</option>
            </select>
          </div>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0', borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          Winner rule: {ruleLabel}. No merge-id match falls back to the oldest account. You can always override the master below.
        </p>
      </div>

      {/* CARD GROUP: list rail + analysis */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '0 0 280px', minWidth: 0, margin: 0, height: railH || 574, display: 'flex', flexDirection: 'column' }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{listLabel} <span className="muted small" style={{ fontWeight: 400 }}>({total.toLocaleString()})</span></p>
          <input className="search" style={{ width: '100%', marginBottom: 8 }} placeholder="Search: name, id…" value={filter} onChange={(e) => onFilter(e.target.value)} />
          <div className="dt-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {clusters.map((c, i) => (
              <button key={c.cluster} type="button" onClick={() => loadCluster(c.cluster)}
                className={'ma-cluster' + (selKey === c.cluster ? ' on' : '')}>
                <div className="ma-cluster-key" title={fmtNames(c.names) || c.cluster}>{(page - 1) * PAGE + i + 1}. {firstName(c.names) || c.cluster}</div>
                <div className="muted small">{c.size} records · {c.signal}</div>
              </button>
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
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Impact preview (dry-run)</p>
                  <Skel w="80%" /><Skel w="70%" /><Skel w="60%" />
                </div>
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Child records reparented</p>
                  <Skel w="75%" /><Skel w="65%" /><Skel w="70%" />
                </div>
              </div>
              <div className="card" style={{ margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 314 }}>
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
                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 206 }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Impact preview (dry-run)</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                    <li>{selLosers.length} account{selLosers.length === 1 ? '' : 's'} selected to merge into the master</li>
                    <li>{selLosers.length} losing account{selLosers.length === 1 ? '' : 's'} → Recycle Bin (~15 days)</li>
                    <li>~{apexCalls} merge operation{apexCalls === 1 ? '' : 's'} <span className="muted">(see caveats below)</span></li>
                  </ul>
                </div>

                <div className="card" style={{ flex: '1 1 240px', minWidth: 0, margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 206 }}>
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

              <div className="card" style={{ margin: 0, background: 'rgba(127,127,127,.05)', minHeight: 314 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 700 }}>Field survivorship</p>
                <div className="dt-scroll" style={{ maxHeight: 240 }}>
                  <table className="modal-table">
                    <thead><tr><th>Field</th><th>Result</th><th>From</th><th>Override</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.field}>
                          <td>{r.field}</td>
                          <td title={val(r.value)}>{val(r.value)}</td>
                          <td style={{ color: (STATUS[r.status] || STATUS.empty).color }}>
                            {r.sourceId === master ? 'master' : (r.sourceId ? shortId(r.sourceId) : (STATUS[r.status] || STATUS.empty).label)}
                          </td>
                          <td>
                            <select style={{ width: 200 }} value={overrides[r.field] || ''} onChange={(e) => setOverrides((o) => { const n = { ...o }; if (e.target.value) n[r.field] = e.target.value; else delete n[r.field]; return n; })}>
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
          <span style={{ fontWeight: 700 }}>Accounts in this cluster</span>
          <span className="muted small">Master = survivor · Merge = include in this set</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {detail && (<span className="dl-group"><span className="muted small">Export</span><a className="dl-link" href={exportUrl('/api/cluster/detail/export', { key: selKey, source, format: 'csv' })}>CSV</a><a className="dl-link" href={exportUrl('/api/cluster/detail/export', { key: selKey, source, format: 'xlsx' })}>Excel</a></span>)}
            <button className="btn primary" style={{ width: 'auto' }} disabled={addDisabled} onClick={addToQueue}>Add to merge queue</button>
          </span>
        </div>
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
                <thead><tr>{ACC_COLS.map((c) => <th key={c.id} style={{ position: 'relative' }}>{c.label}<span className="col-resize" onMouseDown={startResize(c.id)} /></th>)}</tr></thead>
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
      </div>

      {/* MERGE QUEUE */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontWeight: 700 }}>Merge queue</span>
          <span className="pill">{queue.length} queued</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {queue.length > 0 && (<span className="dl-group"><span className="muted small">Export</span><a className="dl-link" href={exportUrl('/api/merge-queue/export', { format: 'csv' })}>CSV</a><a className="dl-link" href={exportUrl('/api/merge-queue/export', { format: 'xlsx' })}>Excel</a></span>)}
            <button className="btn primary" style={{ width: 'auto' }} disabled={qSel.size === 0} onClick={processQueue} title="Process the selected rows (Phase 3 — execution not yet enabled)">Process queue</button>
          </span>
        </div>
        <div style={{ minHeight: 180 }}>
        {queue.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Nothing queued yet. Add a merge set above.</p>
        ) : (
          <div className="dt-scroll" style={{ height: 180 }}>
            <table className="modal-table queue-fixed" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup><col style={{ width: 34 }} /><col style={{ width: 34 }} /><col style={{ width: 220 }} /><col style={{ width: 90 }} /><col style={{ width: 220 }} /><col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 40 }} /></colgroup>
              <thead><tr><th><input type="checkbox" checked={queue.length > 0 && qSel.size === queue.length} onChange={() => setQSel(qSel.size === queue.length ? new Set() : new Set(queue.map((q) => q.id)))} aria-label="Select all" /></th><th>#</th><th>Survivor (master)</th><th>Merging</th><th>Source</th><th>Rule</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {queue.map((q, i) => (
                  <tr key={q.id} onClick={() => loadFromQueue(q)} className={selKey === q.source_key ? 'row-sel' : undefined} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={qSel.has(q.id)} onChange={() => toggleQ(q.id)} aria-label={'Select ' + q.id} /></td>
                    <td>{i + 1}</td>
                    <td title={q.survivor_account} style={{ whiteSpace: 'nowrap' }}>{q.survivor_account}</td>
                    <td>{q.loser_count} account{Number(q.loser_count) === 1 ? '' : 's'}</td>
                    <td title={q.source_key}>{q.source_type === 'merge_id' ? 'merge id ' : 'group '}{shortId(q.source_key)}</td>
                    <td>{q.master_rule === 'children' ? 'most children' : 'merge id / oldest'}</td>
                    <td><span className="pill" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>{q.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()}><button className="btn" style={{ width: 'auto', padding: '2px 8px' }} onClick={() => removeQueue(q.id)} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
        <p className="muted small" style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 7 }}>
          The queue holds merge sets for review. Processing is Phase 3 — execution is off (write chokepoint, snapshot, typed confirm).
        </p>
      </div>

      {/* CAVEATS */}
      <div className="card" style={{ marginTop: 12, background: 'rgba(127,127,127,.05)' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Caveats</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li><strong>Marketing Cloud (SFMC) and other external systems are not included.</strong> Auto-discovery only walks child relationships inside the core Salesforce CRM org — objects that hang off the Account or its Person Contact. Marketing Cloud is a separate platform connected through Marketing Cloud Connect, which syncs Contacts and Leads into SFMC and identifies each subscriber by a Subscriber Key, usually the Contact Id (or Lead Id).
            <ul style={{ marginTop: 4 }}>
              <li>When a merge deletes the losing Contact, its Subscriber Key is orphaned: subscriber records, list and data-extension rows, journey membership, and send/engagement history that referenced the old Id are not automatically repointed to the surviving Contact.</li>
              <li>Reconciliation happens in Marketing Cloud after the merge — re-sync the surviving Contact, update or remap the Subscriber Key, and review any journeys, automations, or data extensions that filter on the old Id.</li>
              <li>The same caution applies to anything else linked by Salesforce Id outside the org (data warehouse, AMS or payment systems, other marketing tools): those references are invisible to this preview and need their own reconciliation.</li>
            </ul>
          </li>
          <li><strong>How the merge actually runs.</strong> Execution (Phase 3) would use Salesforce native merge via Apex <code>Database.merge</code> — the same operation as the SOAP/REST <code>merge()</code> call and the standard UI Merge action. It is the only supported way to combine records; there is no alternate merge-by-id mechanism.
            <ul style={{ marginTop: 4 }}>
              <li>Each call merges at most three records: one surviving master plus up to two losing records. A cluster with N losers therefore needs about ceil(N / 2) calls — the merge-operations estimate shown above — and batching this way keeps every transaction within Salesforce Apex and DML governor limits.</li>
              <li>Survivorship is applied by writing the chosen values onto the master before the merge: the master keeps its non-blank values, blank fields backfill from a losing record, and any value set in the override column above wins. The native merge then retains the master, reparents all child records to it, and sends the losing accounts to the Recycle Bin (about 15 days).</li>
              <li>These are Person Accounts, so each record is an Account paired with a Person Contact; the merge collapses both sides together, which is why child records that hang off the Contact also move.</li>
              <li>The membership-platform merge id (<code>usat_Salesforce_Merge_Id__pc</code>) is only a matching and QA field used to decide which records belong together. It is data, not the action that performs the merge.</li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  );
}

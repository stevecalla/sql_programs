import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { track, meta as trackMeta } from './track.js';

// ---- date + match helpers (ported from the POC) ----
export const MIN_DATE = '2025-01-01';
export const MAX_RANGE = 14;
export function eqToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function ymdAdd(ymd, days) { const d = new Date(Date.parse(ymd + 'T00:00:00Z') + days * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
export function eqYesterday() { return ymdAdd(eqToday(), -1); }
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
export function clampDate(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function validateRange() {
  if (state.anyDate) return { ok: true, msg: '' };
  const a = state.from, b = state.to, today = eqToday();
  if (!a || !b) return { ok: false, msg: 'Pick a From and To date (or tick Any date).' };
  if (a < MIN_DATE || b < MIN_DATE) return { ok: false, msg: 'Dates must be on or after ' + MIN_DATE + '.' };
  if (a > today || b > today) return { ok: false, msg: 'Dates cannot be in the future.' };
  if (b < a) return { ok: false, msg: 'To must be on or after From.' };
  if (daysBetween(a, b) > MAX_RANGE) return { ok: false, msg: 'The date range can be at most ' + MAX_RANGE + ' days.' };
  return { ok: true, msg: '' };
}
export function clampDates() {
  const today = eqToday();
  let from = clampDate(state.from || eqYesterday(), MIN_DATE, today);
  let hi = ymdAdd(from, MAX_RANGE); if (hi > today) hi = today;
  let to = state.to ? clampDate(state.to, from, hi) : hi;
  state.from = from; state.to = to;
}

export const TRIAGE_LABEL = { answer_ready: 'Answer ready', draft_possible: 'Draft possible', needs_info: 'Needs info', awaiting_reply: 'Awaiting reply', spam: 'Spam?', non_actionable: 'No action', pending: 'Triaging…', error: '⚠ Failed' };
function norm(x) { return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9@. ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function caseMatches(cs, q) {
  if (!q) return true;
  const mm = String(q).trim().toLowerCase().match(/^(\d+)\s*msgs?$/);
  if (mm) return (Number(cs.message_count) || 0) === Number(mm[1]);
  const t = state.triage[cs.case_id]; const tl = t ? (TRIAGE_LABEL[t.status] || t.status || '') : '';
  const hay = norm([cs.subject, cs.status, cs.case_number, cs.supplied_email, cs.from_address, cs.modified_mtn, (cs.message_count || 0) + ' msg', (cs.has_attachment ? 'attachment' : ''), (cs.link_count ? 'link' : ''), (cs.first_link || ''), tl].join(' '));
  return norm(q).split(' ').filter(Boolean).every((w) => hay.indexOf(w.replace(/\.+$/, '')) >= 0);
}

// ---- resizable rail widths (persisted per-browser) ----
export const RAIL_DEF = 320, RAIL_MIN = 240, RAIL_MAX = 560;
export const AI_DEF = 360, AI_MIN = 280, AI_MAX = 640;
function loadW(k, def, lo, hi) { try { const v = parseInt(window.localStorage.getItem(k), 10); return (v >= lo && v <= hi) ? v : def; } catch (e) { return def; } }
function saveW(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }
function loadStr(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function saveStr(k, v) { try { window.localStorage.setItem(k, v == null ? '' : String(v)); } catch (e) { /* ignore */ } }
function loadJson(k, def) { try { const v = JSON.parse(window.localStorage.getItem(k)); return v && typeof v === 'object' ? v : def; } catch (e) { return def; } }
function saveJson(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

// ---- store ----
let state = {
  queues: [], statuses: [], counts: {}, instanceUrl: '', sfEnv: 'prod', showTestBanner: false,
  sfUser: '', sendEnabled: false, sendQueueFrom: {}, oweAddresses: [],
  statusEnabled: false, statusRequirements: {}, caseFields: [],
  models: [], model: null,
  queueId: '', status: loadStr('eq_status') || 'open', dateField: 'LastModifiedDate', anyDate: false,
  from: eqYesterday(), to: eqToday(), search: '', attachOnly: false, limit: 25,
  railW: loadW('eq_railW', RAIL_DEF, RAIL_MIN, RAIL_MAX), aiW: loadW('eq_aiW', AI_DEF, AI_MIN, AI_MAX),
  cardOpen: true, datesOpen: false,
  cases: [], loaded: false, loadingCases: false, casesErr: '',
  checked: loadJson('eq_checked', {}),
  sel: null, thread: [], loadingThread: false, collapsed: {}, dedupe: true, viewHtml: false, msgView: {},
  triage: {}, triageProg: '',
  corr: [],
  linkPreview: null,
};
const listeners = new Set();
function emit() { state = { ...state }; listeners.forEach((l) => l()); }
export function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
export function getState() { return state; }
export function useEq() { return useSyncExternalStore(subscribe, getState, getState); }
export function set(patch) { Object.assign(state, patch); emit(); }
export function setStatusFilter(v) { state.status = v; saveStr('eq_status', v); emit(); }
export function setModel(m) { state.model = m; saveStr('eq_model', m && m.model); emit(); if (m) track('model_selected', { ai_provider: m.provider === 'anthropic' ? 'claude' : 'chatgpt', ai_model: m.model }); }
export function setMsgView(id, mode) { const mv = { ...state.msgView }; if (mode == null) delete mv[id]; else mv[id] = mode; state.msgView = mv; emit(); }
export function setRailW(w) { state.railW = w; saveW('eq_railW', w); emit(); }
export function setAiW(w) { state.aiW = w; saveW('eq_aiW', w); emit(); }
export function queueObj() { return state.queues.find((x) => x.id === state.queueId) || null; }
export function queueName() { const q = queueObj(); return q ? q.name : ''; }

// Re-pull the operator config (master send switch, per-queue From, env) WITHOUT a full reload, so an admin
// flipping "Email sending" on/off (or remapping a queue's From) takes effect in open operator tabs on their
// own. Called on tab focus, on a light background poll, and right before a send. Never throws.
export async function refreshConfig() {
  try {
    const r = await api.config();
    state.sfEnv = r.sf_env || state.sfEnv;
    state.showTestBanner = !!r.show_test_banner;
    if (r.sf_user) state.sfUser = r.sf_user;
    state.sendEnabled = !!r.send_enabled;
    state.sendQueueFrom = r.send_queue_from || {};
    state.statusEnabled = !!r.status_enabled;
    state.statusRequirements = r.status_requirements || {};
    emit();
  } catch (e) { /* keep last-known config */ }
  return state.sendEnabled;
}
// Reflect a status change locally (no reload): update the selected case + its row in the list.
export function applyCaseStatus(caseId, status) {
  if (state.sel && state.sel.case_id === caseId) state.sel = { ...state.sel, status: status };
  state.cases = (state.cases || []).map(function (c) { return c.case_id === caseId ? { ...c, status: status } : c; });
  emit();
}

// Identity of the signed-in app user, so we can re-fetch the (access-filtered) queue list when a different
// user signs in without a hard reload. The server always filters /queues by role; this just keeps the
// client from showing the previous user's list until a refresh.
let _userKey = null;
function userKeyOf(u) { return u ? (String(u.user || '') + '|' + String(u.role || '')) : ''; }

let _inited = false;
export async function init(user) {
  if (_inited) return; _inited = true;
  _userKey = userKeyOf(user);   // seed identity so the first syncUser() call doesn't trigger a needless reload
  track('page_view', {});   // funnel "Visits" stage — one per app load (server stamps actor)
  try { const r = await api.config(); state.sfEnv = r.sf_env || 'prod'; state.showTestBanner = !!r.show_test_banner; state.sfUser = r.sf_user || ''; state.sendEnabled = !!r.send_enabled; state.sendQueueFrom = r.send_queue_from || {}; state.statusEnabled = !!r.status_enabled; state.statusRequirements = r.status_requirements || {}; emit(); } catch (e) { /* optional */ }
  // Keep the master switch / From map live in open tabs: refresh on focus + a modest visible-only poll.
  try {
    if (typeof window !== 'undefined' && !window.__eqCfgWatch) {
      window.__eqCfgWatch = true;
      window.addEventListener('focus', function () { refreshConfig(); });
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshConfig(); });
      setInterval(function () { if (typeof document === 'undefined' || !document.hidden) refreshConfig(); }, 45000);
    }
  } catch (e) { /* non-browser / no window */ }
  // Verified Org-Wide Email Addresses for the "From" dropdown (best-effort; empty if the query fails).
  try { const r = await api.orgWideEmails(); state.oweAddresses = r.addresses || []; emit(); } catch (e) { /* optional */ }
  // Updateable Case field metadata (for the status-change required fields). Best-effort.
  try { const r = await api.caseFields(); state.caseFields = r.fields || []; emit(); } catch (e) { /* optional */ }
  try {
    const r = await api.queues(); state.queues = r.queues || []; state.instanceUrl = r.instance_url || '';
    const savedQ = loadStr('eq_queue');
    if (savedQ && state.queues.some((q) => q.id === savedQ)) { state.queueId = savedQ; emit(); loadCounts(); } else { emit(); }
  } catch (e) { state.casesErr = e.message; emit(); }
  try { const r = await api.statuses(); state.statuses = r.statuses || []; emit(); } catch (e) { /* optional */ }
  try { const list = await api.aiModels(); const arr = Array.isArray(list) ? list : []; state.models = arr; const sm = loadStr('eq_model'); state.model = arr.find((m) => m.model === sm) || arr.find((m) => m.is_default) || arr[0] || null; emit(); } catch (e) { /* optional */ }
  try { const r = await api.corrections(); state.corr = r.corrections || []; emit(); } catch (e) { /* optional */ }
}
// Call whenever the signed-in app user might have changed (mount + on the `user` prop changing). If the
// identity actually changed since init/last sync, re-fetch the access-filtered queue list and drop the
// prior user's selection — so a restricted user immediately sees only their queues, no hard refresh needed.
export function syncUser(user) {
  const k = userKeyOf(user);
  if (_userKey === null) { _userKey = k; return; }   // first time we see a user — seed, don't reload
  if (k === _userKey) return;                          // same user — nothing to do
  _userKey = k;
  reloadForUser();
}
async function reloadForUser() {
  state.queues = []; state.queueId = ''; state.counts = {}; state.cases = []; state.loaded = false; state.sel = null; state.thread = []; emit();
  try {
    const r = await api.queues(); state.queues = r.queues || []; state.instanceUrl = r.instance_url || '';
    const savedQ = loadStr('eq_queue');
    if (savedQ && state.queues.some((q) => q.id === savedQ)) { state.queueId = savedQ; emit(); loadCounts(); } else { emit(); }
  } catch (e) { state.casesErr = e.message; emit(); }
  try { await refreshConfig(); } catch (e) { /* best-effort: sfUser/banner may differ */ }
}
export async function loadCounts() {
  if (!state.queueId) { state.counts = {}; emit(); return; }
  try { const r = await api.statusCounts(state.queueId); state.counts = r.by_status || {}; } catch (e) { state.counts = {}; }
  emit();
}
export function selectQueue(id) {
  state.queueId = id; saveStr('eq_queue', id); state.counts = {}; state.cases = []; state.loaded = false; state.sel = null; state.thread = []; emit();
  if (id) { const q = state.queues.find((x) => x.id === id); track('queue_viewed', { queue: q ? q.name : '', queue_id: id }); }
  loadCounts();
}
export async function loadCases() {
  if (!state.queueId) return;
  state.loadingCases = true; state.casesErr = ''; emit();
  try {
    const p = { queue: state.queueId, status: state.status, limit: state.limit, links: 1 };
    if (!state.anyDate && state.from && state.to) { p.from = state.from; p.to = state.to; p.field = state.dateField; }
    const r = await api.cases(p);
    state.cases = r.cases || []; state.loaded = true;
    track('cases_listed', { queue: queueName(), queue_id: state.queueId });
  } catch (e) { state.casesErr = e.message; state.cases = []; }
  finally { state.loadingCases = false; emit(); }
}
export async function selectCase(c) {
  state.sel = c; state.thread = []; state.loadingThread = true; state.collapsed = {}; state.msgView = {}; emit();
  track('thread_opened', { queue: queueName(), queue_id: state.queueId, case_id: c.case_id, case_number: c.case_number, thread_msg_count: c.message_count || 0, has_attachment: c.has_attachment ? 1 : 0 });
  try {
    const r = await api.thread(c.case_id); const th = r.thread || []; state.thread = th;
    let openId = null;
    for (let a = th.length - 1; a >= 0; a--) { if (!th[a].automated) { openId = th[a].id; break; } }
    for (let b = th.length - 1; b >= 0; b--) { if (th[b].incoming) { openId = th[b].id; break; } }
    if (!openId && th.length) openId = th[th.length - 1].id;
    const col = {}; th.forEach((m) => { col[m.id] = (m.id !== openId); });
    state.collapsed = col;
  } catch (e) { state.casesErr = e.message; }
  finally { state.loadingThread = false; emit(); }
}
export function toggleChecked(id) { if (state.checked[id]) delete state.checked[id]; else state.checked[id] = true; saveJson('eq_checked', state.checked); emit(); }
export function setCollapsed(id, v) { state.collapsed = { ...state.collapsed, [id]: v }; emit(); }
export function collapseAll(v) { const col = {}; state.thread.forEach((m) => { col[m.id] = v; }); state.collapsed = col; emit(); }
export async function reloadCorrections() { try { const r = await api.corrections(); state.corr = r.corrections || []; emit(); } catch (e) { /* ignore */ } }
// Re-fetch the open case's thread (e.g. after sending a reply so the new outbound message appears).
export async function reloadThread() { if (!state.sel) return; try { const r = await api.thread(state.sel.case_id); state.thread = r.thread || []; emit(); } catch (e) { /* ignore */ } }

export async function triageOne(cs) {
  cs = cs || state.sel; if (!cs) return;
  state.triage = { ...state.triage, [cs.case_id]: { status: 'pending', reason: '' } }; emit();
  try {
    const j = await api.aiTriage({ case_id: cs.case_id, case_number: cs.case_number, queue: queueName(), queue_id: state.queueId, provider: state.model && state.model.provider, model: state.model && state.model.model, meta: trackMeta() });
    state.triage = { ...state.triage, [cs.case_id]: { status: j.status, reason: j.reason, ai: j.ai, ai_model: j.ai_model } };
  } catch (e) { state.triage = { ...state.triage, [cs.case_id]: { status: 'error', reason: 'Triage failed: ' + ((e && e.message) || 'error') } }; }
  emit();
}
export async function triageVisible() {
  const list = visibleCases(); let i = 0;
  for (const cs of list) {
    i++;
    if (state.triage[cs.case_id] && state.triage[cs.case_id].status !== 'pending') continue;
    state.triageProg = 'Triaging ' + i + '/' + list.length + '…'; emit();
    await triageOne(cs);
  }
  state.triageProg = 'Triage complete.'; emit();
}
export async function retriage() {
  const list = visibleCases(); const t = { ...state.triage };
  list.forEach((cs) => { delete t[cs.case_id]; });
  state.triage = t; emit();
  await triageVisible();
}

export function openLink(url) { if (url) { set({ linkPreview: url }); track('link_previewed', {}); } }
export function closeLink() { set({ linkPreview: null }); }

export function visibleCases() {
  let list = state.cases || [];
  if (state.attachOnly) list = list.filter((c) => c.has_attachment);
  const s = state.search.trim();
  if (s) list = list.filter((c) => caseMatches(c, s));
  return list;
}

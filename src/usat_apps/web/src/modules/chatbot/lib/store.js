import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { track, trackFilter, trackSearch } from '../../../lib/track.js';

// Shared store for the AI Chat Bot surface (mirrors the email queue's lib/store.js). The platform siderail
// (ChatbotRail) and the main Section both read this via useStore(), so Queue & filters can live in the
// siderail while the transcript + AI panel fill the main area — with resizable rails.
export const RAIL_DEF = 300, RAIL_MIN = 240, RAIL_MAX = 520;
export const AI_DEF = 360, AI_MIN = 280, AI_MAX = 640;
function loadW(k, def, lo, hi) { try { const v = parseInt(window.localStorage.getItem(k), 10); return (v >= lo && v <= hi) ? v : def; } catch (e) { return def; } }
function saveW(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }
function isoDay(d) { return d.toISOString().slice(0, 10); }
function today() { return isoDay(new Date()); }
function yesterday() { return isoDay(new Date(Date.now() - 86400000)); }

let state = {
  queues: [], queue: '', sfAligned: true,
  filter: 'all', from: yesterday(), to: today(), search: '',
  threads: null, loadingThreads: false,
  selectedId: null, turns: [], loadingTurns: false,
  cardOpen: true,
  railW: loadW('cb_railW', RAIL_DEF, RAIL_MIN, RAIL_MAX),
  aiW: loadW('cb_aiW', AI_DEF, AI_MIN, AI_MAX),
};
const listeners = new Set();
function emit() { state = { ...state }; listeners.forEach((l) => l()); }
export function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
export function getState() { return state; }
export function useStore() { return useSyncExternalStore(subscribe, getState, getState); }
export function set(patch) { Object.assign(state, patch); emit(); }
export function setRailW(w) { state.railW = w; saveW('cb_railW', w); emit(); }
export function setAiW(w) { state.aiW = w; saveW('cb_aiW', w); emit(); }
export function toggleCard() { state.cardOpen = !state.cardOpen; emit(); }
export function curQueueObj() { return (state.queues || []).find((q) => q.key === state.queue) || null; }

let _inited = false;
export async function init() {
  if (_inited) return; _inited = true;
  try {
    const r = await api.queues();
    state.queues = r.queues || [];
    state.queue = r.default || (state.queues[0] && state.queues[0].key) || 'Team USA';
    state.sfAligned = r.sf_aligned !== false;
  } catch (e) { state.queues = [{ key: 'Team USA', name: 'Team USA', aligned: false }]; state.queue = 'Team USA'; state.sfAligned = false; }
  emit();
  loadThreads();
}
export function selectQueue(q) { state.queue = q; state.cardOpen = false; state.selectedId = null; state.turns = []; emit(); try { trackFilter('chatbot', 'bot', 'queue'); } catch (e) { /* noop */ } loadThreads(); }
export function setFilter(v) { state.filter = v; emit(); try { trackFilter('chatbot', 'bot', 'show'); } catch (e) { /* noop */ } loadThreads(); }
export function setSearch(v) { state.search = v; emit(); }
export function setFrom(v) { state.from = v; emit(); }
export function setTo(v) { state.to = v; emit(); }
export function preset(days) { const now = new Date(); state.from = isoDay(new Date(now.getTime() - days * 86400000)); state.to = isoDay(now); emit(); try { trackFilter('chatbot', 'bot', 'date'); } catch (e) { /* noop */ } loadThreads(); }
export function clearDates() { state.from = ''; state.to = ''; emit(); loadThreads(); }
export function view() { state.cardOpen = false; emit(); try { trackFilter('chatbot', 'bot', 'view'); if (state.search) trackSearch('chatbot', 'bot'); } catch (e) { /* noop */ } loadThreads(); }

export async function loadThreads() {
  if (!state.queue) return;
  state.loadingThreads = true; emit();
  const opts = {};
  if (state.filter === '1') opts.is_test = 1; else if (state.filter === '0') opts.is_test = 0;
  if (state.search) opts.q = state.search;
  if (state.from) opts.from = state.from;
  if (state.to) opts.to = state.to;
  try { const r = await api.conversations(state.queue, opts); state.threads = r.threads || []; }
  catch (e) { state.threads = []; }
  finally {
    state.loadingThreads = false;
    // If the filter returned results, collapse the Queue & filters card to give the list more room; keep it
    // open when there are no results so the user can adjust the filters.
    if (state.threads && state.threads.length > 0) state.cardOpen = false;
    emit();
  }
}
export async function selectConversation(id) {
  state.selectedId = id; state.turns = []; state.loadingTurns = true; emit();
  try { track('conversation_open', { panel: 'chatbot', view: 'bot' }); } catch (e) { /* noop */ }
  try { const r = await api.conversation(id); state.turns = r.turns || []; }
  catch (e) { state.turns = []; }
  finally { state.loadingTurns = false; emit(); }
}
export function onLogged(cid) {
  loadThreads();
  if (cid && cid === state.selectedId) { api.conversation(cid).then((r) => { state.turns = r.turns || []; emit(); }).catch(() => {}); }
}

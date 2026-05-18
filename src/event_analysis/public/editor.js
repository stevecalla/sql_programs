/**
 * editor.js — USAT Override Editor client
 *
 * Vanilla JS, no dependencies. Talks to the same server that's hosting it
 * (same origin), so relative URLs are enough.
 *
 * Wiring:
 *   - On load: fetch /api/status + /api/overrides, render
 *   - Refresh button: re-fetch both
 *   - Form submit: POST /api/overrides, then refresh
 *   - Row buttons: DELETE / POST approve / POST unapprove, then refresh
 *   - Form type selector: show/hide the relevant input fields
 */

'use strict';

// ── Element refs (set after DOMContentLoaded) ────────────────────────────
const $ = (sel) => document.querySelector(sel);

const els = {};
function init_refs() {
  els.scope         = $('#status-scope');
  els.counts        = $('#status-counts');
  els.server        = $('#status-server');
  els.refresh       = $('#btn-refresh');
  els.summary       = $('#overrides-summary');
  els.table         = $('#overrides-table');
  els.form          = $('#add-form');
  els.fType         = $('#f-type');
  els.fSide         = $('#f-side');
  els.fSideWrap     = $('#f-side-wrap');
  els.fSidB         = $('#f-sid-baseline');
  els.fSidBWrap     = $('#f-sid-baseline-wrap');
  els.fSidA         = $('#f-sid-analysis');
  els.fSidAWrap     = $('#f-sid-analysis-wrap');
  els.fSegment      = $('#f-segment');
  els.fSegmentWrap  = $('#f-segment-wrap');
  els.fSegB         = $('#f-seg-baseline');
  els.fSegBWrap     = $('#f-seg-baseline-wrap');
  els.fSegA         = $('#f-seg-analysis');
  els.fSegAWrap     = $('#f-seg-analysis-wrap');
  els.fNote         = $('#f-note');
  els.fGlobal       = $('#f-global');
  els.toast         = $('#toast');
}

// ── Toast ────────────────────────────────────────────────────────────────
let _toast_timer = null;
function toast(msg, kind /* 'ok' | 'error' | '' */) {
  els.toast.textContent = msg;
  els.toast.className = 'toast show ' + (kind || '');
  if (_toast_timer) clearTimeout(_toast_timer);
  _toast_timer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 3000);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  let json = null;
  try { json = await res.json(); } catch { /* tolerate empty body */ }
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body   = json;
    throw err;
  }
  return json;
}

// ── Form-type visibility wiring ──────────────────────────────────────────
//
// force_match      needs both sids; optional segment (pair segment, default auto-detect)
// force_no_match   needs both sids; per-side segment dropdowns
// force_segment    needs side + the matching sid + segment
function refresh_form_visibility() {
  const type = els.fType.value;
  const side = els.fSide.value;

  const show_both_sids = type === 'force_match' || type === 'force_no_match';
  const show_segment   = type === 'force_segment' || type === 'force_match';
  const show_unlink    = type === 'force_no_match';
  const need_side      = type === 'force_segment';

  els.fSideWrap.style.display    = need_side                     ? '' : 'none';
  els.fSegmentWrap.style.display = show_segment                  ? '' : 'none';
  // Per-side segment dropdowns for no-match unlink
  if (els.fSegBWrap)  els.fSegBWrap.style.display  = show_unlink ? '' : 'none';
  if (els.fSegAWrap)  els.fSegAWrap.style.display  = show_unlink ? '' : 'none';
  // Sid fields: match + no-match show both; segment shows only selected side
  els.fSidBWrap.style.display = (show_both_sids || (need_side && side === 'baseline')) ? '' : 'none';
  els.fSidAWrap.style.display = (show_both_sids || (need_side && side === 'analysis')) ? '' : 'none';
}

// ── Render: overrides list ───────────────────────────────────────────────
function pill_for_type(t) {
  if (t === 'force_match')    return '<span class="pill pill-match">match</span>';
  if (t === 'force_no_match') return '<span class="pill pill-no-match">no-match</span>';
  if (t === 'force_segment')  return '<span class="pill pill-segment">segment</span>';
  return '<span class="pill">' + esc(t) + '</span>';
}

function state_badge(ov) {
  if (ov.approval_state === 'stale') return '<span class="state state-stale"><span class="dot"></span>stale</span>';
  if (ov.approved)                   return '<span class="state state-approved"><span class="dot"></span>approved</span>';
  return '<span class="state state-unapproved"><span class="dot"></span>unapproved</span>';
}

function scope_badge(ov) {
  if (ov.baseline_year == null && ov.analysis_year == null) {
    return '<span class="scope-tag global">global</span>';
  }
  return '<span class="scope-tag">' + esc(ov.baseline_year + ' / ' + ov.analysis_year) + '</span>';
}

function sid_cell(ov) {
  // Match + no-match show both sids; segment shows whichever is set.
  if (ov.sid_baseline && ov.sid_analysis) {
    const seg_hint = ov._type === 'force_no_match'
      ? ' <span class="muted">→ ' + esc(ov.segment_baseline ?? 'Lost') + ' / ' + esc(ov.segment_analysis ?? 'New') + '</span>'
      : '';
    return '<span class="sid">' + esc(ov.sid_baseline) + ' ↔ ' + esc(ov.sid_analysis) + '</span>' + seg_hint;
  }
  if (ov.sid_baseline) return '<span class="sid">' + esc(ov.sid_baseline) + '</span> <span class="muted">(baseline)</span>';
  if (ov.sid_analysis) return '<span class="sid">' + esc(ov.sid_analysis) + '</span> <span class="muted">(analysis)</span>';
  return '<span class="muted">—</span>';
}

function row_actions(ov) {
  const sid = ov.sid_baseline || ov.sid_analysis;
  const sid_attr = esc(sid);
  // Approve / Unapprove are mutually exclusive based on current state.
  const approve_btn = (ov.approved && ov.approval_state !== 'stale')
    ? `<button class="btn btn-sm btn-unapprove" data-action="unapprove" data-sid="${sid_attr}">↶ Unapprove</button>`
    : `<button class="btn btn-sm btn-approve" data-action="approve" data-sid="${sid_attr}">✓ Approve</button>`;
  // Stale also gets a re-approve button (refreshes signatures).
  return approve_btn +
    `<button class="btn btn-sm btn-danger" data-action="delete" data-sid="${sid_attr}">✕ Delete</button>`;
}

function render_overrides(data) {
  const fm  = data.force_match    ?? [];
  const fnm = data.force_no_match ?? [];
  const fs  = data.force_segment  ?? [];
  const all = [...fm, ...fnm, ...fs].sort((a, b) => a.id - b.id);

  // Add a `type` discriminator since the API splits by type bucket.
  for (const ov of fm)  ov._type = 'force_match';
  for (const ov of fnm) ov._type = 'force_no_match';
  for (const ov of fs)  ov._type = 'force_segment';

  els.summary.textContent = all.length === 0
    ? 'No active overrides in the current scope.'
    : `${all.length} active — ${data.stats?.approved ?? 0} approved, ${data.stats?.unapproved ?? 0} unapproved, ${data.stats?.stale ?? 0} stale.`;

  if (all.length === 0) {
    els.table.innerHTML = '<p class="muted">Nothing here yet. Use the form below to add your first override.</p>';
    return;
  }

  const header = `
    <div class="overrides-table">
      <div class="row-head">Type</div>
      <div class="row-head">Sanction ID(s)</div>
      <div class="row-head">Scope</div>
      <div class="row-head">State</div>
      <div class="row-head" style="justify-content:flex-end">Actions</div>
  `;
  const body = all.map(ov => `
      <div class="row-detail">${pill_for_type(ov._type)}${ov._type === 'force_segment' ? ' <span class="muted">→ ' + esc(ov.segment) + '</span>' : ''}${ov._type === 'force_match' && ov.segment_baseline ? ' <span class="muted">→ ' + esc(ov.segment_baseline) + '</span>' : ''}</div>
      <div class="row-detail">${sid_cell(ov)}</div>
      <div class="row-detail">${scope_badge(ov)}</div>
      <div class="row-detail">${state_badge(ov)}</div>
      <div class="row-detail actions">${row_actions(ov)}</div>
  `).join('');

  els.table.innerHTML = header + body + '</div>';
}

// ── Load + refresh ───────────────────────────────────────────────────────
async function refresh() {
  // Status first — gives us scope info even if overrides fetch fails.
  try {
    const status = await api('GET', '/api/status');
    els.scope.textContent = `Scope: ${status.baseline_year} → ${status.analysis_year}`;
    els.scope.className   = 'status-chip';
    els.server.textContent = '● connected';
    els.server.className   = 'status-chip ok';
  } catch (err) {
    els.server.textContent = '● disconnected';
    els.server.className   = 'status-chip error';
    toast('Server unreachable: ' + err.message, 'error');
    return;
  }

  try {
    const data = await api('GET', '/api/overrides');
    render_overrides(data);
    const total = data.stats?.total ?? 0;
    els.counts.textContent = `${total} override${total === 1 ? '' : 's'}`;
  } catch (err) {
    els.counts.textContent = '— overrides';
    toast('Failed to load overrides: ' + err.message, 'error');
  }
}

// ── Form submit ──────────────────────────────────────────────────────────
async function on_submit(e) {
  e.preventDefault();
  const type = els.fType.value;
  const body = {
    type,
    note:   els.fNote.value.trim() || undefined,
    global: els.fGlobal.checked || undefined,
  };

  if (type === 'force_match' || type === 'force_no_match') {
    body.sid_baseline = els.fSidB.value.trim();
    body.sid_analysis = els.fSidA.value.trim();
    if (!body.sid_baseline || !body.sid_analysis) {
      toast(type === 'force_match' ? 'Force match needs both sanction IDs.' : 'Unlink needs both sanction IDs.', 'error');
      return;
    }
    if (type === 'force_match') {
      // Single segment for the pair (uses segment_baseline as carrier)
      body.segment_baseline = els.fSegment.value || undefined;
    }
    if (type === 'force_no_match') {
      body.segment_baseline = els.fSegB ? els.fSegB.value : 'Lost';
      body.segment_analysis = els.fSegA ? els.fSegA.value : 'New';
    }
  } else {
    // force_segment
    body.side = els.fSide.value;
    if (body.side === 'baseline') body.sid_baseline = els.fSidB.value.trim();
    else                          body.sid_analysis = els.fSidA.value.trim();
    if (!(body.sid_baseline || body.sid_analysis)) {
      toast('Missing sanction ID.', 'error');
      return;
    }
    body.segment = els.fSegment.value;
  }

  try {
    const res = await api('POST', '/api/overrides', body);
    if (res.status === 'inserted')      toast(`Inserted override #${res.id}.`, 'ok');
    else if (res.status === 'exists')   toast(`Override already existed (#${res.id}).`, 'ok');
    else if (res.status === 'updated')  toast(`Updated override #${res.id}.`, 'ok');
    else                                 toast('OK.', 'ok');
    els.form.reset();
    refresh_form_visibility();
    await refresh();
  } catch (err) {
    toast('Add failed: ' + err.message, 'error');
  }
}

// ── Row action handler (event delegation) ────────────────────────────────
async function on_table_click(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const sid    = btn.dataset.sid;
  if (!sid) return;

  btn.disabled = true;
  try {
    if (action === 'delete') {
      if (!confirm(`Soft-delete every active override for: ${sid}?`)) { btn.disabled = false; return; }
      const r = await api('DELETE', '/api/overrides/' + encodeURIComponent(sid));
      toast(`Soft-deleted ${r.removed} row(s) for ${sid}.`, 'ok');
    } else if (action === 'approve') {
      const r = await api('POST', '/api/approve/' + encodeURIComponent(sid));
      toast(`Approved ${r.approved} row(s) for ${sid}.`, 'ok');
    } else if (action === 'unapprove') {
      const r = await api('POST', '/api/unapprove/' + encodeURIComponent(sid));
      toast(`Unapproved ${r.unapproved} row(s) for ${sid}.`, 'ok');
    }
    await refresh();
  } catch (err) {
    toast(action + ' failed: ' + err.message, 'error');
    btn.disabled = false;
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  init_refs();
  refresh_form_visibility();
  els.fType.addEventListener('change', refresh_form_visibility);
  els.fSide.addEventListener('change', refresh_form_visibility);
  els.form.addEventListener('submit', on_submit);
  els.table.addEventListener('click', on_table_click);
  els.refresh.addEventListener('click', refresh);
  refresh();
});

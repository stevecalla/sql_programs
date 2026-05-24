/**
 * glossary.test.js — Verifies the bottom-of-dashboard glossary stays intact.
 *
 * The glossary is the only piece of the dashboard that's purely educational —
 * if a definition disappears or gets renamed, no other test catches it
 * because the rest of the dashboard keeps working. This suite asserts:
 *
 *   1. The <details id="dash-glossary"> container exists (so the section
 *      is collapsible and accessible).
 *   2. It defaults to closed (no `open` attribute).
 *   3. Every term a reader is likely to look up is present in the
 *      glossary HTML — the 6 segments, the 5 confidence values, the
 *      calendar / organic pair, and the assorted "other terms".
 *   4. The calendar-expected definition still includes its worked
 *      arithmetic example (the "weekend day" phrasing) — easy to lose
 *      to a future edit, valuable to the reader.
 *
 * Lives in its own file (rather than folded into server.test.js) so it
 * can be run independently — option 26 in the menu — and so adding new
 * glossary content stays a focused, low-coupling change.
 *
 * Run via:
 *   node --test tests/glossary.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

// ── Locate the most recent build's dashboard.html ─────────────────────────
//
// Mirrors the resolver used in server.test.js: honour the env override,
// otherwise ask determineOSPath() for the OS-appropriate output dir. The
// helper is duplicated here (rather than imported from server.test.js)
// because suite files are intentionally self-contained — sharing helpers
// across them creates cross-suite coupling that bites later.

async function find_dashboard_html() {
  const out_dir = process.env.EVENT_ANALYSIS_OUTPUT_DIR
    || (await require('../../../utilities/determineOSPath').determineOSPath()
         .then(p => path.join(p, 'usat_event_analysis_output'))
         .catch(() => null));
  if (!out_dir) return null;
  const fp = path.join(out_dir, 'dashboard.html');
  return fs.existsSync(fp) ? fp : null;
}

describe('dashboard glossary — structure', () => {

  test('the glossary is a default-closed <details> element', async (t) => {
    const fp = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    // Old dashboards predate the glossary; skip rather than fail.
    if (!/id="dash-glossary"/.test(html)) {
      t.skip('dashboard.html predates the glossary — run node build_all.js to regenerate');
      return;
    }

    assert.match(html, /<details\b[^>]*id="dash-glossary"/,
      'glossary should be a <details> element so it can collapse');

    // The opening tag must NOT have `open` — we slice it out and check.
    // Looking at the whole HTML for /\bopen\b/ would false-positive on any
    // unrelated occurrence elsewhere on the page.
    const opening = html.match(/<details\b[^>]*id="dash-glossary"[^>]*>/);
    assert.ok(opening, '<details id="dash-glossary"> opening tag not found');
    assert.doesNotMatch(opening[0], /\bopen\b/,
      'glossary should default to closed (no `open` attribute on the <details> tag)');

    assert.match(html, /<summary>[\s\S]*?What do these terms mean\?[\s\S]*?<\/summary>/,
      'glossary should have a <summary> with the click-to-expand prompt');
  });
});

describe('dashboard glossary — required terms', () => {

  // Each entry is a term a reader will reasonably try to find a definition
  // for. The list intentionally mirrors what's shown in the KPI cards,
  // chip bars, charts, and roster — when the dashboard surfaces a new
  // term, add it here AND to the dashboard.
  const REQUIRED_TERMS = [
    // Segments (6) ─────────────────────────────────────────────────────
    'Retained', 'Shifted', 'Tried to Return', 'Lost', 'Recovered', 'New',
    // Confidence values (5) ────────────────────────────────────────────
    'Exact', 'Exact-Shifted', 'Cross', 'Override', 'N/A',
    // Calendar / organic ───────────────────────────────────────────────
    'Calendar-expected', 'Organic delta',
    // Roster + KPI vocabulary ──────────────────────────────────────────
    'Net change', 'Active event', 'Sanction ID',
    'Approved', 'Unapproved', 'Stale',
    'Worst month',
    // Row-level review + creation-date column added in this iteration
    'Reviewed?', 'Event Created',
  ];

  test('every required term appears inside the glossary <details> block', async (t) => {
    const fp = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');
    if (!/id="dash-glossary"/.test(html)) {
      t.skip('dashboard.html predates the glossary — run node build_all.js to regenerate');
      return;
    }

    // Slice to glossary bounds so a term defined elsewhere on the page
    // can't accidentally satisfy the check. Anchor on the glossary's id
    // rather than the first <details> tag — the dashboard now has other
    // <details> elements above the glossary (e.g. the ad-hoc-years
    // rebuild card) and we don't want to accidentally slice into them.
    const id_idx    = html.indexOf('id="dash-glossary"');
    const open_idx  = html.lastIndexOf('<details', id_idx);
    const close_idx = html.indexOf('</details>', id_idx);
    assert.ok(open_idx >= 0 && close_idx > open_idx, 'could not locate glossary boundaries');
    const glossary_html = html.slice(open_idx, close_idx);

    const missing = REQUIRED_TERMS.filter(term => !glossary_html.includes(term));
    assert.deepEqual(missing, [],
      `glossary is missing definitions for: ${missing.join(', ')}`);
  });

  test('calendar-expected explanation still includes the worked example', async (t) => {
    // The arithmetic example (weekend days, +12.5% capacity) is the only
    // thing turning "calendar-expected" from jargon into something a reader
    // can actually internalise. Easy to lose to a careless edit; cheap to
    // protect.
    const fp = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');
    if (!/id="dash-glossary"/.test(html)) {
      t.skip('dashboard.html predates the glossary — run node build_all.js to regenerate');
      return;
    }

    // Anchor on the glossary's id — see note in the prior test.
    const id_idx    = html.indexOf('id="dash-glossary"');
    const open_idx  = html.lastIndexOf('<details', id_idx);
    const close_idx = html.indexOf('</details>', id_idx);
    const glossary_html = html.slice(open_idx, close_idx);

    assert.match(glossary_html, /weekend day/i,
      'glossary should explain calendar-expected with a weekend-days example');
    assert.match(glossary_html, /Raw delta/i,
      'glossary should walk through the raw → calendar → organic arithmetic');
  });
});

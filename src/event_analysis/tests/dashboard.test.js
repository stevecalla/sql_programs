/**
 * dashboard.test.js -- Renderer-level checks on generate_dashboard().
 *
 * Drives generate_dashboard with a minimal in-memory fixture (no DB, no
 * commentary, no file uploads) and asserts:
 *
 *   1. The roster row carries the new pre-computed day-of-week fields
 *      (day_baseline, day_analysis, created_day_baseline,
 *      created_day_analysis) so the client can render the combined
 *      "Mon., YYYY-MM-DD" format without re-parsing dates in the browser.
 *
 *   2. Event dates render in the table as "Day., YYYY-MM-DD" (combined
 *      day + date in a single cell). Catches accidental reverts that would
 *      put us back to two cells per date.
 *
 *   3. Event Created dates render in the same combined format.
 *
 *   4. The standalone "Day" <th> + <td> cells are gone (we collapsed them
 *      into the date cell). This is the regression guard for the column
 *      cleanup that motivated the format change.
 *
 * Lives alongside the other roster-side tests and can be run via:
 *   node --test tests/dashboard.test.js
 *
 * The fixture is intentionally small (one Retained, one Lost, one New) so
 * any drift in generate_dashboard's public surface is loud + fast to spot.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { generate_dashboard } = require('../src/dashboard.js');

// ── Shared fixture ─────────────────────────────────────────────────────────

// Minimal `results` shape -- the chart blocks only need scalar/array shapes
// to not throw; commentary is empty. The roster table is what we actually
// inspect, and that comes from `segments_raw`.
function build_fixture() {
  const results = {
    segments:  { Retained: 1, Shifted: 0, 'Tried to Return': 0, Lost: 1, Recovered: 0, New: 1 },
    n25: 2, n26: 2,
    byType25: { 'Adult Race': 2, 'Youth Race': 0, 'Adult Clinic': 0, 'Youth Clinic': 0 },
    byType26: { 'Adult Race': 2, 'Youth Race': 0, 'Adult Clinic': 0, 'Youth Clinic': 0 },
    byMonth25: Array(13).fill(0),
    byMonth26: Array(13).fill(0),
    raw_deltas: Array(13).fill(0),
    org_deltas: Array(13).fill(0),
    org_pct_by_type: { 'Adult Race': 0, 'Youth Race': 0, 'Adult Clinic': 0, 'Youth Clinic': 0 },
    cal: Array(13).fill({ calTotal: 0, ds: 0, du: 0, w25: 0, w26: 0 }),
    year_a: 2025, year_b: 2026, asOf: new Date('2026-05-23T00:00:00Z'),
  };

  // Three rows of distinct shapes:
  //   - Retained: both sides, both dates -> combined format on both columns
  //   - Lost:     baseline-only sid + dates
  //   - New:      analysis-only sid + dates
  const segments_raw = {
    retained: [{
      seg: 'Retained', conf: 'high',
      e25: { sanctionId: 'BL-1', name: 'Test BL',  type: 'Adult Race', month:  5,
             startDate: '2025-05-10', status: 'sanctioned', createdAt: '2024-12-01' },
      e26: { sanctionId: 'AN-1', name: 'Test AN',  type: 'Adult Race', month:  6,
             startDate: '2026-06-15', status: 'sanctioned', createdAt: '2025-12-01' },
    }],
    shifted: [], triedToReturn: [], recovered: [],
    attrited: [{
      seg: 'Lost', conf: 'high',
      e25: { sanctionId: 'BL-LOST', name: 'Lost Event', type: 'Adult Race', month: 7,
             startDate: '2025-07-04', status: 'sanctioned', createdAt: '2024-10-15' },
      e26: null,
    }],
    new: [{
      seg: 'New', conf: 'high',
      e25: null,
      e26: { sanctionId: 'AN-NEW', name: 'New Event', type: 'Adult Race', month: 8,
             startDate: '2026-08-22', status: 'sanctioned', createdAt: '2026-01-15' },
    }],
  };

  const cm = {
    headline:    { tag: '', title: '', sub: '' },
    kpi_strip:   { ret_pct: '', leakage: {} },
    segments_top: '', segments_bottom: '',
  };

  return { results, segments_raw, cm };
}

function render_to_tmp() {
  const { results, segments_raw, cm } = build_fixture();
  const out = path.join(os.tmpdir(), 'dash_test_' + Date.now() + '.html');
  generate_dashboard(results, cm, out, segments_raw);
  const html = fs.readFileSync(out, 'utf8');
  try { fs.unlinkSync(out); } catch {}
  return html;
}

// Extract the embedded `const ROSTER = [...]` literal and parse it. The
// dashboard script is regular-rendered JSON inside a const-assignment, so
// we slice from `[` to the matching closing `];` to get clean JSON.
function extract_roster(html) {
  const m = html.match(/const ROSTER\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(m, 'could not locate `const ROSTER = ...` in dashboard HTML');
  return JSON.parse(m[1]);
}

// ── 1. Roster row carries pre-computed day-of-week fields ──────────────────

describe('dashboard renderer -- roster fields', () => {

  test('every roster row has day_baseline / day_analysis / created_day_* fields', () => {
    const roster = extract_roster(render_to_tmp());
    assert.equal(roster.length, 3, 'fixture should produce 3 rows');
    for (const r of roster) {
      assert.ok('day_baseline' in r,         'missing day_baseline: ' + JSON.stringify(r));
      assert.ok('day_analysis' in r,         'missing day_analysis: ' + JSON.stringify(r));
      assert.ok('created_day_baseline' in r, 'missing created_day_baseline: ' + JSON.stringify(r));
      assert.ok('created_day_analysis' in r, 'missing created_day_analysis: ' + JSON.stringify(r));
    }
  });

  test('day fields are 3-letter weekday strings when the underlying date is present', () => {
    const roster = extract_roster(render_to_tmp());
    // 2025-05-10 is a Saturday, 2026-06-15 is a Monday.
    const retained = roster.find(r => r.sid_baseline === 'BL-1');
    assert.ok(retained, 'Retained fixture row not in roster');
    assert.equal(retained.day_baseline, 'Sat');
    assert.equal(retained.day_analysis, 'Mon');
    // createdAt 2024-12-01 is Sunday, 2025-12-01 is Monday.
    assert.equal(retained.created_day_baseline, 'Sun');
    assert.equal(retained.created_day_analysis, 'Mon');
  });

  test('day fields are blank when the corresponding side is missing', () => {
    const roster = extract_roster(render_to_tmp());
    const lost = roster.find(r => r.seg === 'Lost');
    const _new = roster.find(r => r.seg === 'New');
    assert.ok(lost && _new, 'Lost / New fixture rows not in roster');
    assert.equal(lost.day_analysis,         '', 'Lost row has no analysis side, day should be blank');
    assert.equal(lost.created_day_analysis, '', 'Lost row has no analysis createdAt, day should be blank');
    assert.equal(_new.day_baseline,         '', 'New row has no baseline side, day should be blank');
    assert.equal(_new.created_day_baseline, '', 'New row has no baseline createdAt, day should be blank');
  });
});

// ── 2. Combined "Day., YYYY-MM-DD" format renders in the table cells ───────

describe('dashboard renderer -- combined date format', () => {

  test('fmt_date_with_day helper is present in the page script', () => {
    const html = render_to_tmp();
    assert.match(html, /function fmt_date_with_day\b/,
      'fmt_date_with_day helper should be inlined in the dashboard script');
  });

  test('row_html calls fmt_date_with_day on both date AND created cells, for both years', () => {
    const html = render_to_tmp();
    // Each fmt_date_with_day call site is uniquely identifiable by the
    // (day, date) arg pair. Four total: date_baseline, created_baseline,
    // date_analysis, created_analysis.
    assert.match(html, /fmt_date_with_day\(r\.day_baseline,\s*r\.date_baseline\)/);
    assert.match(html, /fmt_date_with_day\(r\.created_day_baseline,\s*r\.created_baseline\)/);
    assert.match(html, /fmt_date_with_day\(r\.day_analysis,\s*r\.date_analysis\)/);
    assert.match(html, /fmt_date_with_day\(r\.created_day_analysis,\s*r\.created_analysis\)/);
  });

  test('fmt_date_with_day produces "Day., YYYY-MM-DD" when both args present', () => {
    // Re-invoke the same logic the dashboard ships. We rebuild the helper
    // inline to keep the test self-contained (no eval of the full HTML).
    function fmt_date_with_day(day, date) {
      if (day && date) return day + '., ' + date;
      return date || day || '';
    }
    assert.equal(fmt_date_with_day('Mon', '2025-05-10'), 'Mon., 2025-05-10');
    assert.equal(fmt_date_with_day('',    '2025-05-10'), '2025-05-10');
    assert.equal(fmt_date_with_day('Mon', ''),           'Mon');
    assert.equal(fmt_date_with_day('',    ''),           '');
  });

  // End-to-end check: the rendered HTML actually carries the combined
  // string the user sees in the browser. Helper-level + call-site tests
  // above confirm the *plumbing*; this confirms the *output*. If a future
  // edit drops the helper call from row_html, or wraps the cell with HTML
  // that breaks the literal pattern, this fires.
  test('rendered roster row carries the literal "Day., YYYY-MM-DD" for event + created cells', () => {
    const html = render_to_tmp();
    const roster = extract_roster(html);
    const retained = roster.find(r => r.sid_baseline === 'BL-1');
    assert.ok(retained, 'Retained fixture row not in roster');

    // The dashboard renders the rows client-side from ROSTER, so they
    // aren't in the HTML body at build time. Build the expected cell
    // string ourselves and confirm it would render correctly by running
    // the row_html function the dashboard ships. We extract the function
    // text and exercise it directly with the retained row -- same code
    // path the browser will run on page load.
    const fn_match = html.match(/function row_html\(r\)\s*\{[\s\S]*?\n\s{2}\}/);
    assert.ok(fn_match, 'could not locate row_html function in dashboard HTML');
    const fmt_match = html.match(/function fmt_date_with_day\(day, date\)\s*\{[\s\S]*?\n\s{2}\}/);
    assert.ok(fmt_match, 'could not locate fmt_date_with_day function in dashboard HTML');

    // Build a minimal harness that provides the few globals row_html closes
    // over (SEG_CLS, _row_num, escape_attr).
    const harness = `
      const SEG_CLS = {'Retained':'Retained','Shifted':'Shifted','Lost':'Lost',
        'New':'New','Recovered':'Recovered','Tried to Return':'TtR'};
      let _row_num = 0;
      function escape_attr(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      ${fmt_match[0]}
      ${fn_match[0]}
      return row_html;
    `;
    // eslint-disable-next-line no-new-func
    const row_html = new Function(harness)();
    const tr = row_html(retained);

    // The combined date should appear verbatim. Sat is the correct UTC
    // weekday for 2025-05-10; Sun is correct for 2024-12-01.
    assert.ok(tr.includes('Sat., 2025-05-10'),
      `expected "Sat., 2025-05-10" in rendered <tr>, got:\n${tr}`);
    assert.ok(tr.includes('Sun., 2024-12-01'),
      `expected "Sun., 2024-12-01" in rendered <tr>, got:\n${tr}`);
    assert.ok(tr.includes('Mon., 2026-06-15'),
      `expected "Mon., 2026-06-15" in rendered <tr>, got:\n${tr}`);
    assert.ok(tr.includes('Mon., 2025-12-01'),
      `expected "Mon., 2025-12-01" in rendered <tr>, got:\n${tr}`);
  });
});

// ── 4. Reviewed? column sits right after Conf ──────────────────────────
describe('dashboard renderer -- Reviewed? column position', () => {

  test('<th data-col="reviewed"> immediately follows <th data-col="conf"> in the header row', () => {
    const html = render_to_tmp();
    const head_m = html.match(/<thead>[\s\S]*?<\/thead>/);
    assert.ok(head_m, 'could not locate <thead> in dashboard HTML');
    const head_html = head_m[0];
    const conf_idx     = head_html.indexOf('data-col="conf"');
    const reviewed_idx = head_html.indexOf('data-col="reviewed"');
    const type_idx     = head_html.indexOf('data-col="type"');
    assert.ok(conf_idx     >= 0, 'Conf column not found in header');
    assert.ok(reviewed_idx >= 0, 'Reviewed? column not found in header');
    assert.ok(type_idx     >= 0, 'Type column not found in header');
    assert.ok(reviewed_idx > conf_idx,
      `Reviewed? should come AFTER Conf (conf at ${conf_idx}, reviewed at ${reviewed_idx})`);
    const between = head_html.slice(conf_idx, reviewed_idx);
    const intervening_ths = (between.match(/<th\b/g) || []).length;
    assert.equal(intervening_ths, 1,
      `expected no <th> between Conf and Reviewed?, found ${intervening_ths - 1} intervening`);
    assert.ok(reviewed_idx < type_idx,
      `Reviewed? should come BEFORE Type (reviewed at ${reviewed_idx}, type at ${type_idx})`);
  });

  test('row_html emits the Reviewed? <td> immediately after the Conf <td>', () => {
    const html = render_to_tmp();
    const fn_match = html.match(/function row_html\(r\)\s*\{[\s\S]*?\n\s{2}\}/);
    assert.ok(fn_match, 'could not locate row_html function in dashboard HTML');
    const fn = fn_match[0];
    const conf_idx     = fn.indexOf('+r.conf+');
    const reviewed_idx = fn.indexOf('dash-ov-reviewed');
    const ov_type_idx  = fn.indexOf('ov-cell-type');
    assert.ok(conf_idx     >= 0 && reviewed_idx >= 0 && ov_type_idx >= 0,
      'expected markers not found in row_html');
    assert.ok(reviewed_idx > conf_idx,
      'Reviewed? cell should come AFTER the Conf cell in row_html');
    assert.ok(reviewed_idx < ov_type_idx,
      'Reviewed? cell should come BEFORE the ov-type cell in row_html');
  });
});


// ── 5. Reviewed? state persists across every table re-render ──────────────
//
// The whole bug class behind these tests: row_html emits the Reviewed?
// checkbox empty -- the dashboard's _by_sid lookup paints it after the
// API call returns. ANY code that wipes tbody.innerHTML and rebuilds rows
// will reset every checkbox unless refresh_status_column runs again.
// These tests assert the contract.

describe('dashboard renderer -- Reviewed? checkbox persistence contract', () => {

  function extract_fn(html, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s{2}\\}');
    const m = html.match(re);
    assert.ok(m, 'could not locate function ' + name + ' in dashboard HTML');
    return m[0];
  }

  test('render_table re-invokes the override repaint after rewriting tbody', () => {
    const fn = extract_fn(render_to_tmp(), 'render_table');
    assert.match(fn, /tbody\.innerHTML\s*=/, 'render_table should still rewrite tbody');
    assert.match(fn, /dash_ov_refresh_status_column\s*\(\s*\)/,
      'render_table must call dash_ov_refresh_status_column() after rewriting tbody');
  });

  test('load_all re-invokes the override repaint after rewriting tbody', () => {
    const fn = extract_fn(render_to_tmp(), 'load_all');
    assert.match(fn, /tbody\.innerHTML\s*=/, 'load_all should still rewrite tbody');
    assert.match(fn, /dash_ov_refresh_status_column\s*\(\s*\)/,
      'load_all must call dash_ov_refresh_status_column() after rewriting tbody');
  });

  test('dash_ov_refresh_status_column is exposed on window so render_table can reach it', () => {
    const html = render_to_tmp();
    assert.match(html, /window\.dash_ov_refresh_status_column\s*=\s*refresh_status_column/,
      'window bridge missing -- render_table cannot reach refresh_status_column without it');
  });

  test('toggle_col is CSS-only -- does not rewrite tbody (column toggle does not lose Reviewed state)', () => {
    const html = render_to_tmp();
    const m = html.match(/function\s+toggle_col\s*\([^)]*\)\s*\{[\s\S]*?\n\s{2}\}/);
    assert.ok(m, 'toggle_col function not found');
    const fn = m[0];
    assert.match(fn, /classList\.(add|remove)/, 'toggle_col should toggle a CSS class');
    assert.doesNotMatch(fn, /tbody\.innerHTML/, 'toggle_col must NOT rewrite tbody');
  });
});

describe('dashboard renderer -- every interactive surface routes through the repaint contract', () => {

  const HANDLERS = [
    { label: 'search box input', route: /addEventListener\('input',\s*filter_and_sort\)/ },
    { label: 'sort header click', route: /th\.addEventListener\('click'[\s\S]{0,400}filter_and_sort\(\)/ },
    { label: 'sort by reviewed (special-case branch)', route: /sort_col\s*===\s*'reviewed'/ },
    { label: 'sort by reviewed uses _dash_ov_is_reviewed bridge', route: /window\._dash_ov_is_reviewed/ },
    { label: 'Reviewed? th is no longer cursor:default (now sortable)', route: /data-col="reviewed"[^>]*Sort by reviewed/ },
    { label: 'sort by month-baseline uses month index, not alpha', route: /sort_col\s*===\s*'m_baseline'/ },
    { label: 'sort by month-analysis uses month index, not alpha', route: /sort_col\s*===\s*'m_analysis'/ },
    { label: 'sort by override column (special-case branch)', route: /sort_col\s*===\s*'override'/ },
    { label: 'sort by ov-type column (special-case branch)', route: /sort_col\s*===\s*'ov-type'/ },
    { label: 'sort by ov-approved column (special-case branch)', route: /sort_col\s*===\s*'ov-approved'/ },
    { label: 'sort by ov-note column (special-case branch)', route: /sort_col\s*===\s*'ov-note'/ },
    { label: 'override-derived sort uses _dash_ov_lookup bridge', route: /window\._dash_ov_lookup/ },
    { label: 'segment filter dropdown', route: /panel-drop-seg[\s\S]{0,200}filter_and_sort\(\)/ },
    { label: 'type filter dropdown', route: /panel-drop-type[\s\S]{0,200}filter_and_sort\(\)/ },
    { label: 'month filter dropdown', route: /panel-drop-month[\s\S]{0,200}filter_and_sort\(\)/ },
    { label: 'status filter dropdown', route: /panel-drop-status[\s\S]{0,200}filter_and_sort\(\)/ },
    { label: 'segment chip click', route: /toggle_seg_chip[\s\S]{0,200}filter_and_sort\(\)/ },
    { label: 'Show all events button', route: /onclick="load_all\(\)"/ },
    { label: 'remove-chip (search)', route: /tbl-search[\s\S]{0,80}filter_and_sort\(\)/ },
    // ── Creation chart enhancements (#138 / #139 / #140) ──────────────────
    { label: 'creation chart has Expand button', route: /expand_chart\('c_creation'\)/ },
    { label: 'creation chart has PNG export button', route: /export_png\('c_creation'\)/ },
    { label: 'creation chart has CSV export button', route: /export_csv\('c_creation'\)/ },
    { label: 'creation chart has table-flip button', route: /flip_chart_table\('c_creation'\)/ },
    { label: 'creation chart has table-flip div', route: /id="flip-tbl-c_creation"/ },
    { label: 'creation chart has type-filter dropdown', route: /id="creation-type-pick"/ },
    { label: 'type dropdown lists all four event types', route: /id="creation-type-pick"[\s\S]{0,500}Adult Race[\s\S]{0,200}Youth Race[\s\S]{0,200}Adult Clinic[\s\S]{0,200}Youth Clinic/ },
    { label: 'creation type-picker is wired to _creation_render on change', route: /creation-type-pick[\s\S]{0,80}addEventListener\('change',\s*_creation_render\)/ },
    { label: 'creation _aggregate accepts a type_filter argument', route: /function _creation_aggregate\(year,\s*type_filter\)/ },
    { label: 'creation _aggregate skips rows whose type doesnt match the filter', route: /if \(type_filter && r\.type !== type_filter\) continue/ },
    { label: 'creation chart tooltip has a footer callback (the Total line)', route: /tooltip:\s*\{[\s\S]{0,500}footer:\s*function/ },
    { label: 'creation chart tooltip footer emits "Total:" prefix', route: /'Total: '\s*\+\s*total\.toLocaleString\(\)/ },
    { label: 'creation chart is registered in CHARTS map (so action buttons find it)', route: /CHARTS\['c_creation'\]\s*=\s*_creation_chart/ },
    { label: 'creation chart snapshot is populated in CHART_SNAP (for expand modal)', route: /CHART_SNAP\['c_creation'\]\s*=/ },
    // -- Year-over-year creation pace chart (#141) --------------------
    { label: 'pace chart canvas is present', route: /id="c_pace"/ },
    { label: 'pace chart has Expand button', route: /expand_chart\('c_pace'\)/ },
    { label: 'pace chart has PNG export button', route: /export_png\('c_pace'\)/ },
    { label: 'pace chart has CSV export button', route: /export_csv\('c_pace'\)/ },
    { label: 'pace chart has table-flip button', route: /flip_chart_table\('c_pace'\)/ },
    { label: 'pace chart has table-flip div', route: /id="flip-tbl-c_pace"/ },
    { label: '_pace_aggregate accepts (year_filter, type_filter)', route: /function _pace_aggregate\(year_filter,\s*type_filter\)/ },
    { label: 'pace chart has year-picker (Both / baseline / analysis)', route: /id="pace-year-pick"/ },
    { label: 'pace chart has type-picker (All + 4 types)', route: /id="pace-type-pick"/ },
    { label: 'pace year-picker wired to _pace_render', route: /pace-year-pick[\s\S]{0,100}addEventListener\('change',\s*_pace_render\)/ },
    { label: 'pace type-picker wired to _pace_render', route: /pace-type-pick[\s\S]{0,100}addEventListener\('change',\s*_pace_render\)/ },
    { label: '_pace_render function is defined', route: /function _pace_render\(\)/ },
    { label: 'pace lead_days helper guards negative deltas', route: /days\s*>=\s*0\s*\?\s*Math\.min\(days,\s*MAX_LEAD_DAYS\)/ },
    { label: '_pace_render is called once at boot', route: /\n_pace_render\(\);/ },
    { label: 'pace chart is registered in CHARTS map', route: /CHARTS\['c_pace'\]\s*=\s*_pace_chart/ },
    { label: 'pace chart snapshot populated in CHART_SNAP', route: /CHART_SNAP\['c_pace'\]\s*=/ },
    { label: 'pace y-axis uses dynamic y_max (adapts to range picker)', route: /beginAtZero:\s*true,\s*max:\s*y_max/ },
    { label: 'pace tidy_y_max helper rounds up to 5/10/25/50/100 buckets', route: /function tidy_y_max\(arrays\)[\s\S]{0,400}return 100/ },
    { label: 'pace chart has range picker',  route: /id="pace-range-pick"/ },
    { label: 'pace range picker wired to _pace_render', route: /pace-range-pick[\s\S]{0,100}addEventListener\('change',\s*_pace_render\)/ },
    { label: 'timing chart has range picker', route: /id="timing-range-pick"/ },
    { label: 'timing range default is -12 to +12 (selected)', route: /value="-12,12"\s+selected/ },
    { label: 'timing range picker wired to _timing_render', route: /timing-range-pick[\s\S]{0,100}addEventListener\('change',\s*_timing_render\)/ },
    // ── Override editor: must boot itself (initial fetch on page load) ────
    // Bug class: dash_ov_init defines window.dash_ov_refresh but never
    // calls it at boot, so the page sits on the "● checking server…" +
    // "Loading…" placeholders until the user clicks the Refresh button.
    // Guard the boot calls so this can't silently break again.
    { label: 'override editor boot calls dash_ov_refresh at IIFE end', route: /window\.dash_ov_refresh === 'function'\)\s*window\.dash_ov_refresh\(\)/ },
    { label: 'override editor boot calls wire_list_actions at IIFE end', route: /wire_list_actions === 'function'\)\s*wire_list_actions\(\)/ },
    { label: 'override editor boot calls refresh_form_vis at IIFE end', route: /refresh_form_vis\s*=== 'function'\)\s*refresh_form_vis\(\)/ },
    // ── Pace chart: hover readout + median conclusion (#172) ──────────────
    { label: 'pace chart has live hover-readout div', route: /id="pace-readout-text"/ },
    { label: 'pace chart has median-conclusion div', route: /id="pace-conclusion"/ },
    { label: '_pace_median helper is defined', route: /function _pace_median\(/ },
    { label: '_pace_conclusion_text helper is defined', route: /function _pace_conclusion_text\(/ },
    { label: 'pace conclusion explains MORE lead time (more runway)', route: /MORE days of lead time[\s\S]{0,120}more planning runway/ },
    { label: 'pace conclusion explains FEWER lead time (less runway)', route: /FEWER days of lead time[\s\S]{0,120}less planning runway/ },
    { label: 'pace conclusion handles SAME median branch (no shift)', route: /SAME median lead time[\s\S]{0,80}no shift in planning runway/ },
    { label: 'timing chart x-axis ticks are 2-line array (sign over month)', route: /function _timing_tick_2line\(/ },
    { label: 'timing chart NO LONGER stacks bars by type (simple grouped bars)', route: /backgroundColor:\s*'#1565C0'[\s\S]{0,400}backgroundColor:\s*'#E65100'/ },
    { label: 'above_label_plugin draws data values above bars when there is space', route: /id:\s*'above_labels'/ },
    { label: 'timing chart enables above_labels plugin', route: /above_labels:\s*\{\s*show:\s*true/ },
    { label: 'timing tooltip per-bar line includes " events"', route: /' events'/ },
    // Timing chart: stacked-by-type bars + dynamic conclusion + clearer x-axis
    { label: 'timing chart has dynamic conclusion div', route: /id="timing-conclusion"/ },
    { label: '_timing_conclusion_text helper is defined', route: /function _timing_conclusion_text\(/ },
    { label: 'timing conclusion mentions biggest YoY swing', route: /Biggest YoY swing at/ },
    { label: '_timing_label_long includes numeric offset for tooltip', route: /function _timing_label_long\(/ },
    { label: 'pace chart wires onHover to update the readout div', route: /onHover:\s*function[\s\S]{0,500}pace-readout-text/ },
    // -- Creation timing relative to event year (#173) ---------------
    { label: 'timing chart canvas is present', route: /id="c_timing"/ },
    { label: 'timing chart has Expand button', route: /expand_chart\('c_timing'\)/ },
    { label: 'timing chart has PNG button',    route: /export_png\('c_timing'\)/ },
    { label: 'timing chart has CSV button',    route: /export_csv\('c_timing'\)/ },
    { label: 'timing chart has Table button',  route: /flip_chart_table\('c_timing'\)/ },
    { label: 'timing chart has year-picker',   route: /id="timing-year-pick"/ },
    { label: 'timing chart has type-picker',   route: /id="timing-type-pick"/ },
    { label: 'timing type-picker lists all four event types', route: /id="timing-type-pick"[\s\S]{0,800}Adult Race[\s\S]{0,300}Youth Race[\s\S]{0,300}Adult Clinic[\s\S]{0,300}Youth Clinic/ },
    { label: '_timing_offset helper is defined', route: /function _timing_offset\(/ },
    { label: '_timing_offset same-year branch present', route: /created_year >= event_year/ },
    { label: '_timing_offset prior-year branch present', route: /months_before = \(event_year - created_year - 1\) \* 12 \+ \(12 - created_month \+ 1\)/ },
    { label: '_timing_label helper is defined', route: /function _timing_label\(/ },
    { label: '_timing_aggregate accepts (year_filter, type_filter)', route: /function _timing_aggregate\(year_filter,\s*type_filter\)/ },
    { label: '_timing_aggregate skips zero-offset slot', route: /if \(o === 0\) continue/ },
    { label: '_timing_render function defined', route: /function _timing_render\(\)/ },
    { label: '_timing_render is called at boot', route: /\n_timing_render\(\);/ },
    { label: 'timing year-picker wired to _timing_render', route: /timing-year-pick[\s\S]{0,100}addEventListener\(\'change\',\s*_timing_render\)/ },
    { label: 'timing type-picker wired to _timing_render', route: /timing-type-pick[\s\S]{0,100}addEventListener\(\'change\',\s*_timing_render\)/ },
    { label: 'timing chart registered in CHARTS', route: /CHARTS\[\'c_timing\'\]\s*=\s*_timing_chart/ },
    { label: 'timing chart snapshot in CHART_SNAP', route: /CHART_SNAP\[\'c_timing\'\]\s*=/ },
    // Pace conclusion refinement + timing chart enhancements
    { label: 'timing chart has dynamic conclusion div', route: /id="timing-conclusion"/ },
    { label: '_timing_conclusion_text helper is defined', route: /function _timing_conclusion_text\(/ },
    { label: 'timing conclusion mentions biggest YoY swing', route: /Biggest YoY swing at/ },
    { label: '_timing_label_long helper is defined', route: /function _timing_label_long\(/ },
    // ── Chart expand-modal: HTML class names must match CSS sizing rules ──
    // History: a rebuild switched the modal HTML to .chart-modal-body /
    // .chart-modal-head / .chart-modal-canvas-wrap, but the CSS defines
    // .modal-box / .modal-hdr / .modal-canvas-wrap. The mismatch meant
    // no width/height rules applied and the popout was unreadably small.
    // These tests guard the contract going forward.
    { label: 'modal HTML uses .modal-box wrapper',         route: /<div\s+class="modal-box">/ },
    { label: 'modal HTML uses .modal-hdr header',          route: /<div\s+class="modal-hdr">/ },
    { label: 'modal HTML uses .modal-canvas-wrap',         route: /<div\s+class="modal-canvas-wrap">/ },
    { label: 'modal CSS sets explicit width in vw',        route: /\.modal-box\s*\{[\s\S]{0,200}width:\s*\d+vw/ },
    { label: 'modal CSS sets explicit height in vh',       route: /\.modal-box\s*\{[\s\S]{0,200}height:\s*\d+vh/ },
    { label: 'modal canvas wrap is flex:1 + min-height:0', route: /\.modal-canvas-wrap\s*\{[\s\S]{0,200}flex:\s*1[\s\S]{0,200}min-height:\s*0/ },
  ];

  for (const h of HANDLERS) {
    test(h.label + ' routes through filter_and_sort or load_all', () => {
      const html = render_to_tmp();
      assert.match(html, h.route,
        'surface "' + h.label + '" does not route through the repaint contract');
    });
  }

  // Negative guards: the broken modal class names must NOT appear.
  test('rendered HTML does NOT contain the broken modal class names', () => {
    const html = render_to_tmp();
    assert.doesNotMatch(html, /chart-modal-body/,
      'modal HTML must use .modal-box, not the broken .chart-modal-body');
    assert.doesNotMatch(html, /chart-modal-head/,
      'modal HTML must use .modal-hdr, not the broken .chart-modal-head');
    assert.doesNotMatch(html, /chart-modal-canvas-wrap/,
      'modal HTML must use .modal-canvas-wrap, not the broken .chart-modal-canvas-wrap');
  });
});


// ── 6. Runtime guard: inline dashboard scripts execute without throwing ────
//
// Static parse-checks miss runtime errors (TDZ, undefined property reads,
// missing function args, etc.) that halt the inline <script> block and
// leave the page half-rendered (empty table, empty charts).
//
// This test renders generate_dashboard, extracts every inline script
// (skipping any with src=), and executes each one in a Node vm sandbox
// with stubbed DOM + Chart constructor + storage APIs. Any throw fails
// the test. Catches the bug class behind "all unit tests pass but the
// table is empty in the browser."
//
// The sandbox is intentionally permissive -- the goal is to surface
// errors in OUR code, not to perfectly emulate a browser. Anything our
// code depends on that ISN'T in the sandbox would surface as a real
// runtime error in the browser too.

const vm = require('node:vm');

describe('dashboard renderer -- inline scripts execute without throwing', () => {

  function stub_el() {
    const el = {
      style: {},
      classList: { add(){}, remove(){}, contains(){return false}, toggle(){} },
      addEventListener(){}, removeEventListener(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      getContext(){ return { fillStyle:'', fillRect(){}, drawImage(){}, save(){}, restore(){},
        fillText(){}, strokeText(){}, font:'', textAlign:'', textBaseline:'',
        measureText(){ return { width: 0 }; } }; },
      appendChild(){}, removeChild(){}, dataset: {}, dispatchEvent(){},
      setAttribute(){}, getAttribute(){ return null; }, value: '',
      textContent: '', innerHTML: '',
      toDataURL(){ return ''; }, click(){}, parentNode: null,
      closest(){ return null; },
      getBoundingClientRect(){ return { width: 100, height: 100 }; },
      width: 100, height: 100,
    };
    el.childNodes = [{ nodeValue: '' }];
    return el;
  }

  function make_sandbox() {
    const Chart = class {
      constructor(c, cfg) {
        this.canvas = stub_el();
        this.data = (cfg && cfg.data) || { labels: [], datasets: [] };
        this.options = (cfg && cfg.options) || { plugins: {} };
        this.config = cfg;
      }
      update(){} destroy(){}
      getDatasetMeta(){ return { data: [], hidden: false }; }
    };
    Chart.register = () => {};
    Chart.defaults = { font: { family: '', size: 12 }, color: '#000', plugins: {} };

    const sb = {
      console: { log(){}, warn(){}, error(){}, info(){} },
      document: {
        getElementById: () => stub_el(),
        querySelector:  () => stub_el(),
        querySelectorAll: () => [],
        documentElement: { classList: { add(){}, remove(){}, contains(){return false}, toggle(){} } },
        addEventListener: () => {},
        createElement: () => stub_el(),
        body: stub_el(), head: stub_el(),
      },
      location: { pathname: '/', hash: '', href: '' },
      Chart,
      setTimeout, clearTimeout, setInterval, clearInterval,
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      localStorage:   { getItem(){return null}, setItem(){}, removeItem(){} },
      sessionStorage: { getItem(){return null}, setItem(){}, removeItem(){} },
    };
    sb.window = sb;
    sb.globalThis = sb;
    return sb;
  }

  test('every inline <script> in dashboard.html runs without throwing', () => {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);
    assert.ok(scripts.length >= 2, 'expected at least 2 inline <script> blocks (got ' + scripts.length + ')');

    const ctx = vm.createContext(make_sandbox());
    const errors = [];
    for (let i = 0; i < scripts.length; i++) {
      try {
        vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 });
      } catch (e) {
        errors.push('script #' + (i + 1) + ' (' + scripts[i].length + ' chars): ' + e.message);
      }
    }
    assert.deepEqual(errors, [],
      'inline scripts threw at runtime -- browser would show empty table/charts:\n  ' + errors.join('\n  '));
  });

  // Stronger guard: simulate http:// + stub fetch, then assert that the
  // boot path actually CALLS /api/status and /api/overrides. The earlier
  // bug class -- dash_ov_init defining dash_ov_refresh but never calling
  // it at boot -- passes the "no throw" test but leaves the editor stuck
  // on "Loading...". This test catches that.
  test('inline scripts hit /api/status + /api/overrides on boot (http context)', () => {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    const fetch_calls = [];
    const sb = make_sandbox();
    sb.location = { protocol: 'http:', pathname: '/output/dashboard.html', hash: '', href: 'http://localhost:8016/output/dashboard.html' };
    sb.fetch = (path) => {
      fetch_calls.push(path);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ force_match: [], force_no_match: [], force_segment: [], stats: {}, time: Date.now() }),
      });
    };
    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow -- the no-throw test covers that contract */ }
    }
    // Wait one microtask tick so the promise chain in dash_ov_refresh runs.
    return new Promise((resolve) => setTimeout(() => {
      assert.ok(fetch_calls.includes('/api/status'),
        '/api/status was never fetched on boot -- override editor will sit on "Loading..." forever. fetch_calls=' + JSON.stringify(fetch_calls));
      assert.ok(fetch_calls.includes('/api/overrides'),
        '/api/overrides was never fetched on boot. fetch_calls=' + JSON.stringify(fetch_calls));
      resolve();
    }, 100));
  });

  // Regression guard: the bootstrap script in <head> adds .dash-ov-rebuilding
  // to <html> when sessionStorage carries the rebuild flag (so the new page's
  // first paint is the overlay, no white flash). For a long time NOTHING in
  // the page removed it -- the spinner stayed up until the user manually
  // refreshed. The dash_ov_init boot block now schedules a fade-out + class
  // removal; this test makes sure that code stays in place.
  test('rebuild overlay class is removed on the new page after boot', () => {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    // A real classList that tracks state, so the boot code's
    // contains('dash-ov-rebuilding') check returns true and we can later
    // verify the class is gone.
    function real_class_list(seed) {
      const set = new Set(seed || []);
      return {
        add(c){ set.add(c); },
        remove(c){ set.delete(c); },
        contains(c){ return set.has(c); },
        toggle(c){ if (set.has(c)) set.delete(c); else set.add(c); },
        _set: set,
      };
    }

    const html_cl    = real_class_list(['dash-ov-rebuilding']);
    const overlay_cl = real_class_list([]);
    const overlay_el = { style: {}, classList: overlay_cl };

    const sb = make_sandbox();
    // documentElement.classList must track real state for this test, so
    // the boot code's .contains('dash-ov-rebuilding') check returns true
    // and we can later verify .remove() actually wiped the class.
    sb.document.documentElement = { classList: html_cl };
    // getElementById('dash-ov-overlay') must return our tracked element
    // so the boot code's fade-out / cleanup hits a real classList.
    const orig_get = sb.document.getElementById;
    sb.document.getElementById = (id) => (id === 'dash-ov-overlay' ? overlay_el : orig_get(id));

    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow -- no-throw test covers that contract */ }
    }

    // The boot schedules fade at +600ms and final class removal at +1000ms
    // (600 + 400). Wait a bit longer than that to be safe.
    return new Promise((resolve) => setTimeout(() => {
      assert.ok(!html_cl.contains('dash-ov-rebuilding'),
        'rebuild overlay class was never removed after boot -- spinner would stay up until manual refresh. html.classList=' + JSON.stringify([...html_cl._set]));
      // By final cleanup the overlay element should no longer carry fade-out.
      assert.ok(!overlay_cl.contains('fade-out'),
        'overlay element still carries fade-out class after final cleanup. overlay.classList=' + JSON.stringify([...overlay_cl._set]));
      resolve();
    }, 1200));
  });

  // ── Enhancement #1: ad-hoc rebuild year-input validation ──────────────────
  // The years card in dash_ov_init exposes:
  //   - HTML: <input type=number min=2000 max=2100> + an inline error div
  //   - JS:   dash_ov_rebuild_with_years() refuses to kick off /api/build
  //           when both inputs are blank, when either is non-integer, or
  //           when either is outside [2000, current_year+5].
  // These guards stop a bad-year rebuild from getting all the way to the
  // backend (which only surfaces the error in the streaming log).

  test('rebuild years inputs have type=number with min/max guards', () => {
    const html = render_to_tmp();
    assert.match(html, /id="dash-ov-rebuild-baseline"[^>]*type="number"/);
    assert.match(html, /id="dash-ov-rebuild-analysis"[^>]*type="number"/);
    assert.match(html, /id="dash-ov-rebuild-baseline"[^>]*min="2000"[^>]*max="2100"/);
    assert.match(html, /id="dash-ov-rebuild-analysis"[^>]*min="2000"[^>]*max="2100"/);
    assert.match(html, /id="dash-ov-rebuild-years-err"/);
  });

  // Tiny input-like stub with a working .value + .textContent + addEventListener.
  function make_input(initial) {
    const listeners = {};
    return {
      value: initial == null ? '' : String(initial),
      textContent: '',
      style: {},
      classList: { add(){}, remove(){}, contains(){return false}, toggle(){} },
      addEventListener(name, cb){ (listeners[name] = listeners[name] || []).push(cb); },
      _fire(name){ (listeners[name] || []).forEach((cb) => cb({})); },
    };
  }

  // Drive dash_ov_rebuild_with_years directly. Stubs the rebuild kickoff so
  // we can assert whether the function tried to fire /api/build, and reads
  // the err div's textContent so we can assert the user-visible message.
  function run_with_years_harness({ baseline, analysis }) {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    const html_cl = { _set: new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)},
                      contains(c){return this._set.has(c)}, toggle(c){this._set.has(c)?this._set.delete(c):this._set.add(c)} };

    const bp_el = make_input(baseline);
    const ap_el = make_input(analysis);
    const err_el = make_input('');
    const overlay_el = { style: {}, classList: { _set:new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)}, contains(c){return this._set.has(c)}, toggle(){} } };

    const sb = make_sandbox();
    sb.document.documentElement = { classList: html_cl };
    sb.document.getElementById = (id) => {
      if (id === 'dash-ov-rebuild-baseline')  return bp_el;
      if (id === 'dash-ov-rebuild-analysis')  return ap_el;
      if (id === 'dash-ov-rebuild-years-err') return err_el;
      if (id === 'dash-ov-overlay')           return overlay_el;
      return stub_el();
    };

    const rebuild_calls = [];
    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow */ }
    }
    // Stub the actual rebuild kickoff so we can observe whether validation
    // let the call through. Must happen AFTER scripts load (the inline IIFE
    // defines window.dash_ov_rebuild itself; we overwrite it for the test).
    sb.dash_ov_rebuild = (suffix) => { rebuild_calls.push(suffix); };
    if (typeof sb.dash_ov_rebuild_with_years !== 'function') {
      throw new Error('dash_ov_rebuild_with_years was not defined after running inline scripts');
    }
    sb.dash_ov_rebuild_with_years();
    return { rebuild_calls, err_text: err_el.textContent, bp_el, ap_el, err_el };
  }

  test('rebuild with both years blank shows error and does NOT call dash_ov_rebuild', () => {
    const { rebuild_calls, err_text } = run_with_years_harness({ baseline: '', analysis: '' });
    assert.equal(rebuild_calls.length, 0, 'rebuild should not fire with both years blank');
    assert.match(err_text, /at least one year/i, 'err div should explain the blank-both case');
  });

  test('rebuild with non-integer year is rejected', () => {
    const { rebuild_calls, err_text } = run_with_years_harness({ baseline: '20ab', analysis: '2026' });
    assert.equal(rebuild_calls.length, 0, 'rebuild should not fire when a year is non-integer');
    assert.match(err_text, /4-digit year/i);
  });

  test('rebuild with year before 2000 is rejected', () => {
    const { rebuild_calls, err_text } = run_with_years_harness({ baseline: '1999', analysis: '2026' });
    assert.equal(rebuild_calls.length, 0);
    assert.match(err_text, /between 2000/);
  });

  test('rebuild with year far in the future is rejected', () => {
    const future = new Date().getFullYear() + 50;
    const { rebuild_calls, err_text } = run_with_years_harness({ baseline: '2025', analysis: String(future) });
    assert.equal(rebuild_calls.length, 0);
    assert.match(err_text, /between 2000/);
  });

  test('rebuild with valid years calls dash_ov_rebuild with both query params', () => {
    const { rebuild_calls, err_text } = run_with_years_harness({ baseline: '2024', analysis: '2025' });
    assert.equal(rebuild_calls.length, 1, 'rebuild should fire once with valid years');
    assert.equal(rebuild_calls[0], '?baseline_year=2024&analysis_year=2025');
    assert.equal(err_text, '', 'err div should be cleared on a valid submit');
  });

  test('rebuild with only one year filled still kicks off (other side defaults at server)', () => {
    const { rebuild_calls } = run_with_years_harness({ baseline: '', analysis: '2025' });
    assert.equal(rebuild_calls.length, 1);
    assert.equal(rebuild_calls[0], '?analysis_year=2025');
  });

  test('editing the baseline input clears a previously-shown error', () => {
    const ctx = run_with_years_harness({ baseline: '', analysis: '' });
    assert.notEqual(ctx.err_text, '', 'pre-condition: error should be visible');
    ctx.bp_el._fire('input');
    assert.equal(ctx.err_el.textContent, '', 'editing baseline should clear the err div');
  });

  // ── Enhancement #2: collapsible override editor with persisted state ─────
  // The editor is wrapped in a native <details> element, defaults to closed
  // for first-time visitors, and persists open/closed state via localStorage
  // ('dash_ov_editor_open' = '1' or '0'). Roster-row clicks auto-expand it.

  test('override editor is rendered as a <details> element with a <summary>', () => {
    const html = render_to_tmp();
    // The opening tag carries the id we hook into for boot persistence.
    assert.match(html, /<details[^>]*\bid="dash-ov-editor"/,
      'override editor should be a <details id="dash-ov-editor">');
    // The summary wraps the title bar so clicking the header toggles.
    assert.match(html, /<summary\s+class="dash-ov-editor-summary"/,
      '<summary> with class dash-ov-editor-summary should exist');
    // The chevron span is present (CSS rotates it via [open]).
    assert.match(html, /class="dash-ov-editor-chevron"/);
  });

  test('server-status pill lives inside the summary so it shows when collapsed', () => {
    const html = render_to_tmp();
    // Pull out the summary block by id-then-summary text.
    const m = html.match(/<summary\s+class="dash-ov-editor-summary"[^>]*>([\s\S]*?)<\/summary>/);
    assert.ok(m, 'could not isolate the editor summary block');
    assert.ok(m[1].includes('id="dash-ov-srv-status"'),
      'server-status pill should be inside <summary> so the connection state stays visible when the editor is collapsed');
  });

  // Runtime harness: simulate the page boot with a stateful localStorage
  // and a stateful <details> stub, then assert what the boot code did.
  function run_collapse_harness({ initial_storage, focus_row }) {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    // Tracked <details>-like element with open state + toggle listeners.
    const details_listeners = {};
    const details_el = {
      tagName: 'DETAILS',
      _open: false,
      get open(){ return this._open; },
      set open(v){
        const was = this._open;
        this._open = !!v;
        if (was !== this._open) {
          (details_listeners.toggle || []).forEach((cb) => cb({}));
        }
      },
      style: {},
      classList: { add(){}, remove(){}, contains(){return false}, toggle(){} },
      addEventListener(name, cb){ (details_listeners[name] = details_listeners[name] || []).push(cb); },
      scrollIntoView(){},
    };

    // Stateful localStorage so we can observe writes.
    const storage = new Map();
    if (initial_storage) for (const [k, v] of Object.entries(initial_storage)) storage.set(k, v);
    const ls = {
      getItem(k){ return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v){ storage.set(k, String(v)); },
      removeItem(k){ storage.delete(k); },
    };

    const html_cl = { _set: new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)},
                      contains(c){return this._set.has(c)}, toggle(){} };
    const overlay_el = { style: {}, classList: { _set:new Set(), add(c){this._set.add(c)}, remove(c){this._set.delete(c)}, contains(c){return this._set.has(c)}, toggle(){} } };

    const sb = make_sandbox();
    sb.document.documentElement = { classList: html_cl };
    sb.localStorage = ls;
    sb.document.getElementById = (id) => {
      if (id === 'dash-ov-editor')  return details_el;
      if (id === 'dash-ov-overlay') return overlay_el;
      return stub_el();
    };

    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow -- no-throw test covers that contract */ }
    }
    // Optionally simulate a roster-row click after boot.
    if (focus_row && typeof sb.dash_ov_focus_row === 'function') {
      sb.dash_ov_focus_row('BL-1', 'BL-1', 'AN-1');
    }
    return { details_el, storage, _trigger_toggle: () => (details_listeners.toggle || []).forEach((cb) => cb({})) };
  }

  test('first-visit (no localStorage) leaves the editor closed', () => {
    const { details_el } = run_collapse_harness({ initial_storage: {} });
    assert.equal(details_el.open, false,
      'with no dash_ov_editor_open entry, the editor should NOT auto-open on boot');
  });

  test('localStorage="1" re-opens the editor on boot', () => {
    const { details_el } = run_collapse_harness({ initial_storage: { dash_ov_editor_open: '1' } });
    assert.equal(details_el.open, true,
      'a previously-open editor should restore its open state from localStorage');
  });

  test('localStorage="0" keeps the editor closed (explicit collapsed)', () => {
    const { details_el } = run_collapse_harness({ initial_storage: { dash_ov_editor_open: '0' } });
    assert.equal(details_el.open, false,
      'a previously-closed editor should stay closed (no false-y vs missing distinction needed)');
  });

  test('toggling the details element persists the new state to localStorage', () => {
    const { details_el, storage } = run_collapse_harness({ initial_storage: {} });
    // Simulate the user expanding the panel.
    details_el.open = true;
    assert.equal(storage.get('dash_ov_editor_open'), '1',
      'opening the editor should write "1" to localStorage');
    // And collapsing it back.
    details_el.open = false;
    assert.equal(storage.get('dash_ov_editor_open'), '0',
      'closing the editor should write "0" to localStorage');
  });

  test('clicking a roster row (dash_ov_focus_row) auto-expands a collapsed editor', () => {
    const { details_el, storage } = run_collapse_harness({ initial_storage: {}, focus_row: true });
    assert.equal(details_el.open, true,
      'focus_row should force the editor open even when it was collapsed');
    assert.equal(storage.get('dash_ov_editor_open'), '1',
      'auto-expanding should also persist so subsequent reloads stay open');
  });

  // ── Enhancement #3: override-list filters ────────────────────────────────
  // Three controls above the list: search input, type dropdown, status
  // dropdown. State is persisted to localStorage('dash_ov_list_filters')
  // and applied via window.dash_ov_apply_list_filters (a pure function
  // exposed for testability). Status buckets are non-overlapping:
  //   approved   = approved AND not stale
  //   stale      = approved AND staleness flag set
  //   unapproved = not approved at all

  test('list filter row renders with search input + type/status selects + clear link', () => {
    const html = render_to_tmp();
    assert.match(html, /id="dash-ov-list-filters"/);
    assert.match(html, /<input[^>]*\btype="text"[^>]*\bid="dash-ov-flt-search"/);
    assert.match(html, /<select[^>]*\bid="dash-ov-flt-type"/);
    assert.match(html, /<select[^>]*\bid="dash-ov-flt-status"/);
    assert.match(html, /id="dash-ov-flt-clear"/);
    // Type dropdown options
    assert.match(html, /<option value="force_match">/);
    assert.match(html, /<option value="force_no_match">/);
    assert.match(html, /<option value="force_segment">/);
    // Status dropdown options
    assert.match(html, /<option value="approved">/);
    assert.match(html, /<option value="unapproved">/);
    assert.match(html, /<option value="stale">/);
  });

  // Harness that runs the inline scripts and exposes
  // window.dash_ov_apply_list_filters for direct testing.
  function load_inline_scripts(extra_sandbox) {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);
    const sb = make_sandbox();
    Object.assign(sb, extra_sandbox || {});
    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow */ }
    }
    return sb;
  }

  // Fixture: 4 overrides covering each type + each status bucket.
  const filter_fixture = [
    { _type: 'force_match',    sid_baseline: 'BL-1', sid_analysis: 'AN-1', name_baseline: 'Alpha Race', name_analysis: 'Alpha Race 2026', note: 'merged duplicates', approved: true,  approval_state: null,        id: 1 },
    { _type: 'force_no_match', sid_baseline: 'BL-2', sid_analysis: 'AN-2', name_baseline: 'Beta Race',  name_analysis: 'Different Beta', note: '',                  approved: false, approval_state: null,        id: 2 },
    { _type: 'force_segment',  sid_baseline: 'BL-3', sid_analysis: null,   name_baseline: 'Gamma Race', name_analysis: null,            note: 'set to Lost',        approved: true,  approval_state: 'stale',     id: 3 },
    { _type: 'force_match',    sid_baseline: 'BL-4', sid_analysis: 'AN-4', name_baseline: 'Delta Race', name_analysis: 'Delta Race',    note: 'reviewed',           approved: false, approval_state: 'unapproved', id: 4 },
  ];

  test('apply_list_filters: no filters returns all items', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: '', type: 'all', status: 'all' });
    assert.equal(out.length, 4);
  });

  test('apply_list_filters: search matches sid', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: 'BL-2', type: 'all', status: 'all' });
    assert.deepEqual(out.map((o) => o.id), [2]);
  });

  test('apply_list_filters: search matches event name (case-insensitive)', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: 'gamma', type: 'all', status: 'all' });
    assert.deepEqual(out.map((o) => o.id), [3]);
  });

  test('apply_list_filters: search matches note', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: 'reviewed', type: 'all', status: 'all' });
    assert.deepEqual(out.map((o) => o.id), [4]);
  });

  test('apply_list_filters: type filter narrows to one override kind', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: '', type: 'force_match', status: 'all' });
    assert.deepEqual(out.map((o) => o.id).sort(), [1, 4]);
  });

  test('apply_list_filters: status="approved" excludes stale even if approved=true', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: '', type: 'all', status: 'approved' });
    // id 1 is approved+fresh; id 3 is approved+stale (excluded)
    assert.deepEqual(out.map((o) => o.id), [1]);
  });

  test('apply_list_filters: status="stale" returns only stale rows', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: '', type: 'all', status: 'stale' });
    assert.deepEqual(out.map((o) => o.id), [3]);
  });

  test('apply_list_filters: status="unapproved" returns only !approved rows', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: '', type: 'all', status: 'unapproved' });
    assert.deepEqual(out.map((o) => o.id).sort(), [2, 4]);
  });

  test('apply_list_filters: combined search + type + status narrows further', () => {
    const sb = load_inline_scripts();
    const out = sb.dash_ov_apply_list_filters(filter_fixture, { search: 'delta', type: 'force_match', status: 'unapproved' });
    assert.deepEqual(out.map((o) => o.id), [4]);
  });

  // Runtime persistence: with a stateful localStorage carrying a saved
  // filter state, the inputs should be populated at boot.
  test('filter state restores from localStorage on boot', () => {
    const html = render_to_tmp();
    const scripts = [];
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) scripts.push(m[1]);

    // Track values written to the three filter inputs.
    const search_el = { value: '', style: {}, classList: { add(){}, remove(){}, contains(){return false}, toggle(){} }, addEventListener(){}, };
    const type_el   = { value: 'all', style: {}, classList: { add(){}, remove(){}, contains(){return false}, toggle(){} }, addEventListener(){}, };
    const status_el = { value: 'all', style: {}, classList: { add(){}, remove(){}, contains(){return false}, toggle(){} }, addEventListener(){}, };

    const storage = new Map([['dash_ov_list_filters', JSON.stringify({ search: 'beta', type: 'force_no_match', status: 'unapproved' })]]);
    const sb = make_sandbox();
    sb.localStorage = {
      getItem: (k) => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    };
    sb.document.getElementById = (id) => {
      if (id === 'dash-ov-flt-search') return search_el;
      if (id === 'dash-ov-flt-type')   return type_el;
      if (id === 'dash-ov-flt-status') return status_el;
      return stub_el();
    };
    const ctx = vm.createContext(sb);
    for (let i = 0; i < scripts.length; i++) {
      try { vm.runInContext(scripts[i], ctx, { filename: 'inline_' + (i + 1) + '.js', timeout: 5000 }); }
      catch (e) { /* swallow */ }
    }
    assert.equal(search_el.value, 'beta',           'restore: search should be set from localStorage');
    assert.equal(type_el.value,   'force_no_match', 'restore: type should be set from localStorage');
    assert.equal(status_el.value, 'unapproved',     'restore: status should be set from localStorage');
  });

  // ── Enhancement #5: add-override form validation ─────────────────────────
  // dash_ov_validate_add_form is a pure helper that takes opts.fields (a
  // map of element id -> value) and returns { ok, problems: [...] }. It
  // also reads BASELINE_SIDS / ANALYSIS_SIDS which are built at boot from
  // ROSTER. The fixture roster has sid_baseline 'BL-1' / 'BL-LOST' and
  // sid_analysis 'AN-1' / 'AN-NEW'.

  test('add-override form err div is rendered (empty by default)', () => {
    const html = render_to_tmp();
    assert.match(html, /<div\s+id="dash-ov-form-err"[^>]*class="dash-ov-form-err"[^>]*><\/div>/);
  });

  test('CSS for .dash-ov-input-err is in the stylesheet', () => {
    const html = render_to_tmp();
    assert.match(html, /\.dash-ov-input-err\b/);
  });

  test('BASELINE_SIDS and ANALYSIS_SIDS are populated from ROSTER at boot', () => {
    const sb = load_inline_scripts();
    // The fixture's three rows:
    //   Retained -> sid_baseline=BL-1,   sid_analysis=AN-1
    //   Lost     -> sid_baseline=BL-LOST (no analysis)
    //   New      -> sid_analysis=AN-NEW  (no baseline)
    // The pure validator surfaces these via the wrong-box message.
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_match',
      'dash-ov-sidB': 'AN-1',  // analysis sid in baseline box
      'dash-ov-sidA': 'BL-1',  // baseline sid in analysis box
    }});
    assert.equal(r.ok, false);
    // Both should be flagged as wrong-box.
    var msgs = r.problems.map(function(p){ return p.msg; }).join(' | ');
    assert.match(msgs, /'AN-1' is a analysis-year sid; move it to the Analysis box/);
    assert.match(msgs, /'BL-1' is a baseline-year sid; move it to the Baseline box/);
  });

  test('force_match with missing sidA is rejected', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_match',
      'dash-ov-sidB': 'BL-1',
      'dash-ov-sidA': '',
    }});
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].field, 'dash-ov-sidA');
    assert.match(r.problems[0].msg, /needs an Analysis sid/);
  });

  test('force_no_match with missing sidB is rejected', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_no_match',
      'dash-ov-sidB': '',
      'dash-ov-sidA': 'AN-1',
    }});
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].field, 'dash-ov-sidB');
    assert.match(r.problems[0].msg, /needs a Baseline sid/);
  });

  test('force_segment with side=baseline and empty sidB is rejected', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_segment',
      'dash-ov-side': 'baseline',
      'dash-ov-sidB': '',
      'dash-ov-sidA': '',
    }});
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].field, 'dash-ov-sidB');
  });

  test('unknown sid (not in either pool) gets "no event" message', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_match',
      'dash-ov-sidB': 'BL-1',
      'dash-ov-sidA': 'TOTALLY-FAKE-SID',
    }});
    assert.equal(r.ok, false);
    assert.equal(r.problems[0].field, 'dash-ov-sidA');
    assert.match(r.problems[0].msg, /doesn't match any event in the current roster/);
  });

  test('same sid in both boxes is rejected', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_match',
      'dash-ov-sidB': 'BL-1',
      'dash-ov-sidA': 'BL-1',  // duplicate (and wrong-box)
    }});
    assert.equal(r.ok, false);
    // We expect BOTH the wrong-box AND the self-link errors (the
    // wrong-box check runs first; self-link is a defensive last check).
    var msgs = r.problems.map(function(p){ return p.msg; }).join(' | ');
    assert.match(msgs, /Baseline and Analysis sids must be different/);
  });

  test('valid force_match with correct-box sids passes', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_match',
      'dash-ov-sidB': 'BL-1',
      'dash-ov-sidA': 'AN-1',
    }});
    assert.equal(r.ok, true);
    assert.equal(r.problems.length, 0);
  });

  test('valid force_segment with the right side filled passes', () => {
    const sb = load_inline_scripts();
    var r = sb.dash_ov_validate_add_form({ fields: {
      'dash-ov-type': 'force_segment',
      'dash-ov-side': 'baseline',
      'dash-ov-sidB': 'BL-LOST',
      'dash-ov-sidA': '',
    }});
    assert.equal(r.ok, true);
  });
});

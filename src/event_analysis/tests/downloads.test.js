/**
 * downloads.test.js — Verifies the dashboard's Download buttons work.
 *
 * The dashboard has two Download buttons (Excel workbook + PowerPoint deck)
 * just above the glossary. They're plain <a href="./filename" download>
 * links, which means the file referenced has to actually exist in the same
 * directory as dashboard.html or the browser shows "file isn't available."
 *
 * This regressed once already: the template used hardcoded names
 * (`_v9f.xlsx` / `_v3.pptx`) that never matched the timestamped basenames
 * build_all.js writes (`<year>_event_calendar_analysis_<BUILD_TS>.xlsx`).
 * Every download attempt 404'd silently. Now the basenames come from
 * `results.downloads` populated by build_all.js — this suite makes sure
 * that contract holds.
 *
 * Specifically asserts:
 *   1. Both Download <a> tags exist in dashboard.html.
 *   2. Each href is a same-directory path (starts with `./`), not absolute.
 *   3. The xlsx href points at a real .xlsx in the output dir.
 *   4. The pptx href points at a real .pptx in the output dir.
 *   5. The hrefs aren't the hardcoded `_v9f` / `_v3` legacy names — those
 *      should never reappear; if they do, the template regressed.
 *
 * Lives in its own file so a future "rename the Excel filename pattern"
 * tweak fails here loudly, separate from the editor / SSE / glossary
 * suites. Run via menu option 27 or `node --test tests/downloads.test.js`.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const path = require('path');

// ── Locate output dir + most recent build's dashboard.html ────────────────

async function find_output_dir() {
  if (process.env.EVENT_ANALYSIS_OUTPUT_DIR) return process.env.EVENT_ANALYSIS_OUTPUT_DIR;
  try {
    const p = await require('../../../utilities/determineOSPath').determineOSPath();
    return path.join(p, 'usat_event_analysis_output');
  } catch {
    return null;
  }
}

async function find_dashboard_html() {
  const out_dir = await find_output_dir();
  if (!out_dir) return { fp: null, out_dir: null };
  const fp = path.join(out_dir, 'dashboard.html');
  return fs.existsSync(fp) ? { fp, out_dir } : { fp: null, out_dir };
}

// Pull the two Download button <a> tags out of the HTML. We match the
// emoji label so we don't accidentally grab some other anchor.
function extract_download_links(html) {
  // Anchor with download attribute, optional attributes between href and
  // closing > so the matcher tolerates inline styles or class names being
  // added in the future.
  const link_re = /<a\s+href="([^"]+)"\s+download[^>]*>[\s\S]*?<\/a>/g;
  const found = { xlsx: null, pptx: null };
  let m;
  while ((m = link_re.exec(html)) !== null) {
    const href = m[1];
    const tag  = m[0];
    if (/📊|Excel Workbook/.test(tag) || /\.xlsx(\b|"|$)/.test(href)) {
      found.xlsx = href;
    } else if (/📑|PowerPoint Deck/.test(tag) || /\.pptx(\b|"|$)/.test(href)) {
      found.pptx = href;
    }
  }
  return found;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('dashboard downloads — link structure', () => {

  test('dashboard.html exposes Excel + PowerPoint download links', async (t) => {
    const { fp } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const links = extract_download_links(html);
    assert.ok(links.xlsx, 'Excel download <a href> not found');
    assert.ok(links.pptx, 'PowerPoint download <a href> not found');
  });

  test('download hrefs are relative (./filename), not absolute', async (t) => {
    const { fp } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const links = extract_download_links(html);
    for (const [kind, href] of Object.entries(links)) {
      if (!href) continue;
      assert.match(href, /^\.\//,
        `${kind} href "${href}" should start with "./" so it resolves next to dashboard.html`);
      assert.doesNotMatch(href, /^https?:\/\//,
        `${kind} href "${href}" should not be an absolute URL`);
      assert.doesNotMatch(href, /^\/\//,
        `${kind} href "${href}" should not be a protocol-relative URL`);
    }
  });

  test('legacy hardcoded download names never reappear', async (t) => {
    // These names ARE the bug we already shipped a fix for. If anyone
    // re-introduces them, this test catches it before a user notices.
    const { fp } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    assert.doesNotMatch(html, /event_calendar_analysis_v9f\.xlsx/,
      'legacy hardcoded "_v9f.xlsx" filename should NOT be in the dashboard');
    assert.doesNotMatch(html, /event_trends_summary_v3\.pptx/,
      'legacy hardcoded "_v3.pptx" filename should NOT be in the dashboard');
  });
});

describe('dashboard downloads — referenced files exist on disk', () => {

  test('Excel download href resolves to a real .xlsx file', async (t) => {
    const { fp, out_dir } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const { xlsx: href } = extract_download_links(html);
    if (!href) { t.skip('Excel link missing — see other test'); return; }

    // Strip leading ./ — resolves next to dashboard.html (== output dir).
    const basename = href.replace(/^\.\//, '');
    assert.match(basename, /\.xlsx$/, `Excel href should end in .xlsx, got "${basename}"`);

    const target = path.join(out_dir, basename);
    assert.ok(fs.existsSync(target),
      `Excel download target "${basename}" does not exist in ${out_dir} — Download button would 404`);
  });

  test('PowerPoint download href resolves to a real .pptx file', async (t) => {
    const { fp, out_dir } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const { pptx: href } = extract_download_links(html);
    if (!href) { t.skip('PowerPoint link missing — see other test'); return; }

    const basename = href.replace(/^\.\//, '');
    assert.match(basename, /\.pptx$/, `PowerPoint href should end in .pptx, got "${basename}"`);

    const target = path.join(out_dir, basename);
    assert.ok(fs.existsSync(target),
      `PowerPoint download target "${basename}" does not exist in ${out_dir} — Download button would 404`);
  });

  test('Excel target matches the expected naming pattern <year>_event_calendar_analysis_*.xlsx', async (t) => {
    // Sanity: the filename we ship in the dashboard should follow the same
    // convention build_all.js uses. If someone changes one but not the
    // other, the download might work today and 404 tomorrow after the
    // next build rotates the file.
    const { fp } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const { xlsx: href } = extract_download_links(html);
    if (!href) { t.skip('Excel link missing — see other test'); return; }
    const basename = href.replace(/^\.\//, '');

    assert.match(basename, /^\d{4}_event_calendar_analysis_.+\.xlsx$/,
      `Excel basename "${basename}" should match <year>_event_calendar_analysis_<suffix>.xlsx`);
  });

  test('PowerPoint target matches the expected naming pattern <year>_event_trends_summary_*.pptx', async (t) => {
    const { fp } = await find_dashboard_html();
    if (!fp) { t.skip('no dashboard.html found — run node build_all.js first'); return; }
    const html = fs.readFileSync(fp, 'utf8');

    const { pptx: href } = extract_download_links(html);
    if (!href) { t.skip('PowerPoint link missing — see other test'); return; }
    const basename = href.replace(/^\.\//, '');

    assert.match(basename, /^\d{4}_event_trends_summary_.+\.pptx$/,
      `PowerPoint basename "${basename}" should match <year>_event_trends_summary_<suffix>.pptx`);
  });
});

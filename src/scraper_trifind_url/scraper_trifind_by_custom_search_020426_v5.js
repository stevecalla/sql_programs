// scraper_trifind_custom_search_enriched_exceljs_v3_loopfix.js
// npm i axios cheerio exceljs

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

// -------------------------------
// SAFETY / TEST KNOBS
// -------------------------------
const TEST_MODE = true;
const TEST_MAX_PAGES = 2;

// hard cap for full runs (absolute safety)
const MAX_PAGES_FULL = 800;

// HTTP
const LISTING_HTTP_TIMEOUT_MS = 20000;
const DETAIL_HTTP_TIMEOUT_MS = 25000;

// politeness + concurrency
const POLITE_DELAY_MS = 650;
const DETAIL_CONCURRENCY = 6;
const DETAIL_RETRIES = 3;
const DETAIL_RETRY_BACKOFF_MS = 700;

// You asked: eliminate sanctioned event from the 1st pass
const SKIP_LISTING_USAT_CHECK = true; // (kept for clarity; listing no longer computes it anyway)

// -------------------------------
// DATE RANGE SETTINGS
// -------------------------------
const SCRAPE_YEAR = 2026; // change to 2025, 2027, etc
const MONTH_START = 1;
const MONTH_END = 12;

// 🔧 NEW: Prefer the site's "start_date/end_date" search (matches pagination HTML)
const START_DATE = `${SCRAPE_YEAR}-01-01`;
const END_DATE = `${SCRAPE_YEAR}-12-31`;

// -------------------------------
// OUTPUT SETTINGS
// -------------------------------
const BASE_URL = "https://www.trifind.com/";
const output_directory = "output/events/";
const output_stem = `trifind_custom_search_${SCRAPE_YEAR}`;

// CSV
const csv_base_path = path.join(output_directory, `${output_stem}_base_v4.csv`);
const csv_enriched_path = path.join(output_directory, `${output_stem}_enriched_v4.csv`);

// XLSX
const xlsx_base_path = path.join(output_directory, `${output_stem}_base_v4.xlsx`);
const xlsx_enriched_path = path.join(output_directory, `${output_stem}_enriched_v4.xlsx`);

// -------------------------------
// SPORT MAP
// -------------------------------
// { query: "sport_ids%5B%5D=2", sport: "Aquabike" }, = 461
// { query: "sport_ids%5B%5D=3", sport: "Aquathlon" }, = 90
// { query: "sport_ids%5B%5D=4", sport: "Cycling" }, = 55
// { query: "sport_ids%5B%5D=5", sport: "Duathlon" },= 486
// { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" }, = 5
// { query: "sport_ids%5B%5D=8", sport: "Running" }, = 9,255
// { query: "sport_ids%5B%5D=9", sport: "Swimming" },= 37
// { query: "sport_ids%5B0%5D=10", sport: "Triathlon" },= 1,408
// { query: "sport_ids%5B%5D=12", sport: "Multisport" }, = 16
const is_test = true;
const sport_map = is_test
  ? [
    { query: "sport_ids%5B%5D=10", sport: "Triathlon" },
    // { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" },
    // { query: "sport_ids%5B%5D=2", sport: "Aquabike" },
  ]
  : [
    { query: "sport_ids%5B%5D=2", sport: "Aquabike" }, { query: "sport_ids%5B%5D=3", sport: "Aquathlon" }, { query: "sport_ids%5B%5D=4", sport: "Cycling" }, { query: "sport_ids%5B%5D=5", sport: "Duathlon" }, { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" }, { query: "sport_ids%5B%5D=9", sport: "Swimming" }, { query: "sport_ids%5B%5D=12", sport: "Multisport" },

    { query: "sport_ids%5B%5D=10", sport: "Triathlon" },
    { query: "sport_ids%5B%5D=8", sport: "Running" },
  ];

// -------------------------------
// HELPERS
// -------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ensure_dir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function csv_escape(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function normalize_href(href) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${BASE_URL.replace(/\/$/, "")}${href}`;
  return `${BASE_URL.replace(/\/$/, "")}/${href}`;
}

function safe_text($el) {
  return ($el?.text?.() ?? "").trim().replace(/\s+/g, " ");
}

function parse_canceled_flag(title) {
  const t = String(title || "").toLowerCase();
  return t.includes("canceled") || t.includes("cancelled") ? "Yes" : "No";
}

function parse_event_year_month(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return { event_year: null, event_month: null };

  const yMatch = s.match(/\b(19|20)\d{2}\b/);
  const event_year = yMatch ? Number(yMatch[0]) : null;

  const months = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  const lower = s.toLowerCase();
  let event_month = null;
  for (const [name, num] of Object.entries(months)) {
    if (lower.includes(name)) {
      event_month = num;
      break;
    }
  }

  return { event_year: event_year ?? null, event_month: event_month ?? null };
}

function extract_usat_sanction_number_from_url(url) {
  const u = String(url || "");
  let m = u.match(/\/events\/(\d+)/i);
  if (m) return m[1];
  m = u.match(/ViewEvent\/(\d+)/i);
  if (m) return m[1];
  return null;
}

async function http_get_with_retries(url, { timeout_ms, headers }, retries) {
  let attempt = 0;
  while (true) {
    try {
      const resp = await axios.get(url, {
        headers,
        timeout: timeout_ms,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      return resp.data;
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      await delay(DETAIL_RETRY_BACKOFF_MS * attempt);
    }
  }
}

// Parse detail page: register now url, visit site, usat link, sanction id, prev results count
function parse_detail_page(html) {
  const $ = cheerio.load(html);

  let register_now_url = null;
  let visit_race_website_url = null;

  // 🔧 CHANGE: sanctioned fields are ONLY captured when associated with:
  // <p>-:- <a href="https://member.usatriathlon.org/events/32904" ...>USAT Officiated</a></p>
  let usat_link = null;
  let usat_link_text = null;

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const text = safe_text($a).toLowerCase();
    const raw_href = $a.attr("href");
    const href = normalize_href(raw_href);

    if (!href) return;

    // Looser (more reliable) matching for these buttons/links
    if (!register_now_url && text.includes("register now")) register_now_url = href;

    if (
      !visit_race_website_url &&
      (text.includes("visit race website") || text.includes("visit website"))
    ) {
      visit_race_website_url = href;
    }

    // NOTE: do NOT set usat_link here anymore; we only set it from the specific "-:-" <p> element pattern.
  });

  // 🔧 NEW: USAT sanctioned detection ONLY from <p> elements that contain "-:-" and an <a> to USAT.
  // Example: <p>-:- <a href="https://member.usatriathlon.org/events/32904" target="_blank">USAT Officiated</a></p>
  $("p").each((_, p) => {
    if (usat_link) return; // take first match only
    const $p = $(p);
    const p_text = safe_text($p);

    if (!p_text.includes("-:-")) return;

    const $a = $p.find("a[href]").first();
    if (!$a.length) return;

    const raw_href = $a.attr("href");
    const href_lower = String(raw_href || "").toLowerCase();

    if (
      href_lower.includes("usatriathlon.org") ||
      href_lower.includes("member.usatriathlon.org") ||
      href_lower.includes("rankings.usatriathlon.org")
    ) {
      usat_link = normalize_href(raw_href);
      usat_link_text = safe_text($a) || null; // e.g., "USAT Officiated" (varies)
    }
  });

  // Count "Previous Results" years by scanning strong tags like "2025 Results at:"
  let previous_results_count = 0;
  $("strong").each((_, st) => {
    const t = safe_text($(st));
    if (/\b(19|20)\d{2}\s+Results\b/i.test(t)) previous_results_count++;
  });

  const is_usat_sanctioned = usat_link ? "Yes" : "No";
  const usat_sanction_number = extract_usat_sanction_number_from_url(usat_link);

  return {
    register_now_url,
    visit_race_website_url,
    usat_link,
    usat_link_text, // 🔧 NEW
    usat_sanction_number,
    is_usat_sanctioned,
    previous_results_count,
  };
}

// Small concurrency runner
async function run_pool(items, concurrency, worker) {
  let i = 0;
  const running = new Set();

  async function launch_one() {
    if (i >= items.length) return;
    const item = items[i++];
    const p = (async () => worker(item))().finally(() => running.delete(p));
    running.add(p);
  }

  while (running.size < concurrency && i < items.length) {
    await launch_one();
  }

  while (running.size) {
    await Promise.race([...running]);
    while (running.size < concurrency && i < items.length) {
      await launch_one();
    }
  }
}

// ----------- PIVOT HELPERS (summary tables) -----------

// pivotMap: key -> count
// key is `${rowKey}||${yesNo}`
// returns rows: { row_key, yes, no, total }
function pivot_yes_no_table(pivotMap, rowKeyLabel = "row_key") {
  const agg = new Map(); // row_key -> { Yes, No }
  for (const [k, count] of Object.entries(pivotMap)) {
    const [row_key, yesno] = k.split("||");
    if (!agg.has(row_key)) agg.set(row_key, { Yes: 0, No: 0 });
    const obj = agg.get(row_key);
    if (yesno === "Yes") obj.Yes += count;
    else if (yesno === "No") obj.No += count;
  }

  const rows = [];
  for (const [row_key, v] of agg.entries()) {
    rows.push({
      [rowKeyLabel]: row_key,
      Yes: v.Yes,
      No: v.No,
      Total: v.Yes + v.No,
    });
  }

  rows.sort((a, b) => {
    const ta = b.Total - a.Total;
    if (ta !== 0) return ta;
    return String(a[rowKeyLabel]).localeCompare(String(b[rowKeyLabel]));
  });

  const totalYes = rows.reduce((s, r) => s + r.Yes, 0);
  const totalNo = rows.reduce((s, r) => s + r.No, 0);
  rows.push({
    [rowKeyLabel]: "ALL",
    Yes: totalYes,
    No: totalNo,
    Total: totalYes + totalNo,
  });

  return rows;
}

function safe_state_key(state) {
  const s = String(state || "").trim();
  return s ? s : "UNKNOWN";
}

// -------------------------------
// SEARCH URL BUILDER
// -------------------------------
function build_search_url({ query, page, sort, direction }) {
  // Keep this consistent with your working pattern
  // NOTE: include page explicitly (even page=1) to avoid backend weirdness
  return (
    `${BASE_URL}Races/CustomSearch?do=Search` +
    `&start_date=${encodeURIComponent(START_DATE)}` +
    `&end_date=${encodeURIComponent(END_DATE)}` +
    `&event=` +
    `&${query}` +
    `&search=go`
  );
}

// -------------------------------
// EVENTS FOUND + NEXT LINK HELPERS
// (pattern matches your earlier working version)
// -------------------------------
function parse_events_found($) {
  // Original working selector/pattern:
  // <div class="pagination-full"><span><b>1408 Events Found</b></span> ...
  const txt = $(".pagination-full span b").first().text().trim().replace(/\u00a0/g, " ");
  const m = txt.match(/(\d+)\s+Events\s+Found/i);
  return m ? parseInt(m[1], 10) : null;
}

// Optional: detect "Next" link presence (nice-to-have fallback when events_found is null)
function has_next_page($) {
  // try common patterns
  const nextA = $(".pagination-full ul.pagination li a")
    .filter((_, a) => String($(a).text() || "").trim().toLowerCase() === "next")
    .first();

  if (nextA.length) return true;

  // sometimes it's an icon or aria-label
  const nextAria = $('.pagination-full ul.pagination li a[aria-label="Next"]').first();
  if (nextAria.length) return true;

  // sometimes rel=next
  const relNext = $('a[rel="next"]').first();
  if (relNext.length) return true;

  return false;
}

// 🔧 NEW: actually follow the on-page "Next" href (instead of incrementing page=...)
// This is the "page forward pattern" you asked for.
function get_next_page_url($, current_url) {
  // try common patterns (same spirit as has_next_page, but returns href)
  let nextHref =
    $(".pagination-full ul.pagination li a")
      .filter((_, a) => String($(a).text() || "").trim().toLowerCase() === "next")
      .first()
      .attr("href") || null;

  if (!nextHref) {
    nextHref = $('.pagination-full ul.pagination li a[aria-label="Next"]').first().attr("href") || null;
  }

  if (!nextHref) {
    nextHref = $('a[rel="next"]').first().attr("href") || null;
  }

  const nextUrl = normalize_href(nextHref);

  // if it resolves to the same url, treat as no-next to avoid infinite loops
  if (nextUrl && current_url && String(nextUrl) === String(current_url)) return null;

  return nextUrl || null;
}

// -------------------------------
// LISTING SCRAPE (events_found-driven, follow Next href)
// -------------------------------
async function scrapeSport({
  query,
  sport,
  on_listing_event,
  enqueue_detail_task,
  seen_listing_urls_global,
}) {
  const MAX_PAGES = TEST_MODE ? TEST_MAX_PAGES : MAX_PAGES_FULL; // safety cap

  // -----------------------
  // Bootstrap page 1
  // -----------------------
  const first_url = build_search_url({
    query,
    page: 1,
    sort: "Race.date",
    direction: "ASC",
  });

  console.log(`Listing bootstrap: ${first_url}`);

  let first_html = null;
  try {
    first_html = String(
      (await http_get_with_retries(
        first_url,
        { timeout_ms: LISTING_HTTP_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } },
        2
      )) || ""
    );
  } catch (err) {
    console.log(`❌ Failed on page 1 for ${sport}:`, String(err?.message || err));
    return;
  }

  const $first = cheerio.load(first_html);

  const events_found_page1 = parse_events_found($first); // e.g. 1408
  const target_events = events_found_page1; // can be null if not found

  const panels_page1 = $first(".date-event-whole .panel.panel-info.clearfix");
  const per_page = panels_page1.length || null;

  console.log(
    `↳ ${sport}: events_found=${target_events ?? "unknown"} per_page=${per_page ?? "unknown"} (paginate until reached)`
  );

  // -----------------------
  // Crawl pages until:
  // - unique scraped >= target_events (when known)
  // - OR no panels / no progress / no Next
  // -----------------------
  const seen_event_keys = new Set(); // per-sport progress / stop condition
  let unique_rows_written = 0;

  // 🔧 NEW: follow next URL chain (instead of page++ building URLs)
  let page = 1; // keep for logs + TEST_MODE cap only
  let current_url = first_url;
  let current_html = first_html;

  // 🔧 NEW: loop breaker if pagination starts returning same next url repeatedly
  const seen_page_urls = new Set();
  seen_page_urls.add(String(current_url));

  while (page <= MAX_PAGES) {
    const $ = cheerio.load(current_html);

    // Update target from later pages too (sometimes page1 differs from later)
    const events_found_here = parse_events_found($);
    const effective_target =
      Number.isFinite(events_found_here) && events_found_here > 0
        ? events_found_here
        : target_events;

    const panels = $(".date-event-whole .panel.panel-info.clearfix");
    if (panels.length === 0) {
      console.log(`✅ No panels on page ${page}. Stopping.`);
      break;
    }

    let rows_on_page = 0;
    let new_unique_on_page = 0;

    panels.each((_, panel) => {
      const el = $(panel);

      const a = el.find(".panel-heading a[title][href]").first();
      const dateDiv = el.find(".panel-heading .text-md-right").first();
      const locB = el.find(".panel-body .location-text b").first();

      const title = a.length ? safe_text(a) : null;
      const race_url = a.length ? normalize_href(a.attr("href")) : null;
      const date = dateDiv.length ? safe_text(dateDiv) : null;

      let location = null;
      let city = null;
      let state = null;

      if (locB.length) {
        location = safe_text(locB);
        const parts = location.split(",").map((s) => s.trim());
        city = parts[0] || null;
        state = parts[1] || null;
      }

      if (!title && !race_url) return;

      const { event_year, event_month } = parse_event_year_month(date);
      const is_canceled = parse_canceled_flag(title);

      // ✅ de-dupe key so we can stop at exactly N unique
      // Prefer URL. Fallback to (title|date|location)
      const key =
        (race_url && `url:${race_url}`) ||
        `t:${title || ""}|d:${date || ""}|l:${location || ""}`;

      rows_on_page++;

      const is_duplicate = seen_event_keys.has(key);

      if (!is_duplicate) {
        seen_event_keys.add(key);
        new_unique_on_page++;
        unique_rows_written++;
      }

      // NOTE: we no longer "return" for duplicates.
      // We KEEP duplicates and simply flag them.
      const listing_event = {
        seq: null,
        title,
        url: race_url,
        date,
        event_year,
        event_month,
        city,
        state,
        location,
        race_type: sport,
        is_canceled,
        is_duplicate_listing: is_duplicate ? "Yes" : "No", // 🔧 NEW
      };

      on_listing_event(listing_event);
      enqueue_detail_task(listing_event);
    });

    console.log(
      `  ↳ page ${page} rows parsed: ${rows_on_page} (new unique: ${new_unique_on_page}) | total unique: ${unique_rows_written}${effective_target ? ` / ${effective_target}` : ""
      }`
    );

    // ✅ Stop when we've reached the site-reported count
    if (effective_target && unique_rows_written >= effective_target) {
      console.log(
        `✅ Reached target unique events (${unique_rows_written} >= ${effective_target}). Stopping.`
      );
      break;
    }

    // ✅ If no new unique rows, we’re likely looping or at the end
    if (new_unique_on_page === 0) {
      const nextExists = has_next_page($);
      if (!nextExists) {
        console.log(
          `✅ No new unique events on page ${page} and no Next link detected. Stopping.`
        );
        break;
      } else {
        console.log(
          `⚠️ No new unique events on page ${page}, but Next exists — continuing cautiously.`
        );
      }
    }

    // Respect test mode page cap
    if (TEST_MODE && page >= TEST_MAX_PAGES) {
      console.log(`🧪 TEST_MODE hit TEST_MAX_PAGES=${TEST_MAX_PAGES}. Stopping.`);
      break;
    }

    // -----------------------
    // 🔧 NEW: move forward using the on-page Next link
    // -----------------------
    const next_url = get_next_page_url($, current_url);

    if (!next_url) {
      console.log(`✅ No Next link URL found on page ${page}. Stopping.`);
      break;
    }

    if (seen_page_urls.has(String(next_url))) {
      console.log(`🛑 Next URL already seen (loop detected). Stopping. next_url=${next_url}`);
      break;
    }
    seen_page_urls.add(String(next_url));

    // fetch next page html
    console.log(`Listing page ${page + 1}: ${next_url}`);
    try {
      current_html = String(
        (await http_get_with_retries(
          next_url,
          { timeout_ms: LISTING_HTTP_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } },
          2
        )) || ""
      );
      current_url = next_url;
    } catch (err) {
      console.log(`❌ Failed to fetch Next page after page ${page} for ${sport}:`, String(err?.message || err));
      break;
    }

    page++;
    await delay(POLITE_DELAY_MS);
  }

  if (target_events != null) {
    console.log(
      `↳ ${sport}: site reported ${target_events} Events Found; scraped unique=${unique_rows_written}`
    );
  }
}

// -------------------------------
// ENTRY
// -------------------------------
(async () => {
  ensure_dir(output_directory);

  // -------------------------------
  // HEADERS
  // -------------------------------
  const base_headers = [
    "seq",
    "title",
    "url",
    "date",
    "event_year",
    "event_month",
    "city",
    "state",
    "location",
    "race_type",
    "is_canceled",
    "is_duplicate_listing", // 🔧 NEW
  ];

  const enriched_headers = [
    ...base_headers,
    "register_now_url",
    "visit_race_website_url",
    "usat_link",
    "usat_link_text", // 🔧 NEW
    "usat_sanction_number",
    "is_usat_sanctioned",
    "previous_results_count",
  ];

  // -------------------------------
  // CSV streams
  // -------------------------------
  const csv_base = fs.createWriteStream(csv_base_path, { flags: "w" });
  const csv_enriched = fs.createWriteStream(csv_enriched_path, { flags: "w" });
  csv_base.write(base_headers.join(",") + "\n");
  csv_enriched.write(enriched_headers.join(",") + "\n");

  function write_csv_row(stream, headers, obj) {
    const line = headers.map((h) => csv_escape(obj[h] ?? "")).join(",") + "\n";
    stream.write(line);
  }

  // -------------------------------
  // Base XLSX (listing-only)
  // -------------------------------
  const wb_base = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: xlsx_base_path,
    useStyles: false,
    useSharedStrings: false,
  });

  const ws_base_events = wb_base.addWorksheet("Events (Base)");
  ws_base_events.columns = base_headers.map((h) => ({ header: h, key: h, width: 22 }));

  // -------------------------------
  // Enriched XLSX
  // -------------------------------
  const wb_enriched = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: xlsx_enriched_path,
    useStyles: false,
    useSharedStrings: false,
  });

  const ws_enriched_events = wb_enriched.addWorksheet("Events (Enriched)");
  ws_enriched_events.columns = enriched_headers.map((h) => ({ header: h, key: h, width: 22 }));

  // PIVOT SHEETS (summary tables)
  const ws_pivot_event_type = wb_enriched.addWorksheet("Pivot - Type x USAT");
  ws_pivot_event_type.columns = [
    { header: "race_type", key: "race_type", width: 24 },
    { header: "Yes", key: "Yes", width: 10 },
    { header: "No", key: "No", width: 10 },
    { header: "Total", key: "Total", width: 12 },
  ];

  const ws_pivot_state = wb_enriched.addWorksheet("Pivot - State x USAT");
  ws_pivot_state.columns = [
    { header: "state", key: "state", width: 24 },
    { header: "Yes", key: "Yes", width: 10 },
    { header: "No", key: "No", width: 10 },
    { header: "Total", key: "Total", width: 12 },
  ];

  function write_xlsx_row(ws, headers, obj) {
    const row = {};
    for (const h of headers) row[h] = obj[h] ?? "";
    ws.addRow(row).commit(); // streaming commit per row (memory safe)
  }

  // -------------------------------
  // State / pivot maps
  // -------------------------------
  let seq = 0;
  const detail_tasks = [];

  // keyed by: `${race_type}||${Yes/No}`
  const pivot_type_usat = {};

  // keyed by: `${state}||${Yes/No}`
  const pivot_state_usat = {};

  function inc(map, rowKey, yesno) {
    const k = `${rowKey}||${yesno}`;
    map[k] = (map[k] || 0) + 1;
  }

  function enqueue_detail_task(listing_event) {
    detail_tasks.push(async () => {
      const url = listing_event.url;

      let extra;
      if (!url) {
        extra = {
          register_now_url: null,
          visit_race_website_url: null,
          usat_link: null,
          usat_link_text: null, // 🔧 NEW
          usat_sanction_number: null,
          is_usat_sanctioned: "No",
          previous_results_count: 0,
        };
      } else {
        try {
          const html = await http_get_with_retries(
            url,
            { timeout_ms: DETAIL_HTTP_TIMEOUT_MS, headers: { "User-Agent": "Mozilla/5.0" } },
            DETAIL_RETRIES
          );
          extra = parse_detail_page(html);
        } catch (err) {
          console.warn(`⚠️ Detail fetch failed: ${url} -> ${String(err.message || err)}`);
          extra = {
            register_now_url: null,
            visit_race_website_url: null,
            usat_link: null,
            usat_link_text: null, // 🔧 NEW
            usat_sanction_number: null,
            is_usat_sanctioned: "No",
            previous_results_count: 0,
          };
        }
      }

      const enriched = { ...listing_event, ...extra };

      // update pivots (this is the authoritative sanctioned flag)
      inc(pivot_type_usat, enriched.race_type || "UNKNOWN", enriched.is_usat_sanctioned || "No");
      inc(pivot_state_usat, safe_state_key(enriched.state), enriched.is_usat_sanctioned || "No");

      // write enriched outputs
      write_csv_row(csv_enriched, enriched_headers, enriched);
      write_xlsx_row(ws_enriched_events, enriched_headers, enriched);
    });
  }

  // -------------------------------
  // LISTING PASS (writes BASE outputs immediately)
  // -------------------------------
  const seen_listing_urls_global = new Set();

  for (const item of sport_map) {
    await scrapeSport({
      query: item.query,
      sport: item.sport,
      seen_listing_urls_global,

      on_listing_event: (ev) => {
        seq++;
        ev.seq = seq;

        // base outputs
        write_csv_row(csv_base, base_headers, ev);
        write_xlsx_row(ws_base_events, base_headers, ev);

        // we do NOT update sanctioned pivots here (per your request)
      },

      enqueue_detail_task,
    });
  }

  // Close base CSV
  await new Promise((resolve) => csv_base.end(resolve));

  ws_base_events.commit();
  await wb_base.commit();
  console.log(`\n✅ Base XLSX written: ${xlsx_base_path}`);

  // -------------------------------
  // DETAIL PASS (concurrent)
  // -------------------------------
  console.log(`\n🔁 Detail pass: ${detail_tasks.length} urls (concurrency=${DETAIL_CONCURRENCY})`);
  await run_pool(detail_tasks, DETAIL_CONCURRENCY, async (fn) => fn());

  // Close enriched CSV
  await new Promise((resolve) => csv_enriched.end(resolve));

  // -------------------------------
  // WRITE PIVOT SHEETS (summary tables)
  // -------------------------------
  const type_rows = pivot_yes_no_table(pivot_type_usat, "race_type");
  for (const r of type_rows) ws_pivot_event_type.addRow(r).commit();

  const state_rows = pivot_yes_no_table(pivot_state_usat, "state");
  for (const r of state_rows) ws_pivot_state.addRow(r).commit();

  // Commit enriched workbook
  ws_enriched_events.commit();
  ws_pivot_event_type.commit();
  ws_pivot_state.commit();
  await wb_enriched.commit();

  // -------------------------------
  // FINAL LOGS
  // -------------------------------
  const statSize = (p) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return -1;
    }
  };

  console.log("\n✅ DONE");
  console.log(`🧪 TEST_MODE: ${TEST_MODE} (TEST_MAX_PAGES=${TEST_MAX_PAGES})`);
  console.log(`✅ CSV base:      ${csv_base_path} (${statSize(csv_base_path)} bytes)`);
  console.log(`✅ XLSX base:     ${xlsx_base_path} (${statSize(xlsx_base_path)} bytes)`);
  console.log(`✅ CSV enriched:  ${csv_enriched_path} (${statSize(csv_enriched_path)} bytes)`);
  console.log(`✅ XLSX enriched: ${xlsx_enriched_path} (${statSize(xlsx_enriched_path)} bytes)`);
  console.log(`✅ Pivot sheets in enriched XLSX: "Pivot - Type x USAT", "Pivot - State x USAT"`);
})().catch((err) => {
  console.error("❌ Fatal:", err);
  process.exitCode = 1;
});

/**
 * step_1a_trifind_website_stream.js
 *
 * All Trifind-specific logic:
 * - website paging fetch
 * - listing parsing
 * - detail parsing
 * - async generator that yields DB-ready "wide" rows (streaming)
 *
 * Trifind Scrape Notes
 * --------------------
 * This scraper reads Trifind HTML pages directly.
 *
 * It intentionally preserves the raw scraped values for fields like:
 * - title
 * - event_date
 * - city / state / location
 * - URLs
 * - USAT detail fields
 *
 * For dates:
 * - The original listing event_date text is normalized to `YYYY-MM-DD` in `event_date`
 * - Helper fields `event_year` and `event_month` are derived best-effort
 *
 * IMPORTANT:
 * - No timezone conversion occurs in this file.
 * - No attempt is made to coerce Trifind listing dates into MySQL datetime.
 * - The values stored reflect the original website content plus helper fields.
 */

const cheerio = require("cheerio");

// -------------------------------
// DEFAULT CONFIG
// -------------------------------
const BASE_URL = "https://www.trifind.com/";

const DEFAULT_TEST_MODE = false;
const DEFAULT_TEST_MAX_PAGES = 2;

// hard cap for full runs
const MAX_PAGES_FULL = 800;

// HTTP
const LISTING_HTTP_TIMEOUT_MS = 20000;
const DETAIL_HTTP_TIMEOUT_MS = 25000;

// politeness + concurrency
const POLITE_DELAY_MS = 650;
const DETAIL_CONCURRENCY = 6;
const DETAIL_RETRIES = 3;
const DETAIL_RETRY_BACKOFF_MS = 700;

// -------------------------------
// DEFAULT SPORT MAP
// -------------------------------
// { query: "sport_ids%5B%5D=2", sport: "Aquabike" }, = 461
// { query: "sport_ids%5B%5D=3", sport: "Aquathlon" }, = 90
// { query: "sport_ids%5B%5D=4", sport: "Cycling" }, = 55
// { query: "sport_ids%5B%5D=5", sport: "Duathlon" }, = 486
// { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" }, = 5
// { query: "sport_ids%5B%5D=8", sport: "Running" }, = 9,255
// { query: "sport_ids%5B%5D=9", sport: "Swimming" }, = 37
// { query: "sport_ids%5B%5D=10", sport: "Triathlon" }, = 1,408
// { query: "sport_ids%5B%5D=12", sport: "Multisport" }, = 16
function get_default_sport_map(is_test = false) {
  return is_test
    ? [
        { query: "sport_ids%5B%5D=10", sport: "Triathlon" },
        // { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" },
        // { query: "sport_ids%5B%5D=2", sport: "Aquabike" },
      ]
    : [
        { query: "sport_ids%5B%5D=2", sport: "Aquabike" },
        { query: "sport_ids%5B%5D=3", sport: "Aquathlon" },
        { query: "sport_ids%5B%5D=4", sport: "Cycling" },
        { query: "sport_ids%5B%5D=5", sport: "Duathlon" },
        { query: "race_filter_ids%5B%5D=5", sport: "Hyrox" },
        { query: "sport_ids%5B%5D=9", sport: "Swimming" },
        { query: "sport_ids%5B%5D=12", sport: "Multisport" },
        { query: "sport_ids%5B%5D=10", sport: "Triathlon" },
        { query: "sport_ids%5B%5D=8", sport: "Running" },
      ];
}

// -------------------------------
// HELPERS
// -------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function as_string(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s ? s : null;
}

function safe_integer(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parse_trifind_event_date_to_mysql_date(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return null;

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

  const yMatch = lower.match(/\b(19|20)\d{2}\b/);
  const year = yMatch ? Number(yMatch[0]) : null;

  let month = null;
  for (const [name, num] of Object.entries(months)) {
    if (lower.includes(name)) {
      month = num;
      break;
    }
  }

  let day = null;

  const monthNamesPattern =
    "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec";

  const m1 = lower.match(new RegExp(`\\b(?:${monthNamesPattern})\\s+(\\d{1,2})(?:\\D|$)`));
  if (m1) {
    day = Number(m1[1]);
  }

  if (!day) {
    const m2 = lower.match(/^(\d{1,2})\D+(\d{1,2})\D+((?:19|20)\d{2})$/);
    if (m2) {
      const n1 = Number(m2[1]);
      const n2 = Number(m2[2]);

      if (!month && n1 >= 1 && n1 <= 12) month = n1;
      if (!day && n2 >= 1 && n2 <= 31) day = n2;
    }
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parse_event_year_month(dateStr) {
  const normalized_date = parse_trifind_event_date_to_mysql_date(dateStr);
  if (!normalized_date) return { event_year: null, event_month: null };

  const m = normalized_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { event_year: null, event_month: null };

  return {
    event_year: Number(m[1]),
    event_month: Number(m[2]),
  };
}

function extract_usat_sanction_number_from_url(url) {
  const u = String(url || "");
  let m = u.match(/\/events\/(\d+)/i);
  if (m) return m[1];
  m = u.match(/ViewEvent\/(\d+)/i);
  if (m) return m[1];
  return null;
}

async function fetch_with_timeout(url, { timeout_ms, headers }) {
  const controller = new AbortController();
  const timeout_id = setTimeout(() => controller.abort(), timeout_ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!res.ok || res.status >= 400) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 500)}` : ""}`
      );
      err.status = res.status;
      throw err;
    }

    return await res.text();
  } finally {
    clearTimeout(timeout_id);
  }
}

async function http_get_with_retries(url, { timeout_ms, headers }, retries) {
  let attempt = 0;

  while (true) {
    try {
      return await fetch_with_timeout(url, { timeout_ms, headers });
    } catch (err) {
      attempt++;
      if (attempt > retries) throw err;
      await delay(DETAIL_RETRY_BACKOFF_MS * attempt);
    }
  }
}

// -------------------------------
// DETAIL PARSE
// -------------------------------
function parse_detail_page(html) {
  const $ = cheerio.load(html);

  let register_now_url = null;
  let visit_race_website_url = null;
  let usat_link = null;
  let usat_link_text = null;

  $("a[href]").each((_, a) => {
    const $a = $(a);
    const text = safe_text($a).toLowerCase();
    const raw_href = $a.attr("href");
    const href = normalize_href(raw_href);

    if (!href) return;

    if (!register_now_url && text.includes("register now")) {
      register_now_url = href;
    }

    if (
      !visit_race_website_url &&
      (text.includes("visit race website") || text.includes("visit website"))
    ) {
      visit_race_website_url = href;
    }
  });

  $("p").each((_, p) => {
    if (usat_link) return;

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
      usat_link_text = safe_text($a) || null;
    }
  });

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
    usat_link_text,
    usat_sanction_number,
    is_usat_sanctioned,
    previous_results_count,
  };
}

// -------------------------------
// SMALL CONCURRENCY RUNNER
// -------------------------------
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

// -------------------------------
// SEARCH URL BUILDER
// -------------------------------
function build_search_url({ start_date, end_date, query }) {
  return (
    `${BASE_URL}Races/CustomSearch?do=Search` +
    `&start_date=${encodeURIComponent(start_date)}` +
    `&end_date=${encodeURIComponent(end_date)}` +
    `&event=` +
    `&${query}` +
    `&search=go`
  );
}

// -------------------------------
// PAGINATION HELPERS
// -------------------------------
function parse_events_found($) {
  const txt = $(".pagination-full span b")
    .first()
    .text()
    .trim()
    .replace(/\u00a0/g, " ");

  const m = txt.match(/(\d+)\s+Events\s+Found/i);
  return m ? parseInt(m[1], 10) : null;
}

function has_next_page($) {
  const nextA = $(".pagination-full ul.pagination li a")
    .filter((_, a) => String($(a).text() || "").trim().toLowerCase() === "next")
    .first();

  if (nextA.length) return true;

  const nextAria = $('.pagination-full ul.pagination li a[aria-label="Next"]').first();
  if (nextAria.length) return true;

  const relNext = $('a[rel="next"]').first();
  if (relNext.length) return true;

  return false;
}

function get_next_page_url($, current_url) {
  let nextHref =
    $(".pagination-full ul.pagination li a")
      .filter((_, a) => String($(a).text() || "").trim().toLowerCase() === "next")
      .first()
      .attr("href") || null;

  if (!nextHref) {
    nextHref =
      $('.pagination-full ul.pagination li a[aria-label="Next"]').first().attr("href") ||
      null;
  }

  if (!nextHref) {
    nextHref = $('a[rel="next"]').first().attr("href") || null;
  }

  const nextUrl = normalize_href(nextHref);

  if (nextUrl && current_url && String(nextUrl) === String(current_url)) return null;

  return nextUrl || null;
}

// -------------------------------
// LISTING PARSE
// -------------------------------
function parse_listing_events_from_html({ html, sport, seen_event_keys }) {
  const $ = cheerio.load(html);
  const panels = $(".date-event-whole .panel.panel-info.clearfix");
  const listing_events = [];

  let rows_on_page = 0;
  let new_unique_on_page = 0;

  panels.each((_, panel) => {
    const el = $(panel);

    const a = el.find(".panel-heading a[title][href]").first();
    const dateDiv = el.find(".panel-heading .text-md-right").first();
    const locB = el.find(".panel-body .location-text b").first();

    const title = a.length ? safe_text(a) : null;
    const race_url = a.length ? normalize_href(a.attr("href")) : null;
    const raw_event_date = dateDiv.length ? safe_text(dateDiv) : null;
    const event_date = parse_trifind_event_date_to_mysql_date(raw_event_date);

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

    const { event_year, event_month } = parse_event_year_month(raw_event_date);
    const is_canceled = parse_canceled_flag(title);

    const key =
      (race_url && `url:${race_url}`) ||
      `t:${title || ""}|d:${raw_event_date || ""}|l:${location || ""}`;

    rows_on_page++;

    const is_duplicate = seen_event_keys.has(key);

    if (!is_duplicate) {
      seen_event_keys.add(key);
      new_unique_on_page++;
    }

    listing_events.push({
      seq: null,
      title: as_string(title),
      url: as_string(race_url),
      event_date: as_string(event_date),
      event_year: safe_integer(event_year),
      event_month: safe_integer(event_month),
      city: as_string(city),
      state: as_string(state),
      location: as_string(location),
      race_type: as_string(sport),
      is_canceled: as_string(is_canceled),
      is_duplicate_listing: is_duplicate ? "Yes" : "No",
    });
  });

  return {
    $,
    panels_count: panels.length,
    rows_on_page,
    new_unique_on_page,
    listing_events,
  };
}

async function enrich_listing_event(listing_event) {
  const url = listing_event.url;

  if (!url) {
    return {
      ...listing_event,
      register_now_url: null,
      visit_race_website_url: null,
      usat_link: null,
      usat_link_text: null,
      usat_sanction_number: null,
      is_usat_sanctioned: "No",
      previous_results_count: 0,
    };
  }

  try {
    const html = await http_get_with_retries(
      url,
      {
        timeout_ms: DETAIL_HTTP_TIMEOUT_MS,
        headers: { "User-Agent": "Mozilla/5.0" },
      },
      DETAIL_RETRIES
    );

    const extra = parse_detail_page(html);
    return { ...listing_event, ...extra };
  } catch (err) {
    console.warn(`⚠️ Detail fetch failed: ${url} -> ${String(err?.message || err)}`);
    return {
      ...listing_event,
      register_now_url: null,
      visit_race_website_url: null,
      usat_link: null,
      usat_link_text: null,
      usat_sanction_number: null,
      is_usat_sanctioned: "No",
      previous_results_count: 0,
    };
  }
}

/**
 * Async generator: yields DB-ready trifind rows.
 *
 * opts:
 *  - year
 *  - start_date
 *  - end_date
 *  - created_at_mtn
 *  - created_at_utc
 *  - test_mode
 *  - test_max_pages
 *  - is_test
 *  - sport_map
 *  - throttle_ms
 *  - detail_concurrency
 */
async function* generate_trifind_rows_streaming(opts) {
  const {
    year,
    start_date = `${year}-01-01`,
    end_date = `${year}-12-31`,
    created_at_mtn = null,
    created_at_utc = null,
    test_mode = DEFAULT_TEST_MODE,
    test_max_pages = DEFAULT_TEST_MAX_PAGES,
    is_test = false,
    sport_map = get_default_sport_map(is_test),
    throttle_ms = POLITE_DELAY_MS,
    detail_concurrency = DETAIL_CONCURRENCY,
  } = opts;

  const max_pages = test_mode ? test_max_pages : MAX_PAGES_FULL;

  let global_seq = 0;

  for (const item of sport_map) {
    const query = item.query;
    const sport = item.sport;

    const first_url = build_search_url({
      start_date,
      end_date,
      query,
    });

    console.log(`Listing bootstrap: ${first_url}`);

    let first_html = null;
    try {
      first_html = String(
        (await http_get_with_retries(
          first_url,
          {
            timeout_ms: LISTING_HTTP_TIMEOUT_MS,
            headers: { "User-Agent": "Mozilla/5.0" },
          },
          2
        )) || ""
      );
    } catch (err) {
      console.log(`❌ Failed on page 1 for ${sport}:`, String(err?.message || err));
      continue;
    }

    const $first = cheerio.load(first_html);
    const events_found_page1 = parse_events_found($first);
    const target_events = events_found_page1;

    const panels_page1 = $first(".date-event-whole .panel.panel-info.clearfix");
    const per_page = panels_page1.length || null;

    console.log(
      `↳ ${sport}: events_found=${target_events ?? "unknown"} per_page=${per_page ?? "unknown"} (paginate until reached)`
    );

    const seen_event_keys = new Set();
    let unique_rows_written = 0;

    let page = 1;
    let current_url = first_url;
    let current_html = first_html;

    const seen_page_urls = new Set();
    seen_page_urls.add(String(current_url));

    while (page <= max_pages) {
      const parsed = parse_listing_events_from_html({
        html: current_html,
        sport,
        seen_event_keys,
      });

      const $ = parsed.$;
      const panels_count = parsed.panels_count;
      const rows_on_page = parsed.rows_on_page;
      const new_unique_on_page = parsed.new_unique_on_page;
      const listing_events = parsed.listing_events;

      const events_found_here = parse_events_found($);
      const effective_target =
        Number.isFinite(events_found_here) && events_found_here > 0
          ? events_found_here
          : target_events;

      if (panels_count === 0) {
        console.log(`✅ No panels on page ${page}. Stopping.`);
        break;
      }

      unique_rows_written += new_unique_on_page;

      console.log(
        `  ↳ page ${page} rows parsed: ${rows_on_page} (new unique: ${new_unique_on_page}) | total unique: ${unique_rows_written}${effective_target ? ` / ${effective_target}` : ""}`
      );

      const enriched_results = new Array(listing_events.length);

      await run_pool(
        listing_events.map((ev, idx) => ({ ev, idx })),
        detail_concurrency,
        async ({ ev, idx }) => {
          const enriched = await enrich_listing_event(ev);
          enriched_results[idx] = enriched;
        }
      );

      for (const enriched of enriched_results) {
        global_seq++;

        yield {
          seq: global_seq,
          title: enriched?.title ?? null,
          url: enriched?.url ?? null,
          event_date: enriched?.event_date ?? null,
          event_year: safe_integer(enriched?.event_year),
          event_month: safe_integer(enriched?.event_month),
          city: enriched?.city ?? null,
          state: enriched?.state ?? null,
          location: enriched?.location ?? null,
          race_type: enriched?.race_type ?? null,
          is_canceled: enriched?.is_canceled ?? null,
          is_duplicate_listing: enriched?.is_duplicate_listing ?? null,

          register_now_url: enriched?.register_now_url ?? null,
          visit_race_website_url: enriched?.visit_race_website_url ?? null,
          usat_link: enriched?.usat_link ?? null,
          usat_link_text: enriched?.usat_link_text ?? null,
          usat_sanction_number: enriched?.usat_sanction_number ?? null,
          is_usat_sanctioned: enriched?.is_usat_sanctioned ?? "No",
          previous_results_count: safe_integer(enriched?.previous_results_count) ?? 0,

          created_at_mtn,
          created_at_utc,
        };
      }

      if (effective_target && unique_rows_written >= effective_target) {
        console.log(
          `✅ Reached target unique events (${unique_rows_written} >= ${effective_target}). Stopping.`
        );
        break;
      }

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

      if (test_mode && page >= test_max_pages) {
        console.log(`🧪 TEST_MODE hit TEST_MAX_PAGES=${test_max_pages}. Stopping.`);
        break;
      }

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

      console.log(`Listing page ${page + 1}: ${next_url}`);

      try {
        current_html = String(
          (await http_get_with_retries(
            next_url,
            {
              timeout_ms: LISTING_HTTP_TIMEOUT_MS,
              headers: { "User-Agent": "Mozilla/5.0" },
            },
            2
          )) || ""
        );
        current_url = next_url;
      } catch (err) {
        console.log(
          `❌ Failed to fetch Next page after page ${page} for ${sport}:`,
          String(err?.message || err)
        );
        break;
      }

      page++;
      await delay(throttle_ms);
    }

    if (target_events != null) {
      console.log(
        `↳ ${sport}: site reported ${target_events} Events Found; scraped unique=${unique_rows_written}`
      );
    }
  }
}

module.exports = {
  generate_trifind_rows_streaming,
  get_default_sport_map,

  as_string,
  safe_integer,
  normalize_href,
  safe_text,
  parse_canceled_flag,
  parse_trifind_event_date_to_mysql_date,
  parse_event_year_month,
  extract_usat_sanction_number_from_url,

  fetch_with_timeout,
  http_get_with_retries,

  parse_detail_page,
  parse_events_found,
  has_next_page,
  get_next_page_url,
  build_search_url,
  parse_listing_events_from_html,
  enrich_listing_event,
};
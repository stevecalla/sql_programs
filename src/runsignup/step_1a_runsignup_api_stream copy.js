/**
 * step_1a_runsignup_api_stream.js
 *
 * All RunSignup-specific logic:
 * - API paging fetch
 * - normalization helpers
 * - async generator that yields DB-ready "wide" rows (streaming)
 *
 * RunSignup Time Handling Notes
 * -----------------------------
 * According to the RunSignup API documentation:
 *
 * - Most date/time fields returned by the API are in **Eastern Time**.
 * - Some event-level fields (such as event start/end time) may be in the
 *   **timezone of the race itself**.
 *
 * Because of this, this script intentionally **does not perform timezone
 * conversion**. Instead it:
 *
 * - Preserves the **exact date/time values returned by the API**
 * - Only **normalizes formatting** to a consistent database format
 *
 * Date rules (normalized output):
 * - Date-only -> "YYYY-MM-DD"
 * - Date+time -> "YYYY-MM-DD HH:MM:SS"
 *
 * IMPORTANT:
 * - No timezone shifting occurs in this file.
 * - The values stored reflect the **original API-provided clock time**.
 * - Any timezone interpretation or conversion should occur downstream
 *   if needed.
 */

const API_BASE = "https://api.runsignup.com/rest/races";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function as_string(x) {
  if (x === null || x === undefined) return null;
  const s = String(x);
  return s.trim() ? s : null;
}

function as_bool_flag(x) {
  if (x === true || x === "T" || x === "true" || x === "True") return 1;
  if (x === false || x === "F" || x === "false" || x === "False") return 0;
  return null;
}

function safe_json(x) {
  try {
    return JSON.stringify(x ?? null);
  } catch {
    return null;
  }
}

function as_money_number(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;

  const s = String(x).trim();
  if (!s) return null;

  const cleaned = s
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function strip_html(x) {
  const s = as_string(x);
  if (!s) return null;

  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * --------
 * Date formatting helpers
 * --------
 *
 * These helpers normalize formatting only.
 *
 * They DO NOT convert timezone offsets or change the clock time.
 * They simply standardize the API-provided values into a consistent
 * database-friendly format.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Normalize date/datetime strings
 *
 * Behavior:
 * - If the value already looks like YYYY-MM-DD -> return as-is
 * - If it looks like YYYY-MM-DD HH:MM(:SS) -> normalize seconds
 * - Otherwise attempt Date parsing strictly to normalize formatting
 *
 * IMPORTANT:
 * - This function does NOT reinterpret the timezone.
 * - The clock time returned by RunSignup is preserved.
 */
function normalize_date_or_datetime(x) {
  const s0 = as_string(x);
  if (!s0) return null;

  const s = s0.trim();

  const m_date = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m_date) return `${m_date[1]}-${m_date[2]}-${m_date[3]}`;

  const m_dt = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (m_dt) {
    const yyyy = m_dt[1];
    const mm = m_dt[2];
    const dd = m_dt[3];
    const HH = pad2(m_dt[4]);
    const MM = m_dt[5];
    const SS = pad2(m_dt[6] ?? 0);
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const MM = pad2(d.getMinutes());
  const SS = pad2(d.getSeconds());

  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

function normalize_date_only(x) {
  const s = normalize_date_or_datetime(x);
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function normalize_datetime(x) {
  const s0 = as_string(x);
  if (!s0) return null;

  const s = normalize_date_or_datetime(s0);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;

  const d = new Date(s0);
  if (Number.isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const HH = pad2(d.getHours());
  const MM = pad2(d.getMinutes());
  const SS = pad2(d.getSeconds());

  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

function parse_date_to_month_year(date_str) {
  const s = normalize_date_or_datetime(date_str);
  if (!s) return { month: null, year: null };

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { month: null, year: null };

  const year = Number(m[1]);
  const month = Number(m[2]);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { month: null, year: null };
  }

  return { month, year };
}

/**
 * Address normalization
 *
 * These fields are passed through directly from the API.
 */
function normalize_address(race) {
  const addr = race?.address || null;
  return {
    address_street: as_string(addr?.street),
    address_street2: as_string(addr?.street2),
    address_city: as_string(addr?.city),
    address_state: as_string(addr?.state),
    address_zipcode: as_string(addr?.zipcode),
    address_country_code: as_string(addr?.country_code),
  };
}

function normalize_urls_and_social(race) {
  return {
    url: as_string(race?.url),
    external_race_url: as_string(race?.external_race_url),
    external_results_url: as_string(race?.external_results_url),
    fb_page_id: as_string(race?.fb_page_id),
    fb_event_id: as_string(race?.fb_event_id),
    logo_url: as_string(race?.logo_url),
  };
}

/**
 * Race-level dates
 *
 * These dates come directly from the RunSignup API.
 * They are normalized to consistent formatting but otherwise preserved.
 */
function normalize_race_dates(race) {
  const race_next_date = normalize_date_only(race?.next_date);
  const { month: race_month, year: race_year } = parse_date_to_month_year(
    race_next_date
  );

  return {
    race_last_date: normalize_date_only(race?.last_date),
    race_last_end_date: normalize_date_only(race?.last_end_date),
    race_next_date,
    race_next_end_date: normalize_date_only(race?.next_end_date),
    race_month,
    race_year,
  };
}

/**
 * Event-level dates
 *
 * These values are taken directly from the RunSignup API response.
 * Formatting is standardized but the clock time is preserved.
 */
function normalize_event_dates(ev) {
  const raw_start = ev?.start_time;
  const raw_end = ev?.end_time;
  const raw_reg_opens = ev?.registration_opens;

  const event_start_time = normalize_date_or_datetime(raw_start);
  const event_end_time = normalize_date_or_datetime(raw_end);
  const event_registration_opens = normalize_date_or_datetime(raw_reg_opens);

  const { month: event_month, year: event_year } = parse_date_to_month_year(
    event_start_time
  );

  const {
    month: event_registration_opens_month,
    year: event_registration_opens_year,
  } = parse_date_to_month_year(event_registration_opens);

  return {
    event_start_time,
    event_end_time,
    event_month,
    event_year,
    event_registration_opens,
    event_registration_opens_month,
    event_registration_opens_year,
  };
}

function extract_registration_period_summary(reg_periods) {
  const periods = Array.isArray(reg_periods) ? reg_periods : [];
  if (!periods.length) {
    return {
      event_registration_periods_json: "[]",
      event_race_fee: null,
      event_processing_fee: null,
      event_reg_opens: null,
      event_reg_closes: null,
    };
  }

  const p0 = periods[0] || {};

  const race_fee =
    p0?.race_fee ?? p0?.fee ?? p0?.base_fee ?? p0?.price ?? p0?.amount ?? null;

  const processing_fee =
    p0?.processing_fee ??
    p0?.proc_fee ??
    p0?.service_fee ??
    p0?.platform_fee ??
    null;

  const opens =
    p0?.registration_opens ??
    p0?.opens ??
    p0?.start_date ??
    p0?.start_time ??
    null;

  const closes =
    p0?.registration_closes ??
    p0?.closes ??
    p0?.end_date ??
    p0?.end_time ??
    null;

  return {
    event_registration_periods_json: safe_json(periods),
    event_race_fee: as_money_number(race_fee),
    event_processing_fee: as_money_number(processing_fee),
    event_reg_opens: normalize_date_or_datetime(opens),
    event_reg_closes: normalize_date_or_datetime(closes),
  };
}

async function fetch_races_page({
  page,
  results_per_page,
  start_date,
  end_date,
  api_key,
  api_secret,
}) {
  const start_date_norm = normalize_date_only(start_date);
  const end_date_norm = normalize_date_only(end_date);

  const params = new URLSearchParams({
    format: "json",
    events: "T",
    page: String(page),
    results_per_page: String(results_per_page),
    start_date: start_date_norm ?? String(start_date),
    end_date: end_date_norm ?? String(end_date),
  });

  if (api_key && api_secret) {
    params.set("api_key", api_key);
    params.set("api_secret", api_secret);
  }

  const url = `${API_BASE}?${params.toString()}`;

  console.log(`Fetching API page ${page}... ${url}`);

  const controller = new AbortController();
  const timeout_id = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
      );
      err.status = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clearTimeout(timeout_id);
  }
}

/**
 * Async generator: yields DB-ready "wide" rows.
 *
 * opts:
 *  - year
 *  - start_date, end_date
 *  - results_per_page
 *  - enable_race_only
 *  - api_key, api_secret
 */
async function* generate_runsignup_rows_streaming(opts) {
  const {
    year,
    start_date,
    end_date,
    results_per_page,
    enable_race_only,
    api_key,
    api_secret,
    throttle_ms = 200,
    created_at_mtn = null,
    created_at_utc = null,
  } = opts;

  const seen_race_ids = new Set();
  const seen_event_ids = new Set();

  let page = 1;
  let keep_going = true;

  let global_event_row_index = 0;
  let global_race_row_index = 0;

  while (keep_going) {
    const data = await fetch_races_page({
      page,
      results_per_page,
      start_date,
      end_date,
      api_key,
      api_secret,
    });

    const races = Array.isArray(data?.races) ? data.races : [];

    if (races.length === 0) {
      console.log(`↳ 0 races returned on page ${page}. stopping.`);
      break;
    }

    for (const item of races) {
      const race = item?.race || item;
      if (!race) continue;

      const race_id = race?.race_id ?? null;
      const race_name = as_string(race?.name);

      const addr = normalize_address(race);
      const urls = normalize_urls_and_social(race);
      const dates = normalize_race_dates(race);

      const race_base = {
        race_id,
        race_name,

        is_registration_open: as_bool_flag(race?.is_registration_open),
        is_private_race: as_bool_flag(race?.is_private_race),
        is_draft_race: as_bool_flag(race?.is_draft_race),

        created: normalize_date_or_datetime(race?.created),
        last_modified: normalize_date_or_datetime(race?.last_modified),
        description: strip_html(race?.description),
        timezone: as_string(race?.timezone),

        ...urls,
        ...addr,
        ...dates,
      };

      const events = Array.isArray(race?.events)
        ? race.events
        : Array.isArray(race?.events?.event)
          ? race.events.event
          : race?.events?.event
            ? [race.events.event]
            : [];

      const race_key = `${year}__${race_id ?? "null"}`;
      const race_count_first = seen_race_ids.has(race_key) ? 0 : 1;
      if (race_count_first === 1) seen_race_ids.add(race_key);

      if (!events.length) {
        if (enable_race_only) {
          global_race_row_index++;

          yield {
            page,
            row_index: global_race_row_index,

            race_count_first,
            event_count_first: null,

            ...race_base,

            event_id: null,
            race_event_days_id: null,
            event_name: null,
            event_details: null,
            event_type: null,
            distance: null,
            volunteer: null,
            require_dob: null,
            require_phone: null,
            participant_cap: null,

            event_start_time: null,
            event_end_time: null,
            event_month: null,
            event_year: null,
            event_registration_opens: null,
            event_registration_opens_month: null,
            event_registration_opens_year: null,

            event_reg_opens: null,
            event_reg_closes: null,
            event_race_fee: null,
            event_processing_fee: null,
            event_registration_periods_json: "[]",

            created_at_mtn,
            created_at_utc,
          };
        }
        continue;
      }

      for (const ev of events) {
        const ev_dates = normalize_event_dates(ev);

        const parsed = parse_date_to_month_year(ev_dates.event_start_time);
        if (parsed.year && parsed.year !== year) continue;

        const reg_periods_summary = extract_registration_period_summary(
          ev?.registration_periods
        );

        global_event_row_index++;

        const event_id = ev?.event_id ?? null;
        const event_key = `${year}__${event_id ?? "null"}`;
        const event_count_first = seen_event_ids.has(event_key) ? 0 : 1;
        if (event_count_first === 1) seen_event_ids.add(event_key);

        yield {
          page,
          row_index: global_event_row_index,

          race_count_first,
          event_count_first,

          ...race_base,

          event_id,
          race_event_days_id: ev?.race_event_days_id ?? null,
          event_name: as_string(ev?.name),
          event_details: strip_html(ev?.details),

          event_type: as_string(ev?.event_type),
          distance:
            ev?.distance !== undefined && ev?.distance !== null
              ? String(ev.distance)
              : null,

          volunteer: as_bool_flag(ev?.volunteer),
          require_dob: as_bool_flag(ev?.require_dob),
          require_phone: as_bool_flag(ev?.require_phone),

          participant_cap:
            ev?.participant_cap !== undefined && ev?.participant_cap !== null
              ? Number(ev.participant_cap)
              : null,

          ...ev_dates,
          ...reg_periods_summary,

          created_at_mtn,
          created_at_utc,
        };
      }
    }

    if (races.length < results_per_page) {
      keep_going = false;
    } else {
      page++;
      await delay(throttle_ms);
    }
  }
}

module.exports = {
  generate_runsignup_rows_streaming,
  fetch_races_page,

  as_string,
  as_bool_flag,
  parse_date_to_month_year,
  safe_json,
  as_money_number,
  strip_html,

  normalize_date_or_datetime,
  normalize_date_only,
  normalize_datetime,

  normalize_address,
  normalize_urls_and_social,
  normalize_race_dates,
  normalize_event_dates,
  extract_registration_period_summary,
};
/**
 * normalize.js — value-level normalizers that turn messy source cell values
 * into the exact textual forms the template requires.
 *
 * Every normalizer has the signature:  (value, ctx) -> { value: string, flag: string|null }
 * `flag` is a short code (e.g. "review-state") when a human should double-check;
 * null means confident.
 *
 * Pure + isomorphic. No ExcelJS, no DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RRT = root.RRT || {};
    root.RRT.normalize = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30, 0, 0, 0); // 1899-12-30, exceljs/Excel base

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function is_blank(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }
  function as_text(v) {
    if (is_blank(v)) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).trim();
  }

  // ---- US states -----------------------------------------------------------
  var STATE_ABBR = {
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC','washington dc':'DC','puerto rico':'PR','guam':'GU',
    'virgin islands':'VI','american samoa':'AS','northern mariana islands':'MP'
  };
  var VALID_ABBR = {};
  Object.keys(STATE_ABBR).forEach(function (k) { VALID_ABBR[STATE_ABBR[k]] = true; });

  // ---- date/time helpers ---------------------------------------------------
  function date_from_excel_serial(n) {
    return new Date(EXCEL_EPOCH_UTC + Math.round(n * 86400000));
  }

  // Parse arbitrary input into UTC y/m/d for a calendar date (DOB).
  function to_ymd(value) {
    if (value instanceof Date) {
      return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
    }
    if (typeof value === 'number') {
      var dt = date_from_excel_serial(value);
      return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }
    var s = as_text(value);
    if (!s) return null;
    var m;
    // ISO yyyy-mm-dd or yyyy/mm/dd
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) {
      return { y: +m[1], m: +m[2], d: +m[3] };
    }
    // mm/dd/yyyy or mm-dd-yy
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) {
      var yr = +m[3];
      if (yr < 100) yr += (yr <= 30 ? 2000 : 1900);
      return { y: yr, m: +m[1], d: +m[2] };
    }
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return { y: parsed.getUTCFullYear(), m: parsed.getUTCMonth() + 1, d: parsed.getUTCDate() };
    }
    return null;
  }

  // Parse arbitrary input into total milliseconds-of-event for a duration/time.
  function to_duration_ms(value) {
    if (value instanceof Date) {
      return value.getTime() - EXCEL_EPOCH_UTC; // robust for >24h too
    }
    if (typeof value === 'number') {
      return Math.round(value * 86400000); // excel day fraction
    }
    var s = as_text(value);
    if (!s) return null;
    // hh:mm:ss(.fff) | mm:ss(.f) | ss
    var parts = s.split(':');
    if (parts.length >= 2 && parts.length <= 3) {
      var h = 0, mi = 0, se = 0;
      if (parts.length === 3) { h = parseInt(parts[0], 10) || 0; mi = parseInt(parts[1], 10) || 0; se = parseFloat(parts[2]) || 0; }
      else { mi = parseInt(parts[0], 10) || 0; se = parseFloat(parts[1]) || 0; }
      return Math.round(((h * 3600) + (mi * 60) + se) * 1000);
    }
    var num = parseFloat(s);
    if (!isNaN(num)) return Math.round(num * 1000); // bare seconds
    return null;
  }

  // ---- normalizers ---------------------------------------------------------

  function n_text(value) {
    return { value: as_text(value), flag: null };
  }

  function n_member(value) {
    var s = as_text(value);
    var digits = s.replace(/\D/g, '');
    // Treat a real numeric membership id (>= 4 digits) as the member number.
    if (digits.length >= 4 && /^[\d\s-]+$/.test(s)) {
      return { value: digits, flag: null };
    }
    // blank, "Valid", "1-day", or anything non-numeric -> one-day default.
    return { value: '1-day', flag: is_blank(value) ? 'member-default' : 'member-nonnumeric' };
  }

  function n_gender(value) {
    var s = as_text(value).toLowerCase();
    if (!s) return { value: '', flag: 'gender-missing' };
    if (s === 'm' || s === 'male' || s === 'man' || s === 'boy') return { value: 'M', flag: null };
    if (s === 'f' || s === 'female' || s === 'woman' || s === 'girl') return { value: 'F', flag: null };
    if (s === 'nb' || s === 'non-binary' || s === 'nonbinary' || s === 'non binary' || s === 'x' || s === 'other' || s === 'enby')
      return { value: 'NB', flag: null };
    if (s[0] === 'm') return { value: 'M', flag: null };
    if (s[0] === 'f') return { value: 'F', flag: null };
    return { value: s.toUpperCase(), flag: 'gender-unknown' };
  }

  function n_dob(value) {
    if (is_blank(value)) return { value: '', flag: 'dob-missing' };
    var ymd = to_ymd(value);
    if (!ymd) return { value: as_text(value), flag: 'dob-unparsed' };
    return { value: pad(ymd.m, 2) + '/' + pad(ymd.d, 2) + '/' + pad(ymd.y, 4), flag: null };
  }

  function n_state(value) {
    var s = as_text(value);
    if (!s) return { value: '', flag: 'state-missing' };
    var up = s.toUpperCase();
    if (up.length === 2 && VALID_ABBR[up]) return { value: up, flag: null };
    var hit = STATE_ABBR[s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()];
    if (hit) return { value: hit, flag: null };
    // unknown / foreign (e.g. "BCN") -> keep but flag for review
    return { value: up, flag: 'state-review' };
  }

  function n_category(value) {
    var s = as_text(value);
    if (!s) return { value: 'Age Group', flag: 'category-default' };
    var l = s.toLowerCase();
    if (/\b(elite|pro|professional)\b/.test(l)) return { value: 'Elite', flag: null };
    if (/para/.test(l)) return { value: 'Para', flag: null };
    if (/relay/.test(l)) return { value: 'Relay', flag: null };
    // explicit age-group signals
    if (/age\s*group/.test(l)) return { value: 'Age Group', flag: null };
    if (/\d{1,2}\s*[-–to]+\s*\d{1,2}/.test(l)) return { value: 'Age Group', flag: null }; // 30-34
    if (/\b(m|f|male|female)?\s*\d{2}\s*(\+|and over|over)?\b/.test(l) && /\d{2}/.test(l))
      return { value: 'Age Group', flag: null };
    // unrecognized division name -> assume Age Group, flag for confirmation
    return { value: 'Age Group', flag: 'category-assumed' };
  }

  function n_time(value) {
    if (is_blank(value)) return { value: '', flag: 'time-missing' };
    var raw = as_text(value);
    if (/^(dns|dnf|dq|dsq|dnc|nt|w\/d|wd)$/i.test(raw)) return { value: raw.toUpperCase(), flag: 'time-status' };
    var ms = to_duration_ms(value);
    if (ms === null || isNaN(ms)) return { value: as_text(value), flag: 'time-unparsed' };
    if (ms < 0) ms = 0;
    var total_ms = Math.round(ms);
    var ms_part = total_ms % 1000;
    var total_sec = (total_ms - ms_part) / 1000;
    var s = total_sec % 60;
    var total_min = (total_sec - s) / 60;
    var mi = total_min % 60;
    var h = (total_min - mi) / 60;
    return { value: pad(h, 2) + ':' + pad(mi, 2) + ':' + pad(s, 2) + '.' + pad(ms_part, 3), flag: null };
  }

  var REGISTRY = {
    text: n_text, member: n_member, gender: n_gender, dob: n_dob,
    state: n_state, category: n_category, time: n_time
  };

  function run(name, value) {
    var fn = REGISTRY[name] || n_text;
    return fn(value);
  }

  return {
    run: run, registry: REGISTRY,
    is_blank: is_blank, as_text: as_text, pad: pad,
    to_ymd: to_ymd, to_duration_ms: to_duration_ms,
    STATE_ABBR: STATE_ABBR, VALID_ABBR: VALID_ABBR,
    // expose individual normalizers for unit tests
    n_text: n_text, n_member: n_member, n_gender: n_gender, n_dob: n_dob,
    n_state: n_state, n_category: n_category, n_time: n_time
  };
}));

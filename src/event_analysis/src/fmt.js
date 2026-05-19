/**
 * fmt.js — typography + number formatting helpers (single source of truth).
 *
 * Use these everywhere the deck / sheets / dashboard render numbers and
 * editorial labels so output stays visually consistent (Unicode minus,
 * em-dashes, thousands separators, severity glyphs, full month names).
 */

'use strict';

// ── Unicode characters ─────────────────────────────────────────────────────
const MINUS    = '−';  // − (Unicode minus, not ASCII hyphen)
const EM_DASH  = '—';  // —
const EN_DASH  = '–';  // –
const GE       = '≥';  // ≥
const LE       = '≤';  // ≤
const WARN     = '⚠';  // ⚠ (used for decliners / concern)
const CHECK    = '✓';  // ✓ (used for growth / bright spots)
const ARROW_R  = '→';  // → (used in cal+org formulas)
const TIMES    = '×';  // × (used in methodology lines)

// ── Month names ────────────────────────────────────────────────────────────
const MN_SHORT = { 1:'Jan', 2:'Feb', 3:'Mar', 4:'Apr', 5:'May', 6:'Jun',
                   7:'Jul', 8:'Aug', 9:'Sep', 10:'Oct', 11:'Nov', 12:'Dec' };
const MN_FULL  = { 1:'January', 2:'February', 3:'March',   4:'April',
                   5:'May',     6:'June',     7:'July',    8:'August',
                   9:'September', 10:'October', 11:'November', 12:'December' };

// ── Number formatters ──────────────────────────────────────────────────────

/** Locale-formatted integer with Unicode minus for negatives. */
function fmt_int(n) {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return '—';
  if (v < 0) return `${MINUS}${Math.abs(v).toLocaleString()}`;
  return v.toLocaleString();
}

/**
 * Signed integer delta with +/− prefix (Unicode minus). 0 → "0".
 * Example: fmt_delta(-12) → "−12", fmt_delta(+5) → "+5"
 */
function fmt_delta(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  if (v === 0) return '0';
  if (v > 0) return `+${v.toLocaleString()}`;
  return `${MINUS}${Math.abs(v).toLocaleString()}`;
}

/** Signed delta with one decimal place. fmt_delta1(-12.8) → "−12.8" */
function fmt_delta1(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  if (v > 0) return `+${v.toFixed(1)}`;
  if (v < 0) return `${MINUS}${Math.abs(v).toFixed(1)}`;
  return '0.0';
}

/**
 * Percent change from a → b, using Unicode minus. 1 decimal place.
 * Example: fmt_pct(1178, 1165) → "−1.1%"
 */
function fmt_pct(a, b) {
  if (!a) return '—';
  const pct = ((Number(b) - Number(a)) / Number(a)) * 100;
  if (pct === 0) return '0.0%';
  if (pct > 0) return `+${pct.toFixed(1)}%`;
  return `${MINUS}${Math.abs(pct).toFixed(1)}%`;
}

/** Standalone percent (already computed). fmt_pct_n(-13.4) → "−13.4%" */
function fmt_pct_n(p, decimals = 1) {
  const v = Number(p);
  if (!isFinite(v)) return '—';
  if (v === 0) return '0.0%';
  if (v > 0) return `+${v.toFixed(decimals)}%`;
  return `${MINUS}${Math.abs(v).toFixed(decimals)}%`;
}

// ── Severity glyph for a numeric change ────────────────────────────────────
/**
 * Return ⚠ for material declines, ✓ for material gains, '' otherwise.
 * Used to mark decliner/grower rows in "Read as..." cells and bullets.
 */
function severity(value, thresholds = { warn: -5, check: 3 }) {
  const v = Number(value);
  if (!isFinite(v)) return '';
  if (v <= thresholds.warn) return WARN;
  if (v >= thresholds.check) return CHECK;
  return '';
}

/** Same idea but for percentage values (defaults tuned for organic %). */
function severity_pct(pct, thresholds = { warn: -5, check: 5 }) {
  return severity(pct, thresholds);
}

// ── String helpers ─────────────────────────────────────────────────────────

/** "a and b" / "a, b, and c" — natural English list. */
function list_and(items) {
  if (!items?.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

module.exports = {
  // Characters
  MINUS, EM_DASH, EN_DASH, GE, LE, WARN, CHECK, ARROW_R, TIMES,
  // Month dictionaries
  MN_SHORT, MN_FULL,
  // Formatters
  fmt_int, fmt_delta, fmt_delta1, fmt_pct, fmt_pct_n,
  // Glyphs
  severity, severity_pct,
  // Strings
  list_and,
};

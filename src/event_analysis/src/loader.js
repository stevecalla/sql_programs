/**
 * loader.js — parse the two event CSVs
 *
 * The CSV has a duplicate column name (id_sanctioning_events appears at
 * position 2 AND position 8). We read by index to avoid the ambiguity.
 *
 * Column positions (0-indexed):
 *  0  created_at_events
 *  1  name_events
 *  2  id_sanctioning_events   ← the REAL sanction ID  e.g. "354767-Youth Clinic"
 *  3  starts_year_events
 *  4  status_events
 *  5  name_event_type
 *  6  starts_events            e.g. "Sat, 2025-07-05"
 *  7  registration_url
 *  8  id_sanctioning_events   ← race count (always "1"), ignored
 *  9  id_races
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const EXCLUDE_STATUSES = new Set(['CANCELLED', 'DECLINED', 'DELETED']);

/**
 * Parse a date string like "Sat, 2025-07-05" → Date object (or null).
 */
function parseEventDate(s) {
  if (!s) return null;
  const parts = s.trim().split(', ');
  const dateStr = parts[parts.length - 1];           // "2025-07-05"
  const d = new Date(dateStr + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalise event_type: fold "missing_event_type_*" → "Adult Race".
 */
function cleanType(t) {
  if (!t) return 'Adult Race';
  return t.toLowerCase().includes('missing') ? 'Adult Race' : t.trim();
}

/**
 * Load and parse one CSV.
 * Returns an array of event objects, filtered to active events only
 * (status NOT in EXCLUDE_STATUSES), unless includeExcluded is true.
 */
function loadCsv(filePath, { includeExcluded = false } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // csv-parse returns arrays when we DON'T pass columns:true,
  // so we can read positionally to handle the duplicate header.
  const rows = parse(raw, {
    skip_empty_lines: true,
    from_line: 2,          // skip header row
    relax_column_count: true,
  });

  const events = [];
  for (const row of rows) {
    const status = (row[4] || '').trim();
    if (!includeExcluded && EXCLUDE_STATUSES.has(status)) continue;

    const startDate = parseEventDate(row[6]);
    if (!startDate && !includeExcluded) continue;   // skip undatable active events

    events.push({
      name:        (row[1] || '').trim(),
      sanctionId:  (row[2] || '').trim(),   // real ID at position 2
      status,
      type:        cleanType(row[5]),
      startDate,
      month:       startDate ? startDate.getUTCMonth() + 1 : null,  // 1–12
    });
  }

  return events;
}

/**
 * Load both years, returning active and excluded pools separately.
 */
function loadBothYears(csv2025Path, csv2026Path) {
  const y25active   = loadCsv(csv2025Path);
  const y26active   = loadCsv(csv2026Path);
  const y25excluded = loadCsv(csv2025Path, { includeExcluded: true })
                        .filter(e => EXCLUDE_STATUSES.has(e.status));
  const y26excluded = loadCsv(csv2026Path, { includeExcluded: true })
                        .filter(e => EXCLUDE_STATUSES.has(e.status));

  return { y25active, y26active, y25excluded, y26excluded };
}

module.exports = { loadBothYears, parseEventDate, cleanType, EXCLUDE_STATUSES };

/**
 * calendar.js — weekend day counts, US holidays, organic delta calculations.
 * Mirrors the Python calendar.py logic exactly.
 *
 * NOTE: JavaScript Date months are 0-indexed but we use 1-indexed throughout
 * this file to match the Python convention. All public functions accept month 1–12.
 */

'use strict';

/** Number of days in a given month (1-indexed). */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();   // month is 1-based → passing it to new Date(y,m,0) gives last day of m-1... actually this works because new Date(year, month, 0) = last day of month-1... wait let me be careful
  // Actually: new Date(year, month, 0) where month is 1-based gives the last day of (month-1).
  // We want last day of `month` (1-based), so: new Date(year, month, 0) ← this IS correct because
  // JS months are 0-based, so passing `month` (1-based value) as the JS month param is like passing
  // (month-1)+1 = the next month, then day 0 = last day of the month before it = last day of our month.
}

/** Day of week for a given date: 0=Sun, 1=Mon, ... 6=Sat (JS convention). */
function dow(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Total weekend days (Sat + Sun) in a month. */
function weekendDays(year, month) {
  const days = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const w = dow(year, month, d);
    if (w === 0 || w === 6) count++;
  }
  return count;
}

/** Separate Saturday and Sunday counts. */
function satSun(year, month) {
  const days = daysInMonth(year, month);
  let sats = 0, suns = 0;
  for (let d = 1; d <= days; d++) {
    const w = dow(year, month, d);
    if (w === 6) sats++;
    if (w === 0) suns++;
  }
  return { sats, suns };
}

/**
 * US holidays as { month, day } objects for a given year.
 * Includes: New Year's, Memorial Day (last Mon of May), July 4th,
 *           Labor Day (first Mon of Sep), Thanksgiving (4th Thu of Nov), Christmas.
 */
function usHolidays(year) {
  const holidays = [];

  // Fixed dates
  holidays.push({ month: 1,  day: 1,  name: "New Year's" });
  holidays.push({ month: 7,  day: 4,  name: 'July 4th' });
  holidays.push({ month: 12, day: 25, name: 'Christmas' });

  // Memorial Day: last Monday of May
  {
    let d = 31;
    while (dow(year, 5, d) !== 1) d--;   // 1 = Monday in JS
    holidays.push({ month: 5, day: d, name: 'Memorial Day' });
  }

  // Labor Day: first Monday of September
  {
    let d = 1;
    while (dow(year, 9, d) !== 1) d++;
    holidays.push({ month: 9, day: d, name: 'Labor Day' });
  }

  // Thanksgiving: 4th Thursday of November
  {
    let d = 1, count = 0;
    while (count < 4) {
      if (dow(year, 11, d) === 4) count++;  // 4 = Thursday
      if (count < 4) d++;
    }
    holidays.push({ month: 11, day: d, name: 'Thanksgiving' });
  }

  return holidays;
}

/**
 * For a given month, return an array of notable calendar changes 2025→2026.
 * Used for the calendar structure tab annotations.
 */
function calendarNotes(month) {
  const notes = [];

  const w25 = weekendDays(2025, month);
  const w26 = weekendDays(2026, month);
  const dw  = w26 - w25;
  const { sats: s25, suns: u25 } = satSun(2025, month);
  const { sats: s26, suns: u26 } = satSun(2026, month);

  if (dw !== 0) {
    const parts = [];
    if (s26 - s25 !== 0) parts.push(`Sat${s26 - s25 > 0 ? '+' : ''}${s26 - s25}`);
    if (u26 - u25 !== 0) parts.push(`Sun${u26 - u25 > 0 ? '+' : ''}${u26 - u25}`);
    notes.push(`Wknd ${dw > 0 ? '+' : ''}${dw}: ${parts.join(', ')} in 2026`);
  }

  // Holiday day-of-week shifts
  const hols25 = usHolidays(2025).filter(h => h.month === month);
  const hols26 = usHolidays(2026).filter(h => h.month === month);

  for (const h25 of hols25) {
    const h26 = hols26.find(h => h.name === h25.name);
    if (!h26) continue;
    const d25 = dow(2025, h25.month, h25.day);
    const d26 = dow(2026, h26.month, h26.day);
    if (d25 !== d26) {
      const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
      const wasWknd25 = d25 === 0 || d25 === 6;
      const isWknd26  = d26 === 0 || d26 === 6;
      const flag = wasWknd25 !== isWknd26 ? '⚠' : '↕';
      notes.push(`${flag} ${h25.name}: ${DOW[d25]}→${DOW[d26]}`);
    }
  }

  // Labor Day always gets the specific date note (even if same dow)
  if (month === 9) {
    const ld25 = usHolidays(2025).find(h => h.name === 'Labor Day');
    const ld26 = usHolidays(2026).find(h => h.name === 'Labor Day');
    if (ld25 && ld26 && ld25.day !== ld26.day) {
      notes.push(`↕ Labor Day: Sep ${ld25.day}→Sep ${ld26.day} (+${ld26.day - ld25.day}d)`);
    }
  }

  return notes;
}

/**
 * Build a 6-week calendar grid for a month (Mon–Sun, mirrors Python calendar.monthcalendar).
 * Returns [[mon,tue,wed,thu,fri,sat,sun], ...] with 0 for days outside the month.
 */
function monthGrid(year, month) {
  const grid = [];
  const totalDays = daysInMonth(year, month);
  const firstDow = dow(year, month, 1);    // 0=Sun … 6=Sat (JS)
  // Convert to Mon-based: Mon=0 … Sun=6
  const firstMon = (firstDow + 6) % 7;

  let week = new Array(7).fill(0);
  let col  = firstMon;

  for (let d = 1; d <= totalDays; d++) {
    week[col] = d;
    col++;
    if (col === 7) {
      grid.push([...week]);
      week = new Array(7).fill(0);
      col  = 0;
    }
  }
  if (col > 0) grid.push([...week]);

  // Pad to 6 rows
  while (grid.length < 6) grid.push(new Array(7).fill(0));
  return grid.slice(0, 6);
}

/**
 * Compute calendar-impact analysis for all 12 months.
 * Returns array of { month, w25, w26, dw, ds, du, calByType, actByType, orgByType, calTotal, orgTotal, actDelta }.
 */
function buildCalendarImpact(c25, c26) {
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
  const months = [];

  for (let m = 1; m <= 12; m++) {
    const w25 = weekendDays(2025, m);
    const w26 = weekendDays(2026, m);
    const dw  = w26 - w25;
    const { sats: s25, suns: u25 } = satSun(2025, m);
    const { sats: s26, suns: u26 } = satSun(2026, m);

    const tot25 = TYPES.reduce((s, t) => s + (c25[m]?.[t] ?? 0), 0);
    const tot26 = TYPES.reduce((s, t) => s + (c26[m]?.[t] ?? 0), 0);
    const actDelta = tot26 - tot25;

    const calByType = {}, actByType = {}, orgByType = {};
    let calTotal = 0;

    for (const t of TYPES) {
      const v25 = c25[m]?.[t] ?? 0;
      const v26 = c26[m]?.[t] ?? 0;
      const rate = w25 > 0 ? v25 / w25 : 0;
      const cal  = dw * rate;
      const act  = v26 - v25;
      const org  = act - cal;
      calByType[t] = cal;
      actByType[t] = act;
      orgByType[t] = org;
      calTotal    += cal;
    }

    months.push({
      month: m, w25, w26, dw,
      ds: s26 - s25, du: u26 - u25,
      tot25, tot26, actDelta,
      calTotal, orgTotal: actDelta - calTotal,
      calByType, actByType, orgByType,
    });
  }

  return months;
}

module.exports = {
  daysInMonth, dow, weekendDays, satSun,
  usHolidays, calendarNotes, monthGrid,
  buildCalendarImpact,
};

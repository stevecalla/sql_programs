/**
 * display.js — how a raw cell value is rendered as text in the on-screen tables.
 *
 * This is the function the web app uses for EVERY table cell, so it is unit-
 * tested (tests/display.test.js) to guarantee the format shown to the user is
 * correct — in particular that Excel time values (which exceljs returns as
 * Dates on the 1899-12-30 epoch) render as times, not dates.
 *
 * Pure + isomorphic. Depends on normalize.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./normalize'));
  } else {
    root.RRT = root.RRT || {};
    root.RRT.display = factory(root.RRT.normalize);
  }
}(typeof self !== 'undefined' ? self : this, function (normalize) {
  'use strict';

  // True when a Date is really an Excel time-of-day value (epoch 1899-12-30),
  // not a calendar date like a DOB.
  function is_excel_time(d) { return d.getUTCFullYear() <= 1900; }

  function cell_text(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      if (is_excel_time(v)) {
        return normalize.n_time(v).value.replace(/\.000$/, ''); // hh:mm:ss (trim .000 for preview)
      }
      return normalize.n_dob(v).value;                           // mm/dd/yyyy
    }
    return String(v);
  }

  return { cell_text: cell_text, is_excel_time: is_excel_time };
}));

/**
 * builder.js — orchestrate all worksheets into one ExcelJS workbook.
 *
 * Tab order matches 2026_event_calendar_analysis_v9f.xlsx exactly:
 *   1.  executive_summary
 *   2.  step_0_calendar_structure
 *   3.  step_1_event_type_by_month
 *   4.  step_2_calendar_impact
 *   5.  step_3_organic_performance
 *   6.  step_4_event_detail          (16 cols: Segment → 2026 Status, incl Day + Status)
 *   7.  step_4a_segment_by_month
 *   8.  step_4b_shift_flow_matrix
 *   9.  step_4c_shifted_events
 *   10. step_4d_cancelled_cross_match
 *   11. step_5_creation_pipeline
 *   12. monthly_reconciliation
 */

'use strict';

const ExcelJS = require('exceljs');
const path    = require('path');

const build_executive_summary      = require('./sheets/executive_summary');
const build_calendar_structure     = require('./sheets/calendar_structure');
const build_event_type_by_month    = require('./sheets/event_type_by_month');
const build_calendar_impact        = require('./sheets/calendar_impact');
const build_organic_performance    = require('./sheets/organic_performance');
const build_event_detail           = require('./sheets/event_detail');
const build_segment_by_month       = require('./sheets/segment_by_month');
const build_shift_flow_matrix      = require('./sheets/shift_flow_matrix');
const build_shifted_events         = require('./sheets/shifted_events');
const build_cancelled_cross_match  = require('./sheets/cancelled_cross_match');
const build_creation_pipeline      = require('./sheets/creation_pipeline');
const build_monthly_reconciliation = require('./sheets/monthly_reconciliation');

/**
 * Build the complete workbook from analysis results.
 * @param {object}      results            — output of run_analysis()
 * @param {string}      out_path           — path for the saved .xlsx file
 * @param {Array|null}  creation_rows_25   — prior-year creation-pipeline rows
 *                                            ({yr,type,mo,cnt}) from src/db.js
 * @param {Array|null}  creation_rows_26   — current-year creation-pipeline rows
 * @param {object|null} cm                 — commentary object
 */
async function build_workbook(results, out_path, creation_rows_25 = null, creation_rows_26 = null, cm = null) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'USAT Event Analysis';
  wb.created  = new Date();
  wb.modified = new Date();

  console.log('  Building executive_summary ...');
  build_executive_summary(wb, results, cm);

  console.log('  Building step_0_calendar_structure ...');
  build_calendar_structure(wb, results);

  console.log('  Building step_1_event_type_by_month ...');
  build_event_type_by_month(wb, results);

  console.log('  Building step_2_calendar_impact ...');
  build_calendar_impact(wb, results, cm);

  console.log('  Building step_3_organic_performance ...');
  build_organic_performance(wb, results, cm);

  console.log('  Building step_4_event_detail ...');
  build_event_detail(wb, results);

  console.log('  Building step_4a_segment_by_month ...');
  build_segment_by_month(wb, results);

  console.log('  Building step_4b_shift_flow_matrix ...');
  build_shift_flow_matrix(wb, results);

  console.log('  Building step_4c_shifted_events ...');
  build_shifted_events(wb, results);

  console.log('  Building step_4d_cancelled_cross_match ...');
  build_cancelled_cross_match(wb, results);

  if (creation_rows_25 && creation_rows_26) {
    console.log('  Building step_5_creation_pipeline ...');
    build_creation_pipeline(wb, creation_rows_25, creation_rows_26, cm, results);
  }

  console.log('  Building monthly_reconciliation ...');
  build_monthly_reconciliation(wb, results);

  console.log(`  Writing ${path.basename(out_path)} ...`);
  await wb.xlsx.writeFile(out_path);
  console.log(`  Saved: ${out_path}`);

  return out_path;
}

module.exports = { build_workbook };

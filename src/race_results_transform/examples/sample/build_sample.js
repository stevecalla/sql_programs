'use strict';
// Generates sample_race_results_FAKE.xlsx from the fake rows below. The xlsx uses native
// Excel Date (DOB) and time-of-day cells (splits + Gun Time) so the exceljs read path and the
// "Excel time renders as a time, not a date" behavior get exercised by tests. All data is fake.
const ExcelJS = require('exceljs');
const path = require('path');
function t(h, m, s) { return new Date(Date.UTC(1899, 11, 30, h, m, s, 0)); }   // time-of-day
function d(y, mo, da) { return new Date(Date.UTC(y, mo - 1, da)); }            // calendar date

const headers = ['Race / Division', 'Bib', 'First Name', 'Last Name', 'Gender', 'Age Group',
  'USAT membership', 'Email', 'Date of Birth', 'City', 'State', 'Zip Code',
  'Swim Time', 'Bike Time', 'Run Time', 'Gun Time'];

const rows = [
  ['International Triathlon', 1001, 'Jane', 'Doe', 'M', '30-34 Male', 'Valid', 'jane.doe@example.com', d(1990, 5, 12), 'Denver', 'CO', 80014, t(0, 12, 15), t(0, 49, 29), t(0, 38, 8), t(1, 41, 53)],
  ['International Triathlon', 1002, 'John', 'Smith', 'M', '25-29 Male', 'Bronze: Single Race Access', 'john.smith@example.com', d(1998, 4, 21), 'San Diego', 'CA', 92011, t(0, 14, 2), t(0, 48, 14), t(0, 37, 34), t(1, 42, 0)],
  ['International Triathlon', 1003, 'Maria', 'Lopez', 'F', '40-44 Female', 'Valid', 'maria.lopez@example.com', d(1982, 9, 1), '', 'BCN', 22000, t(0, 13, 12), t(0, 52, 22), t(0, 40, 30), t(1, 49, 22)],
  ['Sprint Triathlon', 2001, 'Alex', 'Stone', 'M', 'Elite', 'Valid', 'alex.stone@example.com', d(2001, 11, 30), 'Austin', 'TX', 73301, t(0, 9, 5), t(0, 30, 10), t(0, 18, 2), t(0, 58, 10)],
  ['Sprint Triathlon', 2002, 'Pat', 'Kim', 'F', '', '', 'pat.kim@example.com', d(2003, 9, 9), 'Boise', 'ID', 83702, t(0, 10, 1), t(0, 33, 0), t(0, 19, 30), t(1, 4, 30)],
  ['Relay', 3001, 'Jordan', 'Reed', 'M', 'Relay', 'Valid', 'jordan.reed@example.com', d(1992, 12, 1), 'Mercer Island', 'Washington', 98040, t(0, 11, 0), t(0, 40, 0), t(0, 20, 0), t(1, 11, 0)],
  ['Sprint Duathlon', 4001, 'Dana', 'Cruz', 'F', 'Clydesdale', 'Invalid', 'dana.cruz@example.com', d(1969, 4, 18), 'Tampa', 'FL', 33601, t(0, 0, 0), t(0, 52, 0), t(0, 38, 0), t(1, 30, 10)],
  ['International Triathlon', 1004, 'Morgan', 'Diaz', 'NB', '20-24 Male', 'Valid', 'morgan.diaz@example.com', d(2004, 8, 16), 'Mexico City', 'MEX', 1000, t(0, 12, 30), t(0, 51, 8), t(0, 39, 49), t(1, 47, 24)]
];

(async function () {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('results');
  ws.addRow(headers);
  rows.forEach(function (r) { ws.addRow(r); });
  const out = path.join(__dirname, 'sample_race_results_FAKE.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('wrote ' + out + ' (' + rows.length + ' fake rows)');
})();

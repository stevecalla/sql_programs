'use strict';
// holder_parse.js — server-side certificate-holder parsing for the event_coi module. Turns an uploaded
// CSV or Excel workbook into normalized holder rows, tolerating loosely-named columns ("st" for State,
// "Postal Code" for Zip, "Holder Name" for Name, …). Pure + dependency-light (only the root `xlsx`),
// so it's unit-tested directly (see ../tests/holder_parse.test.js). This is the single source of truth
// for header matching; the Phase-1 UI simply uploads and lets this parse.

const XLSX = require('xlsx');

// Normalized alias sets (lowercased, all non-alphanumerics stripped). Keep in sync with the note in
// the frontend module.
const HEADER_ALIASES = {
  name: ['name', 'holdername', 'holder', 'certificateholder', 'certholder', 'company', 'companyname', 'organization', 'organizationname', 'entity', 'businessname', 'insured'],
  address: ['addressline1', 'address1', 'address', 'addr', 'street', 'streetaddress', 'mailingaddress', 'addressline', 'line1'],
  address2: ['addressline2', 'address2', 'addr2', 'line2', 'suite', 'unit', 'apt'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province', 'stateprovince', 'region'],
  zip: ['zip', 'zipcode', 'postalcode', 'postal', 'postcode', 'zippostalcode'],
  email: ['email', 'emailaddress', 'holderemail', 'holderemailaddress', 'mail', 'contactemail', 'emailaddr'],
};

function normHeader(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function headerIndex(headerCells) {
  const H = (headerCells || []).map(normHeader);
  const find = (key) => H.findIndex((h) => HEADER_ALIASES[key].includes(h));
  return { name: find('name'), a1: find('address'), a2: find('address2'), city: find('city'), state: find('state'), zip: find('zip'), email: find('email') };
}

// rows = array-of-arrays; row 0 is the header. Returns holder objects; blank rows and unknown columns
// are dropped, and Address Line 1 + Line 2 are combined into a single Address.
function mapRows(rows) {
  if (!rows || !rows.length) return [];
  const idx = headerIndex(rows[0]);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r] || [];
    const get = (i) => (i >= 0 && c[i] != null ? String(c[i]).trim() : '');
    const address = [get(idx.a1), get(idx.a2)].filter(Boolean).join(' ');
    const row = { name: get(idx.name), address, city: get(idx.city), state: get(idx.state), zip: get(idx.zip), email: get(idx.email) };
    if (row.name || row.address) out.push(row);
  }
  return out;
}

// Minimal CSV splitter (quoted fields, escaped quotes) -> rows -> holders.
function parseCsvText(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().length);
  const split = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).slice(0, -1).map((cell) => cell.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  return mapRows(lines.map(split));
}

// Excel Buffer -> { sheet, holders }. Prefers a MASTER tab, then a Holders tab, else the first sheet.
function parseWorkbookBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const up = (n) => n.trim().toUpperCase();
  const pick = wb.SheetNames.find((n) => up(n) === 'MASTER') || wb.SheetNames.find((n) => up(n) === 'HOLDERS') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[pick], { header: 1, defval: '', blankrows: false });
  return { sheet: pick, holders: mapRows(rows) };
}

// Dispatch by filename extension. buf = Buffer.
function parseUpload(filename, buf) {
  if (/\.csv$/i.test(filename || '')) return { sheet: '(csv)', holders: parseCsvText(buf.toString('utf8')) };
  return parseWorkbookBuffer(buf);
}

module.exports = { HEADER_ALIASES, normHeader, mapRows, parseCsvText, parseWorkbookBuffer, parseUpload };

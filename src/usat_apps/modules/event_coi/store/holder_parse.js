'use strict';
// holder_parse.js — server-side certificate-holder parsing for the event_coi module. Turns an uploaded
// CSV or Excel workbook into normalized holder rows, tolerating loosely-named columns ("st" for State,
// "Postal Code" for Zip, "Holder Name" for Name, …). Also reads the optional PER-HOLDER coverage columns
// (Additional Insured, Waiver, Relationship, Delivery, …) when present. Pure + dependency-light (only the
// root `xlsx`), so it's unit-tested directly (see ../tests/holder_parse.test.js).

const XLSX = require('xlsx');

// Identity alias sets (lowercased, all non-alphanumerics stripped).
const HEADER_ALIASES = {
  name: ['name', 'holdername', 'holder', 'certificateholder', 'certholder', 'company', 'companyname', 'organization', 'organizationname', 'entity', 'businessname', 'insured'],
  address: ['addressline1', 'address1', 'address', 'addr', 'street', 'streetaddress', 'mailingaddress', 'addressline', 'line1'],
  address2: ['addressline2', 'address2', 'addr2', 'line2', 'suite', 'unit', 'apt'],
  city: ['city', 'town'],
  state: ['state', 'st', 'province', 'stateprovince', 'region'],
  zip: ['zip', 'zipcode', 'postalcode', 'postal', 'postcode', 'zippostalcode'],
  email: ['email', 'emailaddress', 'holderemail', 'holderemailaddress', 'mail', 'contactemail', 'emailaddr'],
};

// Optional per-holder coverage alias sets. Keys match the options model (see web lib/coverage.js).
const COVERAGE_ALIASES = {
  additionalInsured: ['additionalinsured', 'addlinsured', 'addinsured', 'ainsured'],
  aiPrimaryNonContrib: ['aiprimarynoncontributory', 'aiprimarynoncontrib', 'aipnc', 'aiprimary', 'primarynoncontributory', 'primaryandnoncontributory', 'pnc'],
  waiverOfSubrogation: ['waiverofsubrogation', 'waiverofsubro', 'waiver', 'subrogation', 'wos'],
  noticeOfCancellation: ['noticeofcancellation', 'noticeofcancel', 'notice', 'cancellation', 'noc'],
  coverageOtherText: ['coverageother', 'coverageotherspecify', 'othercoverage'],
  contract: ['writtencontract', 'writtencontractinplace', 'contract', 'contractinplace'],
  relationship: ['relationship', 'relationshiptype', 'holdertype', 'type'],
  relationshipOtherText: ['relationshipother', 'relationshipotherspecify'],
  additionalInfo: ['additionalinformation', 'additionalinfo', 'addlinfo', 'info', 'notes', 'comments'],
  delivery: ['deliverymethod', 'delivery', 'deliverto', 'deliveryto'],
  deliveryOtherText: ['deliveryother', 'deliveryotherspecify'],
};

const CHECK_KEYS = ['additionalInsured', 'aiPrimaryNonContrib', 'waiverOfSubrogation', 'noticeOfCancellation'];

function normHeader(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function parseBool(v) { return /^(y|yes|x|true|1|✓|checked|on)$/i.test(String(v == null ? '' : v).trim()); }
function parseContract(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); if (!s) return ''; if (s[0] === 'y') return 'yes'; if (s[0] === 'n') return 'no'; return ''; }
function parseRelationship(v) { const s = String(v == null ? '' : v).toLowerCase(); if (!s.trim()) return ''; if (/landlord|venue|owner/.test(s)) return 'landlord'; if (/gov|agency|permit|municipal|\bstate\b|governmental/.test(s)) return 'stateGov'; if (/other/.test(s)) return 'other'; return ''; }
function parseDelivery(v) { const s = String(v == null ? '' : v).toLowerCase(); if (!s.trim()) return ''; if (/holder|both|\band\b|&/.test(s)) return 'requestorAndHolder'; if (/requestor|requester/.test(s)) return 'requestor'; if (/other/.test(s)) return 'other'; return ''; }

function headerIndex(headerCells) {
  const H = (headerCells || []).map(normHeader);
  const find = (aliases) => H.findIndex((h) => aliases.includes(h));
  const idx = {
    name: find(HEADER_ALIASES.name), a1: find(HEADER_ALIASES.address), a2: find(HEADER_ALIASES.address2),
    city: find(HEADER_ALIASES.city), state: find(HEADER_ALIASES.state), zip: find(HEADER_ALIASES.zip), email: find(HEADER_ALIASES.email),
    cov: {},
  };
  for (const key of Object.keys(COVERAGE_ALIASES)) idx.cov[key] = find(COVERAGE_ALIASES[key]);
  return idx;
}

// rows = array-of-arrays; row 0 is the header. Returns holder objects; blank rows and unknown columns
// are dropped. Address Line 1 + Line 2 are combined. Coverage columns are read only when present.
function mapRows(rows) {
  if (!rows || !rows.length) return [];
  const idx = headerIndex(rows[0]);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r] || [];
    const get = (i) => (i >= 0 && c[i] != null ? String(c[i]).trim() : '');
    const address = [get(idx.a1), get(idx.a2)].filter(Boolean).join(' ');
    const row = { name: get(idx.name), address, city: get(idx.city), state: get(idx.state), zip: get(idx.zip), email: get(idx.email) };
    // Optional per-holder coverage — only set a field when its column exists in the sheet.
    for (const key of Object.keys(idx.cov)) {
      const i = idx.cov[key];
      if (i < 0) continue;
      const raw = get(i);
      if (CHECK_KEYS.includes(key)) row[key] = parseBool(raw);
      else if (key === 'contract') row[key] = parseContract(raw);
      else if (key === 'relationship') row[key] = parseRelationship(raw);
      else if (key === 'delivery') row[key] = parseDelivery(raw);
      else row[key] = raw; // *OtherText, additionalInfo
    }
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

module.exports = { HEADER_ALIASES, COVERAGE_ALIASES, normHeader, mapRows, parseCsvText, parseWorkbookBuffer, parseUpload };

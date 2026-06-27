'use strict';
// Server-side paged / searchable / sortable reads over the EXISTING duplicate tables, for the
// Phase 1 review pages. Read-only. `query` is injectable (defaults to the real DB) for testing.
//
// Safety: sort columns are whitelisted (never interpolated from raw input), page/size are clamped
// integers, and search/filter terms are bound as parameters. Result tables store everything as
// TEXT, so numeric sorts cast to UNSIGNED.
const { query: real_query } = require('./db');
const cfg = require('../../salesforce_duplicates/config');

const MAX_PAGE_SIZE = 200;

function clamp_int(v, def, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// Build the shared ORDER BY / LIMIT / WHERE-search pieces from a whitelist spec.
function build_clauses(opts, spec) {
  const page = clamp_int(opts.page, 1, 1, 1e9);
  const page_size = clamp_int(opts.page_size, 25, 1, MAX_PAGE_SIZE);
  const offset = (page - 1) * page_size;

  const wheres = [];
  const params = [];

  // search across the configured columns — split into words so a multi-word query like
  // "Victor Lopez" matches first_name "Victor" AND last_name "Lopez" (each word must hit some
  // column; words AND together, columns OR within a word).
  const q = (opts.q == null ? '' : String(opts.q)).trim();
  if (q && spec.search_cols.length) {
    for (const tok of q.split(/\s+/).filter(Boolean)) {
      wheres.push('(' + spec.search_cols.map((c) => '`' + c + '` LIKE ?').join(' OR ') + ')');
      for (const _ of spec.search_cols) params.push('%' + tok + '%');
    }
  }

  // optional extra equality filters: { col: value }
  for (const [col, val] of Object.entries(opts.filters || {})) {
    if (val == null || val === '') continue;
    if (!spec.filter_cols || !spec.filter_cols[col]) continue;
    wheres.push(spec.filter_cols[col].sql);
    if (spec.filter_cols[col].param !== undefined) params.push(spec.filter_cols[col].param(val));
  }

  // per-column "contains" filters: { uiKey: text } — whitelisted via spec.filter_map, bound as params
  for (const [key, val] of Object.entries(opts.colFilters || {})) {
    if (val == null || String(val).trim() === '') continue;
    if (!spec.filter_map || !spec.filter_map[key]) continue;
    wheres.push('`' + spec.filter_map[key] + '` LIKE ?');
    params.push('%' + String(val).trim() + '%');
  }

  const where_sql = wheres.length ? ('WHERE ' + wheres.join(' AND ')) : '';

  // sort: map UI key -> safe ORDER BY expression; default first whitelisted
  const sort_key = (opts.sort && spec.sort[opts.sort]) ? opts.sort : spec.default_sort;
  const dir = String(opts.dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const order_sql = 'ORDER BY ' + spec.sort[sort_key] + ' ' + dir;

  return { page, page_size, offset, where_sql, order_sql, params, sort_key, dir };
}

async function paged(table, spec, opts, query) {
  const { page, page_size, offset, where_sql, order_sql, params } = build_clauses(opts, spec);
  const total_rows = await query('SELECT COUNT(*) AS n FROM `' + table + '` ' + where_sql, params);
  const total = total_rows && total_rows[0] ? Number(total_rows[0].n) : 0;
  const rows = await query(
    'SELECT ' + spec.select + ' FROM `' + table + '` ' + where_sql + ' ' + order_sql + ' LIMIT ? OFFSET ?',
    params.concat([page_size, offset]));
  return { rows: rows || [], total, page, page_size };
}

// Distinct values for the low-cardinality columns, to populate header dropdown filters.
async function facets(view, query = real_query) {
  const spec = SPECS[view];
  if (!spec || !spec.facet_cols) return {};
  const out = {};
  for (const [key, col] of Object.entries(spec.facet_cols)) {
    try {
      const r = await query('SELECT `' + col + '` AS v FROM `' + spec.table + '` GROUP BY `' + col + '` ORDER BY `' + col + '` LIMIT 100', []);
      const vals = (r || []).map((x) => x.v).filter((v) => v !== null && v !== undefined && v !== '');
      const all_num = vals.length > 0 && vals.every((v) => /^\d+$/.test(String(v)));
      vals.sort(all_num ? (a, b) => Number(a) - Number(b) : undefined);   // numeric order for size, else lexical
      out[key] = vals;
    } catch (e) { /* missing table -> no facet for this column */ }
  }
  return out;
}

// ---- Duplicates (consolidated clusters) ----
const DUP_SPEC = {
  table: cfg.RESULT_CONSOLIDATED_TABLE,
  select: 'Consolidated_Group_Key__c AS `cluster`, Names_In_Group__c AS `names`, Group_Record_Count__c AS `size`, ' +
          'Match_Composition__c AS `signal`, Confidence_Tier__c AS `tier`, Merge_Ids__c AS `merge_ids`, Best_Pair_Score__c AS `best`',
  search_cols: ['Names_In_Group__c', 'Consolidated_Group_Key__c', 'Record_Ids__c', 'Group_Record_Count__c', 'Confidence_Tier__c'],
  sort: {
    cluster: 'Consolidated_Group_Key__c',
    names: 'Names_In_Group__c',
    size: 'CAST(Group_Record_Count__c AS UNSIGNED)',
    signal: 'Match_Composition__c',
    tier: 'Confidence_Tier__c',
    merge_ids: 'Merge_Ids__c',
    best: 'CAST(Best_Pair_Score__c AS UNSIGNED)',
  },
  filter_map: {
    cluster: 'Consolidated_Group_Key__c', names: 'Names_In_Group__c', size: 'Group_Record_Count__c',
    signal: 'Match_Composition__c', tier: 'Confidence_Tier__c', merge_ids: 'Merge_Ids__c', best: 'Best_Pair_Score__c',
  },
  facet_cols: { signal: 'Match_Composition__c', tier: 'Confidence_Tier__c', size: 'Group_Record_Count__c' },
  default_sort: 'size',
};
async function list_duplicates(opts = {}, query = real_query) {
  return paged(cfg.RESULT_CONSOLIDATED_TABLE, DUP_SPEC, { ...opts, dir: opts.dir || 'DESC' }, query);
}

// ---- Merge-ID review ----
const MR_SPEC = {
  table: cfg.RESULT_MERGE_ID_REVIEW_TABLE,
  select: 'Account__c AS `account`, First_Name__c AS `first_name`, Last_Name__c AS `last_name`, ' +
          'Salesforce_Merge_Id__c AS `merge_id`, Which_List__c AS `which_list`, Bucket__c AS `bucket`, ' +
          'Consolidated_Group_Key__c AS `cluster`',
  search_cols: ['Account__c', 'First_Name__c', 'Last_Name__c', 'Salesforce_Merge_Id__c', 'Which_List__c'],
  filter_cols: { bucket: { sql: 'Bucket__c = ?', param: (v) => String(v) } },
  sort: {
    account: 'Account__c',
    last_name: 'Last_Name__c',
    merge_id: 'Salesforce_Merge_Id__c',
    cluster: 'Consolidated_Group_Key__c',
    which_list: 'Which_List__c',
    bucket: 'Bucket__c',
  },
  filter_map: {
    account: 'Account__c', name: 'Last_Name__c', merge_id: 'Salesforce_Merge_Id__c',
    in_dupes: 'Consolidated_Group_Key__c', which_list: 'Which_List__c', bucket: 'Bucket__c',
  },
  facet_cols: { bucket: 'Bucket__c', which_list: 'Which_List__c' },
  default_sort: 'bucket',
};
async function list_merge_id(opts = {}, query = real_query) {
  return paged(cfg.RESULT_MERGE_ID_REVIEW_TABLE, MR_SPEC, opts, query);
}

// Bucket + duplicate-pair summary for the merge-id page header.
async function merge_id_summary(query = real_query) {
  const safe = async (sql) => { try { return await query(sql); } catch (e) { return null; } };
  const out = { buckets: [], pairs: { exact: 0, fuzzy: 0, nickname: 0, total: 0, clusters: 0 } };
  let r = await safe('SELECT Bucket__c AS bucket, COUNT(*) AS n FROM `' + cfg.RESULT_MERGE_ID_REVIEW_TABLE + '` GROUP BY Bucket__c');
  if (r) out.buckets = r.map((x) => ({ bucket: x.bucket, count: Number(x.n) }));
  r = await safe('SELECT COUNT(*) AS clusters, ' +
    'SUM(CAST(Exact_Link_Count__c AS UNSIGNED)) AS exact, ' +
    'SUM(CAST(Fuzzy_Link_Count__c AS UNSIGNED)) AS fuzzy, ' +
    'SUM(CAST(Nickname_Link_Count__c AS UNSIGNED)) AS nickname, ' +
    'SUM(CAST(Match_Link_Count__c AS UNSIGNED)) AS total FROM `' + cfg.RESULT_CONSOLIDATED_TABLE + '`');
  if (r && r[0]) out.pairs = {
    clusters: Number(r[0].clusters) || 0, exact: Number(r[0].exact) || 0,
    fuzzy: Number(r[0].fuzzy) || 0, nickname: Number(r[0].nickname) || 0, total: Number(r[0].total) || 0,
  };
  return out;
}

// ---- All accounts (snapshot) ----
const ACC_SPEC = {
  table: cfg.SNAPSHOT_TABLE_NAME,
  select: 'salesforce_account_id AS `account`, first_name, last_name, gender_identity AS `gender`, ' +
          'person_birthdate AS `birthdate`, composite_zip_five_digit AS `zip5`, member_number, ' +
          'salesforce_merge_id AS `merge_id`',
  search_cols: ['first_name', 'last_name', 'salesforce_account_id', 'member_number'],
  filter_cols: {
    has_merge_id: { sql: "salesforce_merge_id <> ''" },                 // value just needs to be truthy
  },
  sort: {
    account: 'salesforce_account_id',
    last_name: 'last_name',
    first_name: 'first_name',
    gender: 'gender_identity',
    birthdate: 'birthdate_normalized',
    zip5: 'composite_zip_five_digit',
    member_number: 'member_number',
    merge_id: 'salesforce_merge_id',
  },
  filter_map: {
    account: 'salesforce_account_id', name: 'last_name', gender: 'gender_identity',
    birthdate: 'person_birthdate', zip5: 'composite_zip_five_digit', member_number: 'member_number', merge_id: 'salesforce_merge_id',
  },
  facet_cols: { gender: 'gender_identity' },
  default_sort: 'last_name',
};
async function list_accounts(opts = {}, query = real_query) {
  return paged(cfg.SNAPSHOT_TABLE_NAME, ACC_SPEC, opts, query);
}

const SPECS = { duplicates: DUP_SPEC, 'merge-id': MR_SPEC, accounts: ACC_SPEC };

// Export: same WHERE/ORDER as the on-screen view (search + filters + sort), but no paging — all
// matching rows up to a safety cap. Used by the CSV / Excel download endpoints.
const EXPORT_MAX = 100000;
async function export_rows(view, opts = {}, query = real_query) {
  const spec = SPECS[view];
  if (!spec) return [];
  const o = { ...opts };
  if (view === 'duplicates' && !o.dir) o.dir = 'DESC';
  const { where_sql, order_sql, params } = build_clauses(o, spec);
  const rows = await query(
    'SELECT ' + spec.select + ' FROM `' + spec.table + '` ' + where_sql + ' ' + order_sql + ' LIMIT ' + EXPORT_MAX, params);
  return rows || [];
}

module.exports = {
  list_duplicates, list_merge_id, merge_id_summary, list_accounts, facets, export_rows,
  build_clauses, MAX_PAGE_SIZE, EXPORT_MAX, // exported for tests
};

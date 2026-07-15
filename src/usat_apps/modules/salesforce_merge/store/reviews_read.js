'use strict';
// Server-side paged / searchable / sortable reads over the EXISTING duplicate tables, for the
// Phase 1 review pages. Read-only. `query` is injectable (defaults to the real DB) for testing.
//
// Safety: sort columns are whitelisted (never interpolated from raw input), page/size are clamped
// integers, and search/filter terms are bound as parameters. Result tables store everything as
// TEXT, so numeric sorts cast to UNSIGNED.
const { query: real_query } = require('../../../store/db');
const cfg = require('../../../../salesforce_duplicates/config');

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

  // LIKE pattern. Specs with `prefix_search` use an anchored 'term%' so the query can use a
  // B-tree index (huge on the ~700k snapshot); others keep '%term%' contains-anywhere matching.
  // `contains_cols` opts specific columns out of the prefix rule (e.g. email, match_composition)
  // so free-text fields still match anywhere.
  const contains = new Set(spec.contains_cols || []);
  const like = (v, col) => ((spec.prefix_search && !(col && contains.has(col))) ? v + '%' : '%' + v + '%');

  // search across the configured columns — split into words so a multi-word query like
  // "Victor Lopez" matches first_name "Victor" AND last_name "Lopez" (each word must hit some
  // column; words AND together, columns OR within a word).
  const q = (opts.q == null ? '' : String(opts.q)).trim();
  if (q && spec.search_cols.length) {
    for (const tok of q.split(/\s+/).filter(Boolean)) {
      wheres.push('(' + spec.search_cols.map((c) => '`' + c + '` LIKE ?').join(' OR ') + ')');
      for (const c of spec.search_cols) params.push(like(tok, c));
    }
  }

  // optional extra equality / group filters: { col: value }. A filter spec is either
  //   { sql, param? }                       static WHERE (optionally one bound param), or
  //   { build(val) -> { sql, params? } }     value-dependent WHERE (e.g. a NOT IN group).
  for (const [col, val] of Object.entries(opts.filters || {})) {
    if (val == null || val === '') continue;
    const fc = spec.filter_cols && spec.filter_cols[col];
    if (!fc) continue;
    if (typeof fc.build === 'function') {
      const b = fc.build(val);
      if (b && b.sql) { wheres.push(b.sql); for (const p of (b.params || [])) params.push(p); }
    } else {
      wheres.push(fc.sql);
      if (fc.param !== undefined) params.push(fc.param(val));
    }
  }

  // per-column "contains" filters: { uiKey: text } — whitelisted via spec.filter_map, bound as params
  for (const [key, val] of Object.entries(opts.colFilters || {})) {
    if (val == null || String(val).trim() === '') continue;
    const fm = spec.filter_map && spec.filter_map[key];
    if (!fm) continue;
    // a filter_map entry is a column name (backticked) or { expr } for a raw SQL expression
    const col_name = (typeof fm === 'object' && fm.expr) ? null : fm;
    const expr = col_name ? ('`' + fm + '`') : fm.expr;
    wheres.push(expr + ' LIKE ?');
    params.push(like(String(val).trim(), col_name));
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
  for (const [key, def] of Object.entries(spec.facet_cols)) {
    const col = (typeof def === 'object' && def.col) ? def.col : def;
    const table = (typeof def === 'object' && def.table) ? def.table : spec.table;
    try {
      const r = await query('SELECT `' + col + '` AS v FROM `' + table + '` GROUP BY `' + col + '` ORDER BY `' + col + '` LIMIT 100', []);
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
  // does the cluster carry any merge ID / member number? ('has' / 'none'; strip ';' separators)
  filter_cols: {
    merge_id_state: { build: (v) => (String(v) === 'has' ? { sql: "REPLACE(Merge_Ids__c, ';', '') <> ''" }
      : String(v) === 'none' ? { sql: "(Merge_Ids__c IS NULL OR REPLACE(Merge_Ids__c, ';', '') = '')" } : null) },
    member_number_state: { build: (v) => (String(v) === 'has' ? { sql: "REPLACE(Member_Numbers__c, ';', '') <> ''" }
      : String(v) === 'none' ? { sql: "(Member_Numbers__c IS NULL OR REPLACE(Member_Numbers__c, ';', '') = '')" } : null) },
    // does any member of the cluster carry a Foundation constituent flag? (values are ';'-joined true/false)
    foundation_state: { build: (v) => (String(v) === 'has' ? { sql: "Foundation_Constituents__c LIKE '%true%'" }
      : String(v) === 'none' ? { sql: "(Foundation_Constituents__c IS NULL OR Foundation_Constituents__c NOT LIKE '%true%')" } : null) },
    // exact cluster size (e.g. only pairs = 2). Numeric equality on the record count.
    size_eq: { build: (v) => (/^\d+$/.test(String(v).trim()) ? { sql: 'CAST(Group_Record_Count__c AS UNSIGNED) = ?', params: [Number(String(v).trim())] } : null) },
    // match type: keep clusters whose composition INVOLVES the chosen signal ("exact"/"fuzzy"/
    // "nickname"). Match_Composition__c is a label like "exact only" / "exact + nickname", so a
    // contains match catches every cluster that used that signal at all.
    match_type: { build: (v) => { const t = String(v).trim().toLowerCase(); return (t === 'exact' || t === 'fuzzy' || t === 'nickname') ? { sql: 'Match_Composition__c LIKE ?', params: ['%' + t + '%'] } : null; } },
    // minimum best name-similarity score (0–100) among the cluster's pairs — the "Best" column.
    best_min: { build: (v) => (/^\d+$/.test(String(v).trim()) ? { sql: 'CAST(Best_Pair_Score__c AS UNSIGNED) >= ?', params: [Number(String(v).trim())] } : null) },
    // confidence tier — the cluster's single strongest signal (exact > fuzzy > nickname). Mirrors the
    // Duplicates tab's "Tier" column (exact equality, unlike Signal which is a contains/involves match).
    tier: { build: (v) => { const t = String(v).trim().toLowerCase(); return (t === 'exact' || t === 'fuzzy' || t === 'nickname') ? { sql: 'LOWER(Confidence_Tier__c) = ?', params: [t] } : null; } },
  },
  facet_cols: { signal: 'Match_Composition__c', tier: 'Confidence_Tier__c', size: 'Group_Record_Count__c' },
  default_sort: 'size',
};
async function list_duplicates(opts = {}, query = real_query) {
  return paged(cfg.RESULT_CONSOLIDATED_TABLE, DUP_SPEC, { ...opts, dir: opts.dir || 'DESC' }, query);
}

// The consolidated result table is rebuilt each finder run with no indexes, but the merge-id size
// lookup and the cluster popup both filter it by Consolidated_Group_Key__c. Make sure that column
// is indexed — cheap + idempotent (checked per call so it self-heals after a data refresh). Falls
// back silently to the (slower) unindexed path if the table is missing or DDL isn't permitted.
let _ensuring_idx = null;
async function ensure_cluster_index(query) {
  if (_ensuring_idx) return _ensuring_idx;
  _ensuring_idx = (async () => {
    try {
      const r = await query("SHOW INDEX FROM `" + cfg.RESULT_CONSOLIDATED_TABLE + "` WHERE Key_name = 'idx_cc_group_key'", []);
      if (!r || r.length === 0) {
        await query('CREATE INDEX idx_cc_group_key ON `' + cfg.RESULT_CONSOLIDATED_TABLE + '` (Consolidated_Group_Key__c(100))', []);
      }
    } catch (e) { _ensuring_idx = null; }   // allow a retry next call (e.g. table rebuilt by a refresh)
  })();
  return _ensuring_idx;
}

// ---- Merge-ID review ----
const MR_SPEC = {
  table: cfg.RESULT_MERGE_ID_REVIEW_TABLE,
  // `size` (cluster size) is NOT selected here — it lives in the consolidated table, and a
  // per-row correlated subquery made the listing scan it repeatedly. list_merge_id() attaches it
  // to the page rows with one small lookup instead (so size is display-only, not SQL-sortable).
  select: 'Account__c AS `account`, First_Name__c AS `first_name`, Last_Name__c AS `last_name`, ' +
          'Salesforce_Merge_Id__c AS `merge_id`, Which_List__c AS `which_list`, Bucket__c AS `bucket`, ' +
          'Foundation_Constituent__c AS `foundation`, Consolidated_Group_Key__c AS `cluster`',
  search_cols: ['Account__c', 'First_Name__c', 'Last_Name__c', 'Salesforce_Merge_Id__c', 'Which_List__c'],
  // bucket filter mirrors the funnel: 'only_dupes' = flagged by us with no merge ID (every
  // non in_both / sf_only bucket); any other value is an exact bucket match.
  filter_cols: {
    bucket: {
      build: (v) => (String(v) === 'only_dupes'
        ? { sql: "Bucket__c NOT IN ('in_both', 'sf_only')" }
        : { sql: 'Bucket__c = ?', params: [String(v)] }),
    },
    // size filter is translated (in list_merge_id) into the set of cluster keys of that size
    cluster_in: {
      build: (keys) => {
        const arr = Array.isArray(keys) ? keys : [];
        if (!arr.length) return { sql: '1 = 0' };   // a size with no matching clusters -> empty
        return { sql: 'Consolidated_Group_Key__c IN (' + arr.map(() => '?').join(', ') + ')', params: arr };
      },
    },
    // 'has' / 'none' on the account's Foundation constituent flag (per-row true/false)
    foundation_state: { build: (v) => (String(v) === 'has' ? { sql: "Foundation_Constituent__c LIKE 'true%'" }
      : String(v) === 'none' ? { sql: "(Foundation_Constituent__c IS NULL OR Foundation_Constituent__c NOT LIKE 'true%')" } : null) },
  },
  sort: {
    account: 'Account__c',
    last_name: 'Last_Name__c',
    merge_id: 'Salesforce_Merge_Id__c',
    cluster: 'Consolidated_Group_Key__c',
    which_list: 'Which_List__c',
    bucket: 'Bucket__c',
    foundation: 'Foundation_Constituent__c',
  },
  filter_map: {
    account: 'Account__c', name: 'Last_Name__c', merge_id: 'Salesforce_Merge_Id__c',
    in_dupes: 'Consolidated_Group_Key__c', which_list: 'Which_List__c', bucket: 'Bucket__c',
    foundation: 'Foundation_Constituent__c',
  },
  facet_cols: { bucket: 'Bucket__c', which_list: 'Which_List__c', foundation: 'Foundation_Constituent__c', size: { col: 'Group_Record_Count__c', table: cfg.RESULT_CONSOLIDATED_TABLE } },
  default_sort: 'bucket',
};
async function list_merge_id(opts = {}, query = real_query) {
  await ensure_cluster_index(query);
  const o = { ...opts, colFilters: { ...(opts.colFilters || {}) } };
  // Size filter (snappy): resolve the chosen cluster size to its cluster keys, then filter merge-id
  // rows by those keys — no per-row subquery/join. (Size stays display-only for sorting.)
  const sizeSel = o.colFilters.size;
  delete o.colFilters.size;
  if (sizeSel != null && String(sizeSel).trim() !== '') {
    const kr = await query('SELECT Consolidated_Group_Key__c AS k FROM `' + cfg.RESULT_CONSOLIDATED_TABLE +
      '` WHERE Group_Record_Count__c = ?', [String(sizeSel).trim()]);
    o.filters = { ...(o.filters || {}), cluster_in: (kr || []).map((r) => r.k).filter(Boolean) };
  }
  const res = await paged(cfg.RESULT_MERGE_ID_REVIEW_TABLE, MR_SPEC, o, query);
  // Attach each row's cluster size with ONE lookup over the page's cluster keys (<= page_size).
  const keys = [...new Set(res.rows.map((r) => r.cluster).filter(Boolean))];
  if (keys.length) {
    const ph = keys.map(() => '?').join(', ');
    const sizes = await query('SELECT Consolidated_Group_Key__c AS k, Group_Record_Count__c AS n FROM `' +
      cfg.RESULT_CONSOLIDATED_TABLE + '` WHERE Consolidated_Group_Key__c IN (' + ph + ')', keys);
    const m = new Map((sizes || []).map((x) => [x.k, x.n]));
    for (const r of res.rows) r.size = (r.cluster && m.has(r.cluster)) ? m.get(r.cluster) : null;
  }
  return res;
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
  prefix_search: true,   // 'term%' so name/ID search uses the snapshot's B-tree indexes (~700k rows)
  select: 'salesforce_account_id AS `account`, first_name, last_name, gender_identity AS `gender`, ' +
          'person_birthdate AS `birthdate`, composite_zip_five_digit AS `zip5`, member_number, ' +
          'salesforce_merge_id AS `merge_id`, match_composition, email, foundation_constituent, created_date, created_by_name',
  // global search hits names/ID/member (prefix, indexed) plus email + match_composition (contains).
  search_cols: ['first_name', 'last_name', 'salesforce_account_id', 'member_number', 'email', 'match_composition'],
  contains_cols: ['email', 'match_composition', 'created_by_name', 'created_date'],
  filter_cols: {
    has_merge_id: { sql: "salesforce_merge_id <> ''" },                 // legacy truthy toggle (kept)
    has_member_number: { sql: "member_number <> ''" },
    // 3-state selectors: 'has' / 'none' (blank/'all' -> no filter)
    merge_id_state: { build: (v) => (String(v) === 'has' ? { sql: "salesforce_merge_id <> ''" }
      : String(v) === 'none' ? { sql: "(salesforce_merge_id IS NULL OR salesforce_merge_id = '')" } : null) },
    member_number_state: { build: (v) => (String(v) === 'has' ? { sql: "member_number <> ''" }
      : String(v) === 'none' ? { sql: "(member_number IS NULL OR member_number = '')" } : null) },
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
    match_composition: 'match_composition',
    email: 'email',
    foundation_constituent: 'foundation_constituent',
    created_date: 'created_date',
    created_by_name: 'created_by_name',
  },
  filter_map: {
    account: 'salesforce_account_id', name: 'last_name', gender: 'gender_identity',
    birthdate: 'person_birthdate', zip5: 'composite_zip_five_digit', member_number: 'member_number', merge_id: 'salesforce_merge_id',
    match_composition: 'match_composition', email: 'email', foundation_constituent: 'foundation_constituent',
    created_date: 'created_date', created_by_name: 'created_by_name',
  },
  facet_cols: { gender: 'gender_identity', match_composition: 'match_composition', foundation_constituent: 'foundation_constituent' },
  default_sort: 'last_name',
};
async function list_accounts(opts = {}, query = real_query) {
  return paged(cfg.SNAPSHOT_TABLE_NAME, ACC_SPEC, opts, query);
}

// Members of one consolidated cluster: look up the cluster's Record_Ids__c, then fetch those
// accounts from the snapshot by primary key (fast IN-list). Powers the Duplicates "view group" popup.
async function cluster_accounts(key, query = real_query) {
  if (!key) return { key, accounts: [] };
  await ensure_cluster_index(query);
  const cl = await query('SELECT Record_Ids__c AS ids FROM `' + cfg.RESULT_CONSOLIDATED_TABLE +
    '` WHERE Consolidated_Group_Key__c = ? LIMIT 1', [String(key)]);
  if (!cl || !cl[0]) return { key, accounts: [] };
  const ids = String(cl[0].ids || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return { key, accounts: [] };
  const placeholders = ids.map(() => '?').join(', ');
  const accounts = await query('SELECT ' + ACC_SPEC.select + ' FROM `' + cfg.SNAPSHOT_TABLE_NAME +
    '` WHERE salesforce_account_id IN (' + placeholders + ')', ids);
  return { key, accounts: accounts || [] };
}

// ---- Merge-ID groups (Merge Admin source): one row per distinct Salesforce merge id ----
// Only accounts that HAVE a merge id are listed. Bucket filter mirrors the merge-id review panel
// (the buckets with a merge id: in_both / id only [sf_only]).
async function list_merge_groups(opts = {}, query = real_query) {
  const page = clamp_int(opts.page, 1, 1, 1e9);
  const page_size = clamp_int(opts.page_size, 25, 1, MAX_PAGE_SIZE);
  const offset = (page - 1) * page_size;
  const T = cfg.RESULT_MERGE_ID_REVIEW_TABLE;
  const wheres = ["Salesforce_Merge_Id__c IS NOT NULL", "Salesforce_Merge_Id__c <> ''"];
  const params = [];
  const qstr = (opts.q == null ? '' : String(opts.q)).trim();
  if (qstr) {
    for (const tok of qstr.split(/\s+/).filter(Boolean)) {
      wheres.push("(First_Name__c LIKE ? OR Last_Name__c LIKE ? OR Salesforce_Merge_Id__c LIKE ?)");
      params.push("%" + tok + "%", "%" + tok + "%", "%" + tok + "%");
    }
  }
  const bk = opts.bucket;
  if (bk === "in_both" || bk === "sf_only") { wheres.push("Bucket__c = ?"); params.push(bk); }
  else if (bk === "only_dupes") { wheres.push("Bucket__c NOT IN ('in_both', 'sf_only')"); }
  const where_sql = "WHERE " + wheres.join(" AND ");
  // group-level filters run as HAVING over the GROUP BY, not a row WHERE:
  //  · foundation: keep groups where ANY (has) / NO (none) account is a Foundation constituent.
  //  · size: the group's member count (COUNT(*)) equals the chosen cluster size.
  const havings = [];
  const fnd = String(opts.foundation_state || '');
  if (fnd === 'has') havings.push("SUM(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END) > 0");
  else if (fnd === 'none') havings.push("SUM(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END) = 0");
  const sz = String(opts.size == null ? '' : opts.size).trim();
  if (/^\d+$/.test(sz)) havings.push("COUNT(*) = " + Number(sz));
  //  · which list (detection signal): keep groups where ANY member was flagged by the chosen signal.
  //    Mirrors the Merge-ID tab's "Which list" column filter (contains match). `wl` is validated to a
  //    fixed set, so the inlined LIKE is injection-safe.
  const wl = String(opts.which_list || '').trim().toLowerCase();
  if (wl === 'exact' || wl === 'fuzzy' || wl === 'nickname') {
    havings.push("SUM(CASE WHEN Which_List__c LIKE '%" + wl + "%' THEN 1 ELSE 0 END) > 0");
  }
  const fnd_having = havings.length ? (" HAVING " + havings.join(" AND ")) : '';
  const totalRows = await query(
    fnd_having
      ? "SELECT COUNT(*) AS n FROM (SELECT Salesforce_Merge_Id__c FROM `" + T + "` " + where_sql + " GROUP BY Salesforce_Merge_Id__c" + fnd_having + ") x"
      : "SELECT COUNT(DISTINCT Salesforce_Merge_Id__c) AS n FROM `" + T + "` " + where_sql, params);
  const total = totalRows && totalRows[0] ? Number(totalRows[0].n) : 0;
  const rows = await query(
    "SELECT Salesforce_Merge_Id__c AS `merge_id`, " +
    "GROUP_CONCAT(DISTINCT NULLIF(TRIM(CONCAT(COALESCE(First_Name__c, ''), ' ', COALESCE(Last_Name__c, ''))), '') SEPARATOR ';') AS `names`, " +
    "COUNT(*) AS `size`, MIN(Consolidated_Group_Key__c) AS `cluster_key` " +
    "FROM `" + T + "` " + where_sql +
    " GROUP BY Salesforce_Merge_Id__c" + fnd_having + " ORDER BY COUNT(*) DESC, Salesforce_Merge_Id__c ASC LIMIT ? OFFSET ?",
    params.concat([page_size, offset]));
  const out = (rows || []).map((r) => ({
    cluster: r.merge_id, merge_id: r.merge_id, names: r.names || '',
    size: Number(r.size) || 0, signal: "merge id", cluster_key: r.cluster_key || '',
  }));
  return { rows: out, total, page, page_size };
}

async function merge_group_account_ids(merge_id, query = real_query) {
  if (!merge_id) return [];
  const rows = await query("SELECT Account__c AS account FROM `" + cfg.RESULT_MERGE_ID_REVIEW_TABLE +
    "` WHERE Salesforce_Merge_Id__c = ?", [String(merge_id)]);
  return (rows || []).map((r) => r.account).filter(Boolean);
}

// Resolve survivor + losers for every merge-id group matching a filter (q + bucket) or an explicit
// list of merge ids. Survivor cascade (DB-only steps): 1) account whose Salesforce Id equals the
// merge id; 2) lowest membership number among the group. Steps 3 (most children) and 4 (oldest)
// need Salesforce, so bulk leaves those unresolvable for single review. Pure DB.
// Shared survivor cascade for BULK queueing (both merge-id and duplicate groups). Resolves the two
// steps that need no Salesforce call: (1) the account whose id equals the group's merge id; else
// (2) the lowest membership number. Returns { survivor:null } when neither applies — those groups need
// the child-count/oldest tie-break and are left for single review. `mergeIdOf`/`memberOf` are accessors
// so each caller supplies values from its own data source (review table vs consolidated + snapshot).
function pick_bulk_survivor(accts, mergeIdOf, memberOf) {
  const gm = accts.map((a) => String(mergeIdOf(a) || '').trim()).find(Boolean) || '';
  if (gm && accts.includes(gm)) return { survivor: gm, rule: 'merge_id' };
  const withMem = accts.filter((a) => { const v = memberOf(a); return v != null && String(v).trim() !== ''; });
  if (withMem.length) {
    const survivor = withMem.reduce((best, a) => {
      const va = Number(memberOf(a)); const vb = Number(memberOf(best));
      return (Number.isFinite(va) && (!Number.isFinite(vb) || va < vb)) ? a : best;
    }, withMem[0]);
    return { survivor, rule: 'member_number' };
  }
  return { survivor: null, rule: null };
}

async function resolve_merge_groups(opts = {}, query = real_query) {
  const T = cfg.RESULT_MERGE_ID_REVIEW_TABLE;
  const wheres = ["Salesforce_Merge_Id__c IS NOT NULL", "Salesforce_Merge_Id__c <> ''"];
  const params = [];
  const qstr = (opts.q == null ? '' : String(opts.q)).trim();
  if (qstr) {
    for (const tok of qstr.split(/\s+/).filter(Boolean)) {
      wheres.push("(First_Name__c LIKE ? OR Last_Name__c LIKE ? OR Salesforce_Merge_Id__c LIKE ?)");
      params.push("%" + tok + "%", "%" + tok + "%", "%" + tok + "%");
    }
  }
  const bk = opts.bucket;
  if (bk === "in_both" || bk === "sf_only") { wheres.push("Bucket__c = ?"); params.push(bk); }
  else if (bk === "only_dupes") { wheres.push("Bucket__c NOT IN ('in_both', 'sf_only')"); }
  const keys = Array.isArray(opts.keys) ? opts.keys.map(String).filter(Boolean) : null;
  if (keys && keys.length) { wheres.push("Salesforce_Merge_Id__c IN (" + keys.map(() => "?").join(", ") + ")"); for (const k of keys) params.push(k); }
  const where_sql = "WHERE " + wheres.join(" AND ");
  const rows = await query("SELECT Salesforce_Merge_Id__c AS merge_id, Account__c AS account, First_Name__c AS first_name, Last_Name__c AS last_name, Foundation_Constituent__c AS foundation, Which_List__c AS which_list FROM `" + T + "` " + where_sql, params);
  const byId = new Map(); const allIds = new Set(); const nameMap = new Map(); const fnd_groups = new Set(); const wl_groups = new Set();
  const wlWant = String(opts.which_list || '').trim().toLowerCase();
  for (const row of (rows || [])) {
    if (!row.merge_id || !row.account) continue;
    if (!byId.has(row.merge_id)) byId.set(row.merge_id, []);
    byId.get(row.merge_id).push(row.account); allIds.add(row.account);
    nameMap.set(row.account, ((row.first_name || '') + ' ' + (row.last_name || '')).trim());
    if (String(row.foundation || '').toLowerCase().startsWith('true')) fnd_groups.add(row.merge_id);
    if (wlWant && String(row.which_list || '').toLowerCase().includes(wlWant)) wl_groups.add(row.merge_id);
  }
  // group-level foundation filter: keep groups with ANY (has) / NO (none) Foundation constituent.
  const fnd = String(opts.foundation_state || '');
  if (fnd === 'has' || fnd === 'none') {
    for (const mid of [...byId.keys()]) {
      const hit = fnd_groups.has(mid);
      if ((fnd === 'has' && !hit) || (fnd === 'none' && hit)) byId.delete(mid);
    }
  }
  // group-level which-list filter: keep groups where ANY member was flagged by the chosen signal.
  if (wlWant === 'exact' || wlWant === 'fuzzy' || wlWant === 'nickname') {
    for (const mid of [...byId.keys()]) { if (!wl_groups.has(mid)) byId.delete(mid); }
  }
  // group-level size filter: keep groups whose member count equals the chosen size.
  const bulkSz = String(opts.size == null ? '' : opts.size).trim();
  if (/^\d+$/.test(bulkSz)) {
    const want = Number(bulkSz);
    for (const [mid, accts] of [...byId]) { if (accts.length !== want) byId.delete(mid); }
  }
  const memMap = new Map(); const ids = [...allIds];
  for (let k = 0; k < ids.length; k += 1000) {
    const chunk = ids.slice(k, k + 1000);
    const ph = chunk.map(() => "?").join(", ");
    const mrows = await query("SELECT salesforce_account_id AS account, member_number FROM `" + cfg.SNAPSHOT_TABLE_NAME + "` WHERE salesforce_account_id IN (" + ph + ")", chunk);
    for (const m of (mrows || [])) memMap.set(m.account, m.member_number);
  }
  const out = [];
  for (const [mid, accts] of byId) {
    const { survivor, rule } = pick_bulk_survivor(accts, () => mid, (a) => memMap.get(a));
    const losers = survivor ? accts.filter((a) => a !== survivor) : [];
    out.push({ merge_id: mid, survivor, name: survivor ? (nameMap.get(survivor) || '') : '', losers, rule, resolvable: !!survivor && losers.length > 0 });
  }
  return out;
}

// Bulk survivor resolution for DUPLICATE groups (consolidated clusters), mirroring resolve_merge_groups.
// Resolves the survivor from the DB via the cascade steps that don't need Salesforce: (1) the account
// whose id equals the group's merge id, else (2) the lowest membership number. Clusters that would need
// the child-count or oldest tie-break are left NOT resolvable (skipped for single review) — same policy
// as the merge-id bulk. `keys` = specific cluster keys, else all clusters matching the list filter.
async function resolve_duplicate_groups(opts = {}, query = real_query) {
  const T = cfg.RESULT_CONSOLIDATED_TABLE;
  let rows;
  if (Array.isArray(opts.keys) && opts.keys.length) {
    const ph = opts.keys.map(() => '?').join(', ');
    rows = await query('SELECT Consolidated_Group_Key__c AS `key`, Record_Ids__c AS ids FROM `' + T + '` WHERE Consolidated_Group_Key__c IN (' + ph + ')', opts.keys.map(String));
  } else {
    const { where_sql, params } = build_clauses(opts, DUP_SPEC);
    rows = await query('SELECT Consolidated_Group_Key__c AS `key`, Record_Ids__c AS ids FROM `' + T + '` ' + where_sql + ' LIMIT 5000', params);
  }
  const clusters = (rows || []).map((r) => ({ key: r.key, ids: String(r.ids || '').split(';').map((s) => s.trim()).filter(Boolean) })).filter((c) => c.ids.length > 1);
  const allIds = [...new Set(clusters.flatMap((c) => c.ids))];
  const info = new Map();
  for (let k = 0; k < allIds.length; k += 1000) {
    const chunk = allIds.slice(k, k + 1000);
    const ph = chunk.map(() => '?').join(', ');
    const irows = await query('SELECT salesforce_account_id AS account, salesforce_merge_id AS merge_id, member_number, first_name, last_name FROM `' + cfg.SNAPSHOT_TABLE_NAME + '` WHERE salesforce_account_id IN (' + ph + ')', chunk);
    for (const r of (irows || [])) info.set(r.account, r);
  }
  const out = [];
  for (const c of clusters) {
    const accts = c.ids.filter((a) => info.has(a));
    const { survivor, rule } = pick_bulk_survivor(accts, (a) => info.get(a).merge_id, (a) => info.get(a).member_number);
    const losers = survivor ? accts.filter((a) => a !== survivor) : [];
    const nm = survivor ? ((info.get(survivor).first_name || '') + ' ' + (info.get(survivor).last_name || '')).trim() : '';
    out.push({ source_key: c.key, survivor, name: nm, losers, rule, resolvable: !!survivor && losers.length > 0 });
  }
  return out;
}

async function accounts_by_ids(ids, query = real_query) {
  const list = (ids || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return [];
  const ph = list.map(() => "?").join(", ");
  const rows = await query("SELECT " + ACC_SPEC.select + " FROM `" + cfg.SNAPSHOT_TABLE_NAME +
    "` WHERE salesforce_account_id IN (" + ph + ")", list);
  return rows || [];
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
  list_duplicates, list_merge_id, merge_id_summary, list_accounts, cluster_accounts, facets, export_rows,
  list_merge_groups, merge_group_account_ids, accounts_by_ids, resolve_merge_groups, resolve_duplicate_groups, pick_bulk_survivor,
  build_clauses, MAX_PAGE_SIZE, EXPORT_MAX, // exported for tests
};

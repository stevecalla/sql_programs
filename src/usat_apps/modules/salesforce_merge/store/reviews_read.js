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
    const term = String(val).trim();
    // { eq: 'col' } — exact, index-friendly match (e.g. numeric match_score); no LIKE scan.
    if (typeof fm === 'object' && fm.eq) { wheres.push('`' + fm.eq + '` = ?'); params.push(term); continue; }
    // a filter_map entry is a column name (backticked) or { expr } for a raw SQL expression
    const col_name = (typeof fm === 'object' && fm.expr) ? null : fm;
    const expr = col_name ? ('`' + fm + '`') : fm.expr;
    wheres.push(expr + ' LIKE ?');
    params.push(like(term, col_name));
  }

  // Queue filter (staged/unstaged) — same shared SQL predicate the merge-id view + sampler use. Only
  // specs that expose a group-key column (spec.queue_key) support it; others ignore queue_filter.
  let join_sql = '';
  const qj = spec.queue_key ? queue_join('`' + spec.queue_key + '`', opts.queue_filter) : null;
  if (qj) { join_sql = qj.join; wheres.push(qj.cond); }

  const where_sql = wheres.length ? ('WHERE ' + wheres.join(' AND ')) : '';

  // sort: map UI key -> safe ORDER BY expression; default first whitelisted
  const sort_key = (opts.sort && spec.sort[opts.sort]) ? opts.sort : spec.default_sort;
  const dir = String(opts.dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const order_sql = 'ORDER BY ' + spec.sort[sort_key] + ' ' + dir;

  return { page, page_size, offset, where_sql, join_sql, order_sql, params, sort_key, dir };
}

async function paged(table, spec, opts, query) {
  const { page, page_size, offset, where_sql, join_sql, order_sql, params } = build_clauses(opts, spec);
  const total_rows = await query('SELECT COUNT(*) AS n FROM `' + table + '` ' + join_sql + ' ' + where_sql, params);
  const total = total_rows && total_rows[0] ? Number(total_rows[0].n) : 0;
  const rows = await query(
    'SELECT ' + spec.select + ' FROM `' + table + '` ' + join_sql + ' ' + where_sql + ' ' + order_sql + ' LIMIT ? OFFSET ?',
    params.concat([page_size, offset]));
  return { rows: rows || [], total, page, page_size };
}

// Distinct values for the low-cardinality columns, to populate header dropdown filters. `opts` carries the
// currently-active filters so the SIZE facet counts scope to them (e.g. Bucket = ID only -> only sf_only
// groups). The other (option-only) facets stay global.
async function facets(view, opts = {}, query = real_query) {
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
  // Size dropdown as labeled { value, label } options with a count per size (Def B), SCOPED to the active
  // filters so the counts match the list (e.g. Bucket = ID only -> "2 accounts (7 groups)"). Merge-id sizes
  // are accounts-per-merge-id (incl. 1 = singletons); duplicates are cluster sizes.
  try {
    if (view === 'merge-id') {
      const g = merge_group_clauses({ ...flatten_mergeid_opts(opts), all_sizes: true });   // count every size, scoped
      const r = await query("SELECT cnt AS size, COUNT(*) AS n FROM (SELECT COUNT(*) AS cnt FROM `" + g.T + "`" +
        g.join_sql + " " + g.where_sql + " GROUP BY Salesforce_Merge_Id__c" + g.having_sql + ") x GROUP BY cnt ORDER BY cnt", g.params);
      out.size = (r || []).map((x) => { const s = Number(x.size), n = Number(x.n); const u = s === 1 ? ('singleton' + (n === 1 ? '' : 's')) : ('group' + (n === 1 ? '' : 's')); return { value: String(s), label: s + ' account' + (s === 1 ? '' : 's') + ' (' + n.toLocaleString() + ' ' + u + ')' }; });
    } else if (view === 'duplicates') {
      const c = build_clauses({ ...opts, page: 1, page_size: 1 }, DUP_SPEC);   // scope by the duplicate filters
      const r = await query('SELECT CAST(Group_Record_Count__c AS UNSIGNED) AS size, COUNT(*) AS n FROM `' +
        cfg.RESULT_CONSOLIDATED_TABLE + '` ' + c.join_sql + ' ' + c.where_sql + ' GROUP BY size ORDER BY size', c.params);
      out.size = (r || []).map((x) => { const s = Number(x.size), n = Number(x.n); return { value: String(s), label: s + ' accounts (' + n.toLocaleString() + ' cluster' + (n === 1 ? '' : 's') + ')' }; });
    }
  } catch (e) { /* size facet optional */ }

  // Categorical filter dropdowns get a live group COUNT per option, each scoped to the OTHER active filters
  // (the option's own dimension is excluded, same as the size facet). Namespaced under `filter_counts` so
  // they don't clobber the raw scalar facets the DataTable column filters use. Labeled { value, label }.
  const fc = (out.filter_counts = {});
  if (view === 'merge-id') {
    const base = flatten_mergeid_opts(opts);
    // Bucket (row-level): distinct merge IDs per bucket, scoped to the other filters.
    try {
      const c = merge_group_clauses({ ...base, bucket: undefined });
      const r = await query("SELECT Bucket__c AS v, COUNT(DISTINCT Salesforce_Merge_Id__c) AS n FROM `" + c.T + "`" + c.join_sql + " " + c.where_sql + " GROUP BY Bucket__c", c.params);
      const m = {}; for (const x of (r || [])) m[x.v] = Number(x.n);
      fc.bucket = [{ value: '', label: 'All' }, { value: 'in_both', label: 'In both (' + (m.in_both || 0).toLocaleString() + ')' }, { value: 'sf_only', label: 'ID only (' + (m.sf_only || 0).toLocaleString() + ')' }];
    } catch (e) { /* optional */ }
    // Group-level has/none facets (foundation, portal): count groups where ANY member carries the flag.
    const hasNone = async (excludeKey, expr, hasLabel, noneLabel) => {
      const c = merge_group_clauses({ ...base, [excludeKey]: undefined });
      const r = await query("SELECT SUM(g > 0) AS h, SUM(g = 0) AS z FROM (SELECT " + expr + " AS g FROM `" + c.T + "`" + c.join_sql + " " + c.where_sql + " GROUP BY Salesforce_Merge_Id__c" + c.having_sql + ") x", c.params);
      const h = Number((r && r[0] && r[0].h) || 0), z = Number((r && r[0] && r[0].z) || 0);
      return [{ value: '', label: 'All' }, { value: 'has', label: hasLabel + ' (' + h.toLocaleString() + ')' }, { value: 'none', label: noneLabel + ' (' + z.toLocaleString() + ')' }];
    };
    try { fc.foundation_state =await hasNone('foundation_state', "SUM(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END)", 'Is foundation', 'Not foundation'); } catch (e) { /* optional */ }
    try { fc.portal_state =await hasNone('portal_state', "SUM(CASE WHEN Is_Customer_Portal__c = '1' THEN 1 ELSE 0 END)", 'Has portal', 'No portal'); } catch (e) { /* optional */ }
    // Which list (per-signal): groups where ANY member was flagged by that signal.
    try {
      const c = merge_group_clauses({ ...base, which_list: undefined });
      const r = await query("SELECT SUM(ex) AS ex, SUM(fz) AS fz, SUM(nk) AS nk FROM (SELECT " +
        "MAX(Which_List__c LIKE '%exact%') AS ex, MAX(Which_List__c LIKE '%fuzzy%') AS fz, MAX(Which_List__c LIKE '%nickname%') AS nk " +
        "FROM `" + c.T + "`" + c.join_sql + " " + c.where_sql + " GROUP BY Salesforce_Merge_Id__c" + c.having_sql + ") x", c.params);
      const w = (r && r[0]) || {};
      fc.which_list = [{ value: '', label: 'Any list' }, { value: 'exact', label: 'Exact (' + Number(w.ex || 0).toLocaleString() + ')' }, { value: 'fuzzy', label: 'Fuzzy (' + Number(w.fz || 0).toLocaleString() + ')' }, { value: 'nickname', label: 'Nickname (' + Number(w.nk || 0).toLocaleString() + ')' }];
    } catch (e) { /* optional */ }
  } else if (view === 'duplicates') {
    // Consolidated clusters (one row per cluster). Each option's count is scoped to the OTHER filters.
    const F = opts.filters || {};
    const dq = async (excl, sel) => {
      const c = build_clauses({ q: opts.q, filters: { ...F, [excl]: undefined }, page: 1, page_size: 1 }, DUP_SPEC);
      const r = await query('SELECT ' + sel + ' FROM `' + DUP_SPEC.table + '` ' + c.join_sql + ' ' + c.where_sql, c.params);
      return (r && r[0]) || {};
    };
    const hn = (x, hasLabel, noneLabel) => [{ value: '', label: 'All' }, { value: 'has', label: hasLabel + ' (' + Number(x.h || 0).toLocaleString() + ')' }, { value: 'none', label: noneLabel + ' (' + Number(x.z || 0).toLocaleString() + ')' }];
    try { const x = await dq('match_type', "SUM(Match_Composition__c LIKE '%exact%') AS ex, SUM(Match_Composition__c LIKE '%fuzzy%') AS fz, SUM(Match_Composition__c LIKE '%nickname%') AS nk");
      fc.signal = [{ value: '', label: 'Any signal' }, { value: 'exact', label: 'Exact (' + Number(x.ex || 0).toLocaleString() + ')' }, { value: 'fuzzy', label: 'Fuzzy (' + Number(x.fz || 0).toLocaleString() + ')' }, { value: 'nickname', label: 'Nickname (' + Number(x.nk || 0).toLocaleString() + ')' }]; } catch (e) { /* optional */ }
    try { const x = await dq('tier', "SUM(LOWER(Confidence_Tier__c) = 'exact') AS ex, SUM(LOWER(Confidence_Tier__c) = 'fuzzy') AS fz, SUM(LOWER(Confidence_Tier__c) = 'nickname') AS nk");
      fc.tier = [{ value: '', label: 'Any tier' }, { value: 'exact', label: 'Exact (' + Number(x.ex || 0).toLocaleString() + ')' }, { value: 'fuzzy', label: 'Fuzzy (' + Number(x.fz || 0).toLocaleString() + ')' }, { value: 'nickname', label: 'Nickname (' + Number(x.nk || 0).toLocaleString() + ')' }]; } catch (e) { /* optional */ }
    try { fc.merge_id_state = hn(await dq('merge_id_state', "SUM(REPLACE(Merge_Ids__c, ';', '') <> '') AS h, SUM(Merge_Ids__c IS NULL OR REPLACE(Merge_Ids__c, ';', '') = '') AS z"), 'Has merge ID', 'No merge ID'); } catch (e) { /* optional */ }
    try { fc.member_number_state = hn(await dq('member_number_state', "SUM(REPLACE(Member_Numbers__c, ';', '') <> '') AS h, SUM(Member_Numbers__c IS NULL OR REPLACE(Member_Numbers__c, ';', '') = '') AS z"), 'Has member #', 'No member #'); } catch (e) { /* optional */ }
    try { fc.foundation_state =hn(await dq('foundation_state', "SUM(Foundation_Constituents__c LIKE '%true%') AS h, SUM(Foundation_Constituents__c IS NULL OR Foundation_Constituents__c NOT LIKE '%true%') AS z"), 'Is foundation', 'Not foundation'); } catch (e) { /* optional */ }
    try { fc.portal_state =hn(await dq('portal_state', "SUM(Has_Portal_Account__c = '1') AS h, SUM(Has_Portal_Account__c IS NULL OR Has_Portal_Account__c <> '1') AS z"), 'Has portal', 'No portal'); } catch (e) { /* optional */ }
  }
  return out;
}

// All distinct KEY values matching the SAME filters the Select Merges list uses (no pagination) — so the
// batch-run sampler can pick a random subset from the exact filtered pool. view: 'duplicates' | 'merge-id'.
const KEY_COL = { duplicates: 'Consolidated_Group_Key__c', 'merge-id': 'Salesforce_Merge_Id__c' };
// The merge-id view is a GROUP-level query (one row per Salesforce merge id, group-level HAVING filters,
// blank ids excluded). Both the Select-Merges "Merge-id groups" panel AND the batch sampler go through the
// SAME builder (merge_group_clauses, below) so their counts and keys always agree — one source of truth.
// ONE SQL fragment for the Select-Merges "Queue" filter — the SINGLE source of truth shared by BOTH the
// Select Merges panel (list + count + pagination) AND the Merge Ops batch sampler, so they can never
// drift. Given the group-key SQL expression, it LEFT JOINs the per-source_key queue state (active = any
// queued/approved row; latest = most recent status by created_at,id) and returns a WHERE condition:
//   'staged'   → the key is active OR its latest lifecycle status is a live merge (done/recreated)
//   'unstaged' → the negation (also true when the key has no queue row at all)
// restored/failed fall through as NOT staged (re-mergeable), matching Select Merges' original client rule.
// Group keys and merge ids share the source_key column and never collide (different formats), so one
// predicate serves both views. Returns null when the filter is off. No bound params (values inlined,
// and they're fixed literals — injection-safe).
function queue_join(keyExpr, mode) {
  const m = String(mode || '');
  if (m !== 'staged' && m !== 'unstaged') return null;
  const join = "LEFT JOIN (SELECT source_key, MAX(status IN ('queued','approved')) AS active, "
    + "SUBSTRING_INDEX(GROUP_CONCAT(status ORDER BY created_at DESC, id DESC), ',', 1) AS latest "
    + "FROM `salesforce_merge_queue` GROUP BY source_key) `sq` ON `sq`.source_key = " + keyExpr;
  const staged = "(`sq`.source_key IS NOT NULL AND (`sq`.active = 1 OR `sq`.latest IN ('done','recreated')))";
  return { join, cond: (m === 'staged') ? staged : ('NOT ' + staged) };
}

async function matching_keys(view, opts = {}, query = real_query) {
  if (view === 'merge-id') return merge_group_keys(flatten_mergeid_opts(opts), query);
  const spec = SPECS[view]; const col = KEY_COL[view];
  if (!spec || !spec.table || !col) return [];
  const { where_sql, join_sql, params } = build_clauses({ ...opts, page: 1, page_size: 1 }, spec);   // page/size unused here
  const rows = await query('SELECT DISTINCT `' + col + '` AS k FROM `' + spec.table + '` ' + join_sql + ' ' + where_sql, params);
  return (rows || []).map((r) => r.k).filter(Boolean);
}

// COUNT of matching sets for the live "N sets match" readout in the batch UI. Merge-id delegates to the
// same grouped builder as the review panel; duplicates uses the row-level consolidated clauses. The Queue
// filter (when set) is applied in-SQL via the shared queue_join, so this count equals the panel's total.
async function count_matching(view, opts = {}, query = real_query) {
  if (view === 'merge-id') return merge_group_count(flatten_mergeid_opts(opts), query);
  const spec = SPECS[view]; const col = KEY_COL[view];
  if (!spec || !spec.table || !col) return 0;
  const { where_sql, join_sql, params } = build_clauses({ ...opts, page: 1, page_size: 1 }, spec);
  const rows = await query('SELECT COUNT(DISTINCT `' + col + '`) AS n FROM `' + spec.table + '` ' + join_sql + ' ' + where_sql, params);
  return (rows && rows[0]) ? Number(rows[0].n) : 0;
}

// ---- Duplicates (consolidated clusters) ----
const DUP_SPEC = {
  table: cfg.RESULT_CONSOLIDATED_TABLE,
  select: 'Consolidated_Group_Key__c AS `cluster`, Names_In_Group__c AS `names`, Group_Record_Count__c AS `size`, ' +
          'Match_Composition__c AS `signal`, Confidence_Tier__c AS `tier`, Merge_Ids__c AS `merge_ids`, Best_Pair_Score__c AS `best`, ' +
          'Has_Portal_Account__c AS `portal`, Portal_Account_Count__c AS `portal_count`, ' +
          "(Foundation_Constituents__c LIKE '%true%') AS `foundation`",
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
    // does any member of the cluster carry the IsCustomerPortal flag? (cluster rollup, stored '1'/'0')
    portal_state: { build: (v) => (String(v) === 'has' ? { sql: "Has_Portal_Account__c = '1'" }
      : String(v) === 'none' ? { sql: "(Has_Portal_Account__c IS NULL OR Has_Portal_Account__c <> '1')" } : null) },
    // exact cluster size (e.g. only pairs = 2). Numeric equality on the record count.
    size_eq: { build: (v) => (/^\d+$/.test(String(v).trim()) ? { sql: 'CAST(Group_Record_Count__c AS UNSIGNED) = ?', params: [Number(String(v).trim())] } : null) },
    // cluster-size band (used by the batch-run sampler's Min/Max size).
    size_min: { build: (v) => (/^\d+$/.test(String(v).trim()) ? { sql: 'CAST(Group_Record_Count__c AS UNSIGNED) >= ?', params: [Number(String(v).trim())] } : null) },
    size_max: { build: (v) => (/^\d+$/.test(String(v).trim()) ? { sql: 'CAST(Group_Record_Count__c AS UNSIGNED) <= ?', params: [Number(String(v).trim())] } : null) },
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
  queue_key: 'Consolidated_Group_Key__c',   // group key the Queue filter joins on (see queue_join)
  default_sort: 'size',
};
// ACCOUNTS across the matching consolidated clusters (sum of cluster sizes) — the per-account companion
// to the cluster count, from the same build_clauses (+ queue join). Ties out to the dashboard's
// "Duplicate accounts" (10,327 across 5,120 clusters).
async function duplicates_account_total(opts = {}, query = real_query) {
  const { where_sql, join_sql, params } = build_clauses({ ...opts, page: 1, page_size: 1 }, DUP_SPEC);
  const rows = await query('SELECT COALESCE(SUM(CAST(Group_Record_Count__c AS UNSIGNED)), 0) AS n FROM `' +
    DUP_SPEC.table + '` ' + join_sql + ' ' + where_sql, params);
  return rows && rows[0] ? Number(rows[0].n) : 0;
}
async function list_duplicates(opts = {}, query = real_query) {
  const o = { ...opts, dir: opts.dir || 'DESC' };
  const res = await paged(cfg.RESULT_CONSOLIDATED_TABLE, DUP_SPEC, o, query);
  res.accounts = await duplicates_account_total(o, query);   // per-account companion to the cluster total
  return res;
}
// ACCOUNT companion to count_matching (batch sampler): accounts across the matching sets.
async function count_accounts(view, opts = {}, query = real_query) {
  if (view === 'merge-id') return merge_group_account_total(flatten_mergeid_opts(opts), query);
  if (view === 'duplicates') return duplicates_account_total(opts, query);
  return 0;
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
          'Foundation_Constituent__c AS `foundation`, Is_Customer_Portal__c AS `portal`, Consolidated_Group_Key__c AS `cluster`',
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
    // Merge-id SIZE filter (Def B): restrict to accounts whose merge ID belongs to a chosen set of
    // merge-id GROUPS. list_merge_id resolves the size to those merge IDs via the SAME merge_group_keys
    // builder Select Merges uses, so "Size = N" means "merge IDs shared by N accounts" in BOTH panels.
    mergeid_in: {
      build: (keys) => {
        const arr = Array.isArray(keys) ? keys : [];
        if (!arr.length) return { sql: '1 = 0' };   // a size with no matching merge-id groups -> empty
        return { sql: "Salesforce_Merge_Id__c IN (" + arr.map(() => '?').join(', ') + ")", params: arr };
      },
    },
    // 'has' / 'none' on the account's Foundation constituent flag (per-row true/false)
    foundation_state: { build: (v) => (String(v) === 'has' ? { sql: "Foundation_Constituent__c LIKE 'true%'" }
      : String(v) === 'none' ? { sql: "(Foundation_Constituent__c IS NULL OR Foundation_Constituent__c NOT LIKE 'true%')" } : null) },
    // 'has' / 'none' on the account's IsCustomerPortal flag (per-row '1'/'0')
    portal_state: { build: (v) => (String(v) === 'has' ? { sql: "Is_Customer_Portal__c = '1'" }
      : String(v) === 'none' ? { sql: "(Is_Customer_Portal__c IS NULL OR Is_Customer_Portal__c <> '1')" } : null) },
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
  const o = { ...opts, colFilters: { ...(opts.colFilters || {}) } };
  const f = o.filters || {};
  // Merge-id GROUP filters, shared with Select Merges so "size" + "groups" mean the SAME thing here:
  // size = accounts sharing the merge ID (NOT cluster size), and a group is a mergeable set (2+).
  const gopts = { q: o.q, bucket: f.bucket, foundation_state: f.foundation_state, portal_state: f.portal_state, which_list: o.colFilters.which_list };
  const sizeSel = String(o.colFilters.size == null ? '' : o.colFilters.size).trim();
  delete o.colFilters.size;
  if (sizeSel !== '') {   // restrict to accounts in merge-id groups of that size (same builder as Select Merges)
    o.filters = { ...f, mergeid_in: await merge_group_keys({ ...gopts, size: sizeSel }, query) };
  }
  const res = await paged(cfg.RESULT_MERGE_ID_REVIEW_TABLE, MR_SPEC, o, query);
  // SIZE column = accounts sharing each merge ID within this bucket (1 = a singleton). One lookup / page.
  const mids = [...new Set(res.rows.map((r) => r.merge_id).filter(Boolean))];
  if (mids.length) {
    const params = [...mids];
    const bf = f.bucket ? MR_SPEC.filter_cols.bucket.build(f.bucket) : null;
    const bwhere = bf && bf.sql ? ' AND ' + bf.sql : '';
    if (bf && bf.params) params.push(...bf.params);
    const sr = await query('SELECT Salesforce_Merge_Id__c AS k, COUNT(*) AS n FROM `' + cfg.RESULT_MERGE_ID_REVIEW_TABLE +
      '` WHERE Salesforce_Merge_Id__c IN (' + mids.map(() => '?').join(', ') + ')' + bwhere + ' GROUP BY Salesforce_Merge_Id__c', params);
    const m = new Map((sr || []).map((x) => [x.k, Number(x.n)]));
    for (const r of res.rows) r.size = r.merge_id ? (m.get(r.merge_id) || 1) : null;
  }
  // Group companion = mergeable (2+) merge-id groups in view, matching the dashboard card + Select Merges.
  res.groups = await merge_group_count({ ...gopts, size: sizeSel || undefined }, query);
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
          'salesforce_merge_id AS `merge_id`, match_composition, match_score, confidence_tier, ' +
          'cluster_key, cluster_size, email, foundation_constituent, is_customer_portal AS `portal`, created_date, created_by_name',
  // Global search = identity columns only, all matched as 'term%' so every branch can use an index
  // (huge on ~700k rows). email / match_composition are contains-anywhere and would force a full
  // scan, so they are NOT in the global search — they live on their own column filters instead.
  search_cols: ['first_name', 'last_name', 'salesforce_account_id', 'member_number'],
  contains_cols: ['email', 'match_composition', 'created_by_name', 'created_date'],
  filter_cols: {
    has_merge_id: { sql: "salesforce_merge_id <> ''" },                 // legacy truthy toggle (kept)
    has_member_number: { sql: "member_number <> ''" },
    // 3-state selectors: 'has' / 'none' (blank/'all' -> no filter)
    merge_id_state: { build: (v) => (String(v) === 'has' ? { sql: "salesforce_merge_id <> ''" }
      : String(v) === 'none' ? { sql: "(salesforce_merge_id IS NULL OR salesforce_merge_id = '')" } : null) },
    member_number_state: { build: (v) => (String(v) === 'has' ? { sql: "member_number <> ''" }
      : String(v) === 'none' ? { sql: "(member_number IS NULL OR member_number = '')" } : null) },
    // 'has' = account is in a consolidated duplicate cluster (cluster_size stamped >= 2); 'none' = not.
    in_cluster_state: { build: (v) => (String(v) === 'has' ? { sql: 'cluster_size > 0' }
      : String(v) === 'none' ? { sql: '(cluster_size IS NULL OR cluster_size = 0)' } : null) },
    // 'has' = account is a Customer-Portal account; 'none' = not (snapshot TINYINT 0/1)
    portal_state: { build: (v) => (String(v) === 'has' ? { sql: 'is_customer_portal = 1' }
      : String(v) === 'none' ? { sql: '(is_customer_portal IS NULL OR is_customer_portal = 0)' } : null) },
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
    match_score: 'match_score',
    confidence_tier: 'confidence_tier',
    cluster_size: 'cluster_size',
    email: 'email',
    foundation_constituent: 'foundation_constituent',
    created_date: 'created_date',
    created_by_name: 'created_by_name',
  },
  filter_map: {
    account: 'salesforce_account_id', name: 'last_name',
    first_name: 'first_name', last_name: 'last_name', gender: 'gender_identity',
    birthdate: 'person_birthdate', zip5: 'composite_zip_five_digit', member_number: 'member_number', merge_id: 'salesforce_merge_id',
    match_composition: 'match_composition', match_score: { eq: 'match_score' }, confidence_tier: 'confidence_tier', cluster_size: { eq: 'cluster_size' },
    email: 'email', foundation_constituent: 'foundation_constituent',
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

// ---- Merge-ID groups: ONE shared builder used by BOTH the review panel and the batch sampler ----
// One row per distinct Salesforce merge id (blank ids excluded). Group-level filters run as HAVING over the
// GROUP BY (foundation/portal/which-list = ANY/NO member matches; size = the group's member count COUNT(*));
// bucket + search run as row-level WHERE. Accepts FLAT opts: { q, bucket, foundation_state, portal_state,
// size, which_list }. This is the single source of truth so the panel and the batch stager never diverge.
function merge_group_clauses(opts = {}) {
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
  const havings = [];
  const fnd = String(opts.foundation_state || '');
  if (fnd === 'has') havings.push("SUM(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END) > 0");
  else if (fnd === 'none') havings.push("SUM(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END) = 0");
  const prt = String(opts.portal_state || '');
  if (prt === 'has') havings.push("SUM(CASE WHEN Is_Customer_Portal__c = '1' THEN 1 ELSE 0 END) > 0");
  else if (prt === 'none') havings.push("SUM(CASE WHEN Is_Customer_Portal__c = '1' THEN 1 ELSE 0 END) = 0");
  const sz = String(opts.size == null ? '' : opts.size).trim();
  // A "merge-id group" = ALL accounts sharing a merge id; size can be 1 (a singleton). DEFAULT counts every
  // group so accounts + groups reconcile everywhere (each account is in exactly one group). "Mergeable" is
  // just Size >= 2: `opts.mergeable` gates to 2+ (only where actionable-only is wanted); an exact size wins.
  if (/^\d+$/.test(sz)) havings.push("COUNT(*) = " + Number(sz));
  else if (opts.mergeable) havings.push("COUNT(*) >= 2");
  const wl = String(opts.which_list || '').trim().toLowerCase();   // validated to a fixed set -> inlined LIKE is injection-safe
  if (wl === 'exact' || wl === 'fuzzy' || wl === 'nickname') havings.push("SUM(CASE WHEN Which_List__c LIKE '%" + wl + "%' THEN 1 ELSE 0 END) > 0");
  // Queue filter (staged/unstaged) — same shared SQL predicate the duplicates view + sampler use, joined on
  // the merge id. Applied as a row-level WHERE (constant per group, since sq is one row per source_key).
  let join_sql = '';
  const qj = queue_join('Salesforce_Merge_Id__c', opts.queue_filter);
  if (qj) { join_sql = ' ' + qj.join; wheres.push(qj.cond); }
  return { T, join_sql, where_sql: "WHERE " + wheres.join(" AND "), having_sql: havings.length ? (" HAVING " + havings.join(" AND ")) : '', params };
}
// The batch sampler passes nested { filters, colFilters }; flatten to what merge_group_clauses expects.
function flatten_mergeid_opts(opts = {}) {
  const f = opts.filters || {}; const cf = opts.colFilters || {};
  return { q: opts.q, bucket: f.bucket, foundation_state: f.foundation_state, portal_state: f.portal_state, which_list: cf.which_list, size: cf.size, queue_filter: opts.queue_filter };
}
async function merge_group_count(opts = {}, query = real_query) {
  const { T, join_sql, where_sql, having_sql, params } = merge_group_clauses(opts);
  const rows = await query(having_sql
    ? "SELECT COUNT(*) AS n FROM (SELECT Salesforce_Merge_Id__c FROM `" + T + "`" + join_sql + " " + where_sql + " GROUP BY Salesforce_Merge_Id__c" + having_sql + ") x"
    : "SELECT COUNT(DISTINCT Salesforce_Merge_Id__c) AS n FROM `" + T + "`" + join_sql + " " + where_sql, params);
  return rows && rows[0] ? Number(rows[0].n) : 0;
}
async function merge_group_keys(opts = {}, query = real_query) {
  const { T, join_sql, where_sql, having_sql, params } = merge_group_clauses(opts);
  const rows = await query("SELECT Salesforce_Merge_Id__c AS k FROM `" + T + "`" + join_sql + " " + where_sql +
    " GROUP BY Salesforce_Merge_Id__c" + having_sql, params);
  return (rows || []).map((r) => r.k).filter(Boolean);
}
// ACCOUNTS across the matching merge-id groups (sum of group sizes) — the per-account companion to
// merge_group_count. Same shared clauses (+ queue join), so it ties out to the dashboard's per-bucket
// account counts (e.g. bucket=in_both -> 3,689) and to the account column everywhere it's shown.
async function merge_group_account_total(opts = {}, query = real_query) {
  const { T, join_sql, where_sql, having_sql, params } = merge_group_clauses(opts);
  const rows = await query(
    "SELECT COALESCE(SUM(c), 0) AS n FROM (SELECT COUNT(*) AS c FROM `" + T + "`" + join_sql + " " + where_sql +
    " GROUP BY Salesforce_Merge_Id__c" + having_sql + ") x", params);
  return rows && rows[0] ? Number(rows[0].n) : 0;
}
async function list_merge_groups(opts = {}, query = real_query) {
  const page = clamp_int(opts.page, 1, 1, 1e9);
  const page_size = clamp_int(opts.page_size, 25, 1, MAX_PAGE_SIZE);
  const offset = (page - 1) * page_size;
  const { T, join_sql, where_sql, having_sql, params } = merge_group_clauses(opts);   // shared with the batch sampler
  const total = await merge_group_count(opts, query);
  const accounts = await merge_group_account_total(opts, query);   // per-account companion to the group total
  const rows = await query(
    "SELECT Salesforce_Merge_Id__c AS `merge_id`, " +
    "GROUP_CONCAT(DISTINCT NULLIF(TRIM(CONCAT(COALESCE(First_Name__c, ''), ' ', COALESCE(Last_Name__c, ''))), '') SEPARATOR ';') AS `names`, " +
    "COUNT(*) AS `size`, MIN(Consolidated_Group_Key__c) AS `cluster_key`, " +
    "MAX(CASE WHEN Is_Customer_Portal__c = '1' THEN 1 ELSE 0 END) AS `portal`, " +
    "MAX(CASE WHEN Foundation_Constituent__c LIKE 'true%' THEN 1 ELSE 0 END) AS `foundation` " +
    "FROM `" + T + "`" + join_sql + " " + where_sql +
    " GROUP BY Salesforce_Merge_Id__c" + having_sql + " ORDER BY COUNT(*) DESC, Salesforce_Merge_Id__c ASC LIMIT ? OFFSET ?",
    params.concat([page_size, offset]));
  const out = (rows || []).map((r) => ({
    cluster: r.merge_id, merge_id: r.merge_id, names: r.names || '',
    size: Number(r.size) || 0, signal: "merge id", cluster_key: r.cluster_key || '',
    portal: Number(r.portal) || 0, foundation: Number(r.foundation) || 0,
  }));
  return { rows: out, total, accounts, page, page_size };
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
  const rows = await query("SELECT Salesforce_Merge_Id__c AS merge_id, Account__c AS account, First_Name__c AS first_name, Last_Name__c AS last_name, Foundation_Constituent__c AS foundation, Is_Customer_Portal__c AS portal, Which_List__c AS which_list FROM `" + T + "` " + where_sql, params);
  const byId = new Map(); const allIds = new Set(); const nameMap = new Map(); const fnd_groups = new Set(); const portal_groups = new Set(); const wl_groups = new Set();
  const wlWant = String(opts.which_list || '').trim().toLowerCase();
  for (const row of (rows || [])) {
    if (!row.merge_id || !row.account) continue;
    if (!byId.has(row.merge_id)) byId.set(row.merge_id, []);
    byId.get(row.merge_id).push(row.account); allIds.add(row.account);
    nameMap.set(row.account, ((row.first_name || '') + ' ' + (row.last_name || '')).trim());
    if (String(row.foundation || '').toLowerCase().startsWith('true')) fnd_groups.add(row.merge_id);
    if (String(row.portal || '') === '1') portal_groups.add(row.merge_id);
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
  // group-level portal filter: keep groups with ANY (has) / NO (none) Customer-Portal account.
  const prt = String(opts.portal_state || '');
  if (prt === 'has' || prt === 'none') {
    for (const mid of [...byId.keys()]) {
      const hit = portal_groups.has(mid);
      if ((prt === 'has' && !hit) || (prt === 'none' && hit)) byId.delete(mid);
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

// Build the SELECT for a streamed export — same WHERE/ORDER as the view, but NO LIMIT (the CSV
// path streams row-by-row, so it isn't bound by the EXPORT_MAX buffer cap that export_rows uses
// for the in-memory Excel path). Returns { sql, params } or null for an unknown view.
function export_sql(view, opts = {}) {
  const spec = SPECS[view];
  if (!spec) return null;
  const o = { ...opts };
  if (view === 'duplicates' && !o.dir) o.dir = 'DESC';
  const { where_sql, order_sql, params } = build_clauses(o, spec);
  return { sql: 'SELECT ' + spec.select + ' FROM `' + spec.table + '` ' + where_sql + ' ' + order_sql, params };
}

module.exports = {
  list_duplicates, list_merge_id, merge_id_summary, list_accounts, cluster_accounts, facets, export_rows, export_sql,
  list_merge_groups, merge_group_account_ids, accounts_by_ids, resolve_merge_groups, resolve_duplicate_groups, pick_bulk_survivor,
  matching_keys, count_matching, count_accounts, queue_join,
  merge_group_account_total, duplicates_account_total,
  build_clauses, MAX_PAGE_SIZE, EXPORT_MAX, // exported for tests
};

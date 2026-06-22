/**
 * consolidate.js — Nickname view (c), nickname groups, + consolidated view (d).
 *
 * Additive layer (see plans_and_notes/README_NICKNAME.md). Does NOT touch the baseline detectors;
 * it does its own "edge generation" over the COMPLETE rule-eligible pool (records
 * with gender + birthdate + composite ZIP; exact-duplicate records are NOT
 * removed), so the consolidated clusters can merge exact <-> fuzzy and
 * exact <-> nickname links the baseline files deliberately hide.
 *
 *   build_match_edges(...)            -> detection: every match link once, on the
 *                                        complete pool, plus the nickname view rows
 *                                        and a reviewable nickname-fire summary.
 *   build_nickname_groups(...)        -> single-signal grouping of nickname pairs
 *                                        (mirrors the fuzzy pair -> group pattern).
 *   build_consolidated_clusters(...)  -> clustering across ALL signals.
 *
 * Pure aside from optional progress logging.
 */

'use strict';

const { FUZZY_THRESHOLD, NICKNAME_LAST_NAME_MIN_SCORE } = require('../config');
const {
    has_required_rule_fields,
    make_rule_key,
    composite_zip,
    make_full_name,
    make_clean_full_name,
    unique_join,
} = require('./normalize');
const { similarity_score } = require('./matcher');
const { are_nickname_equivalents, nickname_reason, nn_key, get_namer } = require('./nicknames');
const { UnionFind } = require('./grouping');

const TIER_RANK = { exact: 0, fuzzy: 1, nickname: 2 };

// ---------------------------------------------------------------------------
// Detection — generate every match edge once, over the complete rule-eligible
// pool. Returns edges, the nickname single-signal view rows, a reviewable
// nickname-fire summary, and counters for the run summary.
// ---------------------------------------------------------------------------
function build_match_edges(records, exact_duplicate_groups, { namer = get_namer() } = {}) {
    const edges = [];
    const nickname_pairs = [];
    const fire = new Map();

    let pairs_compared = 0;
    let pairs_matched_spelling_only = 0;
    let pairs_matched_nickname_only = 0;
    let pairs_matched_both = 0;

    const exact_id_set = new Set();
    for (const g of exact_duplicate_groups || []) {
        for (const id of g.record_ids) exact_id_set.add(id);
    }

    // Exact edges — reuse the authoritative exact groups; chain each group's members.
    for (const g of exact_duplicate_groups || []) {
        const ids = g.record_ids;
        for (let k = 1; k < ids.length; k++) {
            edges.push({
                a: ids[0],
                b: ids[k],
                type: 'exact',
                spelling_flag: 0,
                nickname_flag: 0,
                first_name_score: '',
                last_name_score: '',
                combined_name_score: '',
                reason: 'exact duplicate: same cleaned name + gender + birthdate + composite ZIP',
            });
        }
    }

    // Fuzzy + nickname edges — pairwise within rule blocks over the COMPLETE pool.
    const candidate_records = records.filter((row) => has_required_rule_fields(row));

    const rule_blocks = new Map();
    for (const row of candidate_records) {
        const key = make_rule_key(row);
        if (!rule_blocks.has(key)) rule_blocks.set(key, []);
        rule_blocks.get(key).push(row);
    }

    for (const [rule_key, block_rows] of rule_blocks.entries()) {
        if (block_rows.length < 2) continue;

        for (let i = 0; i < block_rows.length; i++) {
            for (let j = i + 1; j < block_rows.length; j++) {
                pairs_compared += 1;

                const a = block_rows[i];
                const b = block_rows[j];

                const first_score = similarity_score(a.FirstName, b.FirstName);
                const last_score = similarity_score(a.LastName, b.LastName);

                const exact_first = first_score === 100;
                const exact_last = last_score === 100;

                if (exact_first && exact_last) continue;

                const combined = Math.round(first_score * 0.45 + last_score * 0.55);
                const spelling = combined >= FUZZY_THRESHOLD;

                const last_ok = exact_last || last_score >= NICKNAME_LAST_NAME_MIN_SCORE;
                const nick = last_ok && are_nickname_equivalents(a.FirstName, b.FirstName, namer);

                if (!spelling && !nick) continue;

                const match_path = nick ? 'nickname' : 'fuzzy_spelling';
                const reason = nick
                    ? nickname_reason(a.FirstName, b.FirstName, namer)
                    : `fuzzy spelling match: combined name score ${combined} >= threshold ${FUZZY_THRESHOLD}`;

                edges.push({
                    a: a.Id,
                    b: b.Id,
                    type: nick ? 'nickname' : 'fuzzy',
                    spelling_flag: spelling ? 1 : 0,
                    nickname_flag: nick ? 1 : 0,
                    first_name_score: first_score,
                    last_name_score: last_score,
                    combined_name_score: combined,
                    reason,
                });

                if (nick && spelling) pairs_matched_both += 1;
                else if (nick) pairs_matched_nickname_only += 1;
                else pairs_matched_spelling_only += 1;

                if (nick) {
                    const in_exact = exact_id_set.has(a.Id) || exact_id_set.has(b.Id);
                    nickname_pairs.push({
                        rule_key,
                        match_path,
                        first_name_score: first_score,
                        last_name_score: last_score,
                        combined_name_score: combined,
                        nickname_match_reason: reason,
                        also_clears_fuzzy_flag: spelling ? 1 : 0,
                        spelling_match_flag: spelling ? 1 : 0,
                        nickname_match_flag: 1,
                        in_exact_group_flag: in_exact ? 1 : 0,

                        record_id_1: a.Id,
                        member_number_1: a.cfg_Member_Number__pc,
                        merge_id_1: a.usat_Salesforce_Merge_Id__pc,
                        first_name_1: a.FirstName,
                        last_name_1: a.LastName,
                        full_name_1: make_full_name(a),
                        clean_full_name_1: make_clean_full_name(a),
                        gender_1: a.cfg_Gender_Identity__pc,
                        birthdate_1: a.PersonBirthdate,
                        composite_zip_1: composite_zip(a),
                        billing_zip_1: a.BillingPostalCode,
                        mailing_zip_1: a.PersonMailingPostalCode,
                        foundation_constituent_1: a.usat_Foundation_Constituent__c,

                        record_id_2: b.Id,
                        member_number_2: b.cfg_Member_Number__pc,
                        merge_id_2: b.usat_Salesforce_Merge_Id__pc,
                        first_name_2: b.FirstName,
                        last_name_2: b.LastName,
                        full_name_2: make_full_name(b),
                        clean_full_name_2: make_clean_full_name(b),
                        gender_2: b.cfg_Gender_Identity__pc,
                        birthdate_2: b.PersonBirthdate,
                        composite_zip_2: composite_zip(b),
                        billing_zip_2: b.BillingPostalCode,
                        mailing_zip_2: b.PersonMailingPostalCode,
                        foundation_constituent_2: b.usat_Foundation_Constituent__c,

                        nickname_logic:
                            'nickname-equivalent first name AND last name exact-or-fuzzy AND same gender + birthdate + composite ZIP, and not an exact cleaned-name match',
                    });

                    const ka = nn_key(a.FirstName);
                    const kb = nn_key(b.FirstName);
                    const fkey = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
                    const existing = fire.get(fkey);
                    if (existing) {
                        existing.record_count += 1;
                    } else {
                        fire.set(fkey, {
                            first_name_a: ka < kb ? ka : kb,
                            first_name_b: ka < kb ? kb : ka,
                            record_count: 1,
                        });
                    }
                }
            }
        }
    }

    nickname_pairs.sort((x, y) => {
        if (y.combined_name_score !== x.combined_name_score) return y.combined_name_score - x.combined_name_score;
        if (y.last_name_score !== x.last_name_score) return y.last_name_score - x.last_name_score;
        return String(x.full_name_1 || '').localeCompare(String(y.full_name_1 || ''));
    });

    const fire_summary = [...fire.values()].sort((x, y) => {
        if (y.record_count !== x.record_count) return y.record_count - x.record_count;
        return x.first_name_a.localeCompare(y.first_name_a);
    });

    return {
        edges,
        nickname_pairs,
        fire_summary,
        counters: {
            candidate_records: candidate_records.length,
            rule_blocks: rule_blocks.size,
            pairs_compared,
            pairs_matched_spelling_only,
            pairs_matched_nickname_only,
            pairs_matched_both,
            nickname_pairs_found: nickname_pairs.length,
        },
    };
}

// ---------------------------------------------------------------------------
// Single-signal nickname grouping — connect nickname pairs into clusters, so
// Bob/Bobby/Robert at one DOB+ZIP collapse from N pair-rows into one group row.
// Mirrors grouping.build_fuzzy_groups but on nickname pairs only.
// ---------------------------------------------------------------------------
function build_nickname_groups(nickname_pairs, record_lookup) {
    const uf = new UnionFind();
    for (const p of nickname_pairs) uf.union(p.record_id_1, p.record_id_2);

    const raw_groups = [...uf.groups().values()].filter((ids) => ids.length > 1);
    const stats_by_key = new Map();

    for (const ids of raw_groups) {
        const key = [...ids].sort().join('|');
        stats_by_key.set(key, { best: 0, lowest: 100, count: 0, reasons: [] });
    }

    for (const p of nickname_pairs) {
        const group_ids = raw_groups.find((ids) => ids.includes(p.record_id_1) && ids.includes(p.record_id_2));
        if (!group_ids) continue;
        const key = [...group_ids].sort().join('|');
        const s = stats_by_key.get(key);
        s.best = Math.max(s.best, p.combined_name_score);
        s.lowest = Math.min(s.lowest, p.combined_name_score);
        s.count += 1;
        s.reasons.push(`${p.full_name_1} <-> ${p.full_name_2}: score ${p.combined_name_score}`);
    }

    return raw_groups
        .map((ids) => {
            const sorted_ids = [...ids].sort();
            const key = sorted_ids.join('|');
            const s = stats_by_key.get(key);
            const rows = sorted_ids.map((id) => record_lookup.get(id)).filter(Boolean);
            const first = rows[0] || {};

            return {
                nickname_group_key: key,
                group_record_count: rows.length,
                shared_gender: first.cfg_Gender_Identity__pc || '',
                shared_birthdate: first.PersonBirthdate || '',
                shared_composite_zip: composite_zip(first),
                names_in_group: rows.map(make_full_name).join(';'),
                clean_names_in_group: rows.map(make_clean_full_name).join(';'),
                record_ids: rows.map((r) => r.Id).join(';'),
                member_numbers: rows.map((r) => r.cfg_Member_Number__pc || '').join(';'),
                merge_ids: rows.map((r) => r.usat_Salesforce_Merge_Id__pc || '').join(';'),
                foundation_constituents: rows.map((r) => r.usat_Foundation_Constituent__c || '').join(';'),
                best_pair_score: s ? s.best : '',
                lowest_pair_score: s ? s.lowest : '',
                nickname_pair_count_in_group: s ? s.count : 0,
                nickname_pair_summary: s ? s.reasons.join(' | ') : '',
                nickname_group_logic:
                    'connected group built from nickname pair matches sharing same gender, birthdate, and composite ZIP',
            };
        })
        .sort((a, b) => {
            if (b.group_record_count !== a.group_record_count) return b.group_record_count - a.group_record_count;
            if (b.best_pair_score !== a.best_pair_score) return b.best_pair_score - a.best_pair_score;
            return String(a.names_in_group || '').localeCompare(String(b.names_in_group || ''));
        });
}

// ---------------------------------------------------------------------------
// Clustering — union every edge (exact + fuzzy + nickname) and emit one row per
// connected cluster, carrying provenance flags, a confidence tier, and reasons.
// ---------------------------------------------------------------------------
function build_consolidated_clusters(edges, record_lookup) {
    const uf = new UnionFind();
    for (const e of edges) uf.union(e.a, e.b);

    const new_stats = () => ({ exact: 0, fuzzy: 0, nick: 0, links: 0, best: 0, lowest: 100, reasons: [], rep: null });
    const stats = new Map();
    function stat_for(root) {
        if (!stats.has(root)) stats.set(root, new_stats());
        return stats.get(root);
    }

    for (const e of edges) {
        const root = uf.find(e.a);
        const s = stat_for(root);

        s.links += 1; // one edge = one matched pair (link) inside the cluster
        if (e.type === 'exact') s.exact += 1;
        if (e.spelling_flag === 1) s.fuzzy += 1;
        if (e.nickname_flag === 1) s.nick += 1;

        const scored = e.combined_name_score !== '' && e.combined_name_score != null;
        if (scored) {
            s.best = Math.max(s.best, e.combined_name_score);
            s.lowest = Math.min(s.lowest, e.combined_name_score);
        }

        const ra = record_lookup.get(e.a);
        const rb = record_lookup.get(e.b);
        const na = ra ? make_full_name(ra) : e.a;
        const nb = rb ? make_full_name(rb) : e.b;

        // Readable label for the link (a pair that is both fuzzy + nickname shows as such).
        const label = e.type === 'exact'
            ? 'exact'
            : (e.spelling_flag === 1 && e.nickname_flag === 1 ? 'fuzzy+nickname' : e.type);
        const score_str = scored
            ? ` [first ${e.first_name_score} / last ${e.last_name_score} / combined ${e.combined_name_score}]`
            : '';
        s.reasons.push(`${na} <-> ${nb}: ${label}${score_str} — ${e.reason}`);

        // Representative pair = the strongest-scored link (fall back to the first exact link).
        if (scored) {
            if (!s.rep || s.rep.cs === '' || s.rep.cs < e.combined_name_score) {
                s.rep = { a: na, b: nb, label, fs: e.first_name_score, ls: e.last_name_score, cs: e.combined_name_score };
            }
        } else if (!s.rep) {
            s.rep = { a: na, b: nb, label, fs: '', ls: '', cs: '' };
        }
    }

    const raw_groups = [...uf.groups().values()].filter((ids) => ids.length > 1);

    const clusters = raw_groups.map((ids) => {
        const sorted_ids = [...ids].sort();
        const cluster_key = sorted_ids.join('|');
        const root = uf.find(sorted_ids[0]);
        const s = stats.get(root) || new_stats();

        const rows = sorted_ids.map((id) => record_lookup.get(id)).filter(Boolean);
        const first = rows[0] || {};

        const has_exact = s.exact > 0 ? 1 : 0;
        const has_fuzzy = s.fuzzy > 0 ? 1 : 0;
        const has_nickname = s.nick > 0 ? 1 : 0;
        const tier = has_exact ? 'exact' : has_fuzzy ? 'fuzzy' : 'nickname';
        const has_pair_score = s.fuzzy > 0 || s.nick > 0;

        // Single readable label of the signal mix (in addition to the boolean flags).
        const signals = [];
        if (has_exact) signals.push('exact');
        if (has_fuzzy) signals.push('fuzzy');
        if (has_nickname) signals.push('nickname');
        const match_composition = signals.length === 1 ? `${signals[0]} only` : signals.join(' + ');

        const rep = s.rep;
        const representative_pair = rep
            ? `${rep.a} <-> ${rep.b}: ${rep.label}${rep.cs !== '' ? ` (first ${rep.fs} / last ${rep.ls} / combined ${rep.cs})` : ''}`
            : '';

        return {
            consolidated_group_key: cluster_key,
            group_record_count: rows.length,
            confidence_tier: tier,
            match_composition,
            has_exact_flag: has_exact,
            has_fuzzy_flag: has_fuzzy,
            has_nickname_flag: has_nickname,
            exact_link_count: s.exact,
            fuzzy_link_count: s.fuzzy,
            nickname_link_count: s.nick,
            match_link_count: s.links,
            shared_gender: first.cfg_Gender_Identity__pc || '',
            shared_birthdate: first.PersonBirthdate || '',
            shared_composite_zip: composite_zip(first),
            names_in_group: rows.map(make_full_name).join(';'),
            clean_names_in_group: rows.map(make_clean_full_name).join(';'),
            record_ids: rows.map((r) => r.Id).join(';'),
            member_numbers: rows.map((r) => r.cfg_Member_Number__pc || '').join(';'),
            merge_ids: rows.map((r) => r.usat_Salesforce_Merge_Id__pc || '').join(';'),
            foundation_constituents: rows.map((r) => r.usat_Foundation_Constituent__c || '').join(';'),
            best_pair_score: has_pair_score ? s.best : '',
            lowest_pair_score: has_pair_score ? s.lowest : '',
            representative_pair,
            match_link_reasons: s.reasons.join(' | '),
            consolidated_logic:
                'connected cluster built from exact, fuzzy(90), and nickname edges over the complete rule-eligible pool',
        };
    });

    clusters.sort((x, y) => {
        if (TIER_RANK[x.confidence_tier] !== TIER_RANK[y.confidence_tier]) {
            return TIER_RANK[x.confidence_tier] - TIER_RANK[y.confidence_tier];
        }
        if (y.group_record_count !== x.group_record_count) return y.group_record_count - x.group_record_count;
        const xb = x.best_pair_score === '' ? -1 : x.best_pair_score;
        const yb = y.best_pair_score === '' ? -1 : y.best_pair_score;
        if (yb !== xb) return yb - xb;
        return String(x.names_in_group || '').localeCompare(String(y.names_in_group || ''));
    });

    return clusters;
}

// Summarize the consolidated clusters by their confidence tier (strongest signal
// present). Used for the end-of-run "contribution by rule" block. Pure.
function summarize_clusters(clusters) {
    const by_tier = {
        exact: { clusters: 0, records: 0 },
        fuzzy: { clusters: 0, records: 0 },
        nickname: { clusters: 0, records: 0 },
    };
    let total_records = 0;

    for (const c of clusters) {
        if (!by_tier[c.confidence_tier]) by_tier[c.confidence_tier] = { clusters: 0, records: 0 };
        by_tier[c.confidence_tier].clusters += 1;
        by_tier[c.confidence_tier].records += c.group_record_count;
        total_records += c.group_record_count;
    }

    return { total_clusters: clusters.length, total_records, by_tier };
}

module.exports = {
    build_match_edges,
    build_nickname_groups,
    build_consolidated_clusters,
    summarize_clusters,
};

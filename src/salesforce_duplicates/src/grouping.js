/**
 * grouping.js — Connected-component grouping of fuzzy pair matches.
 *
 * UnionFind clusters record IDs linked by fuzzy pairs; build_fuzzy_groups
 * turns those clusters into the grouped output rows. Depends on normalize.js
 * for the shared field/name helpers.
 */

'use strict';

const {
    composite_zip,
    make_full_name,
    make_clean_full_name,
    unique_join,
} = require('./normalize');

class UnionFind {
    constructor() {
        this.parent = new Map();
    }

    add(x) {
        if (!this.parent.has(x)) {
            this.parent.set(x, x);
        }
    }

    find(x) {
        this.add(x);

        const parent = this.parent.get(x);

        if (parent !== x) {
            const root = this.find(parent);
            this.parent.set(x, root);
            return root;
        }

        return parent;
    }

    union(a, b) {
        const root_a = this.find(a);
        const root_b = this.find(b);

        if (root_a !== root_b) {
            this.parent.set(root_b, root_a);
        }
    }

    groups() {
        const out = new Map();

        for (const item of this.parent.keys()) {
            const root = this.find(item);

            if (!out.has(root)) {
                out.set(root, []);
            }

            out.get(root).push(item);
        }

        return out;
    }
}

function build_fuzzy_groups(fuzzy_matches, record_lookup) {
    const uf = new UnionFind();

    for (const match of fuzzy_matches) {
        uf.union(match.record_id_1, match.record_id_2);
    }

    const raw_groups = [...uf.groups().values()].filter((ids) => ids.length > 1);
    const pair_stats_by_group_key = new Map();

    for (const ids of raw_groups) {
        const sorted_ids = [...ids].sort();
        const group_key = sorted_ids.join("|");

        pair_stats_by_group_key.set(group_key, {
            best_pair_score: 0,
            lowest_pair_score: 100,
            pair_count: 0,
            pair_reasons: [],
        });
    }

    for (const match of fuzzy_matches) {
        const root_ids = raw_groups.find(
            (ids) => ids.includes(match.record_id_1) && ids.includes(match.record_id_2)
        );

        if (!root_ids) continue;

        const group_key = [...root_ids].sort().join("|");
        const stats = pair_stats_by_group_key.get(group_key);

        stats.best_pair_score = Math.max(stats.best_pair_score, match.match_score_combined_name);
        stats.lowest_pair_score = Math.min(stats.lowest_pair_score, match.match_score_combined_name);
        stats.pair_count += 1;
        stats.pair_reasons.push(
            `${match.full_name_1} <-> ${match.full_name_2}: score ${match.match_score_combined_name}`
        );
    }

    return raw_groups
        .map((ids) => {
            const sorted_ids = [...ids].sort();
            const group_key = sorted_ids.join("|");
            const stats = pair_stats_by_group_key.get(group_key);

            const rows = sorted_ids
                .map((id) => record_lookup.get(id))
                .filter(Boolean);

            const first_row = rows[0] || {};

            return {
                fuzzy_group_key: group_key,
                group_record_count: rows.length,
                shared_gender: first_row.cfg_Gender_Identity__pc || "",
                shared_birthdate: first_row.PersonBirthdate || "",
                shared_composite_zip: composite_zip(first_row),
                names_in_group: rows.map(make_full_name).join(";"),
                clean_names_in_group: rows.map(make_clean_full_name).join(";"),
                record_ids: rows.map((r) => r.Id).join(";"),
                member_numbers: rows
                    .map((r) => r.cfg_Member_Number__pc)
                    .filter(Boolean)
                    .join(";"),
                foundation_constituents: unique_join(
                    rows.map((r) => r.usat_Foundation_Constituent__c)
                ),
                best_pair_score: stats?.best_pair_score || "",
                lowest_pair_score: stats?.lowest_pair_score || "",
                fuzzy_pair_count_in_group: stats?.pair_count || 0,
                fuzzy_pair_summary: stats?.pair_reasons.join(" | ") || "",
                fuzzy_group_logic:
                    "connected group built from fuzzy pair matches sharing same gender, birthdate, and composite ZIP",
            };
        })
        .sort((a, b) => {
            if (b.group_record_count !== a.group_record_count) {
                return b.group_record_count - a.group_record_count;
            }

            if (b.best_pair_score !== a.best_pair_score) {
                return b.best_pair_score - a.best_pair_score;
            }

            return String(a.names_in_group || "").localeCompare(String(b.names_in_group || ""));
        });
}

module.exports = {
    UnionFind,
    build_fuzzy_groups,
};

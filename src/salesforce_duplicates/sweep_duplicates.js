/**
 * sweep_duplicates.js — Duplicate criteria tuning CLI.
 *
 * Fetch the Account records ONCE (snapshot), then replay duplicate detection over
 * many criteria combinations (fuzzy threshold, nickname on/off, which of
 * gender/birthdate/zip are required, ZIP trim, name weights) and compare the
 * counts side by side. Production code is never touched — all matching runs through
 * the self-contained engine in src/sweep.js.
 *
 * Subcommands:
 *   snapshot [--test|--prod|--full|--partial]   fetch once, cache to the tuning folder
 *   run      [--grid <file>] [--snapshot <file>] replay the grid, print the summary + table
 *   detail   <profile-label>                     write the matched pairs for one profile
 *   diff     <labelA> <labelB>                    pair-level diff between two profiles
 *
 * Output goes to the `usat_salesforce_duplicates_tuning` folder (a sibling of the
 * production output folder) — the production output folder is never touched.
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config({ path: '../../.env' });

const fs = require('fs');
const path = require('path');

const { resolve_is_test, resolve_is_full, resolve_is_partial, resolve_fetch_plan,
        TUNING_DIR_NAME, SWEEP_SNAPSHOT_FILE, SWEEP_SUMMARY_FILE } = require('./config');
const { fetch_salesforce_accounts } = require('./src/salesforce');
const { colorize } = require('./src/log');
const { create_directory } = require('../../utilities/createDirectory');
const {
    expand_grid,
    run_profile,
    diff_profiles,
    fields_abbrev,
} = require('./src/sweep');

const DEFAULT_GRID_FILE = path.join(__dirname, 'sweep_grid.json');

// Tuning output folder. Honors SWEEP_TUNING_DIR (any writable path) if set;
// otherwise uses the cross-platform /data path resolved by createDirectory.
async function resolve_tuning_dir() {
    const override = process.env.SWEEP_TUNING_DIR;
    if (override) {
        fs.mkdirSync(override, { recursive: true });
        return override;
    }
    return create_directory(TUNING_DIR_NAME);
}

const n = (v) => Number(v || 0).toLocaleString();

// ---------- shared helpers ----------

function load_grid(grid_path) {
    const raw = JSON.parse(fs.readFileSync(grid_path, 'utf8'));
    // strip comment / non-array keys
    const grid = {};
    for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v)) grid[k] = v;
    }
    return grid;
}

async function load_snapshot(explicit_path) {
    const dir = await resolve_tuning_dir();
    const snap_path = explicit_path || path.join(dir, SWEEP_SNAPSHOT_FILE);
    if (!fs.existsSync(snap_path)) {
        throw new Error(`No snapshot found at ${snap_path}. Run:  node sweep_duplicates.js snapshot --test`);
    }
    const snap = JSON.parse(fs.readFileSync(snap_path, 'utf8'));
    return { snap, snap_path };
}

function criteria_conditions_line(c) {
    return `threshold=${c.fuzzy_threshold}  nickname=${c.nickname_enabled ? 'ON' : 'OFF'}  `
        + `zip_trim=${c.zip_trim_len}  rule_fields=${c.rule_fields.join('+')}  `
        + `weights f/l=${c.weight_first}/${c.weight_last}`;
}

// ---------- snapshot ----------

async function cmd_snapshot(argv) {
    const is_test = resolve_is_test(argv);
    const is_full = resolve_is_full(argv);
    const is_partial = resolve_is_partial(argv);
    const { max_fetch } = resolve_fetch_plan(is_test, is_full, is_partial);

    console.log(colorize('bright', 'Duplicate sweep — snapshot'));
    console.log(`Mode: ${is_test ? 'TEST (dev sandbox)' : 'PRODUCTION'}${is_full ? ' FULL' : ''}${is_partial ? ' PARTIAL' : ''}   max_fetch=${n(max_fetch)}`);

    const script_start_ms = Date.now();
    const { result } = await fetch_salesforce_accounts({ is_test, is_full, is_partial, max_fetch, script_start_ms });
    const records = result.records;

    const dir = await resolve_tuning_dir();
    const snap_path = path.join(dir, SWEEP_SNAPSHOT_FILE);
    const snapshot = {
        meta: {
            fetched_at: new Date().toISOString(),
            mode: is_test ? 'test' : 'prod',
            is_full,
            is_partial,
            max_fetch,
            record_count: records.length,
            salesforce_total_size: result.totalSize,
        },
        records,
    };
    fs.writeFileSync(snap_path, JSON.stringify(snapshot));
    console.log(colorize('green', `\nSnapshot saved: ${snap_path}`));
    console.log(`Records cached: ${n(records.length)} (Salesforce total: ${n(result.totalSize)})`);
    console.log(`\nNext:  node sweep_duplicates.js run`);
}

// ---------- run ----------

async function cmd_run(argv) {
    const grid_path = arg_value(argv, '--grid') || DEFAULT_GRID_FILE;
    const snap_arg = arg_value(argv, '--snapshot');
    const { snap, snap_path } = await load_snapshot(snap_arg);
    const grid = load_grid(grid_path);
    const profiles = expand_grid(grid);

    console.log(colorize('bright', '============================================================'));
    console.log(colorize('bright', 'DUPLICATE CRITERIA SWEEP'));
    console.log(colorize('bright', '============================================================'));
    console.log(`Snapshot : ${n(snap.meta.record_count)} records  (fetched ${snap.meta.fetched_at}, mode=${snap.meta.mode}${snap.meta.is_full ? ' full' : ''}${snap.meta.is_partial ? ' partial' : ''})`);
    console.log(`Grid     : ${path.basename(grid_path)}  ->  ${profiles.length} profiles`);
    console.log('');

    const results = profiles.map((c) => run_profile(snap.records, c));
    const baseline = results[0];

    // per-profile detail blocks
    for (const r of results) {
        const c = r.criteria;
        const k = r.counts;
        const is_base = c.is_baseline;
        const title = is_base ? `[baseline]  ${criteria_conditions_line(c)}` : `[${c.label}]`;
        console.log(colorize('bright', title));
        if (!is_base) console.log(`  Conditions : ${criteria_conditions_line(c)}`);
        console.log(`  Funnel     : ${n(k.total_records)} records -> ${n(k.eligible_records)} eligible (${c.rule_fields.join('+')} present) -> ${n(k.rule_blocks)} blocks -> ${n(k.pairs_compared)} pairs compared`);
        console.log(`  Exact      : ${n(k.exact_groups)} groups (${n(k.exact_records)} records)`);
        console.log(`  Fuzzy      : ${n(k.fuzzy_pairs)} pairs`);
        console.log(`  Nickname   : ${n(k.nickname_pairs)} pairs (${n(k.nickname_only)} net-new, ${n(k.nickname_both)} also-fuzzy)`);
        console.log(`  Consolidated: ${n(k.consolidated_clusters)} clusters [exact ${n(k.tier_exact)} | fuzzy ${n(k.tier_fuzzy)} | nickname ${n(k.tier_nickname)}]`);
        if (is_base) {
            console.log(colorize('gray', '  vs baseline: — (this is the baseline)'));
        } else {
            const d = diff_profiles(baseline.edges, r.edges);
            console.log(`  vs baseline: ${colorize('green', '+' + n(d.only_in_b))} matched pairs / ${colorize('red', '-' + n(d.only_in_a))} (common ${n(d.common)})`);
        }
        console.log('');
    }

    // comparison table
    print_table(results, baseline);

    // CSV
    const csv_path = await write_summary_csv(results, baseline);
    console.log(colorize('green', `\nSummary CSV written: ${csv_path}`));
    console.log(`Drill in:  node sweep_duplicates.js detail "<profile-label>"`);
    console.log(`Compare :  node sweep_duplicates.js diff "<labelA>" "<labelB>"`);
}

function pad(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function padl(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

function print_table(results, baseline) {
    console.log(colorize('bright', 'COMPARISON TABLE'));
    console.log(colorize('bright', '----------------'));
    console.log(
        pad('Profile', 34) + padl('Thr', 4) + padl('Nick', 6) + padl('Fields', 8)
        + padl('Exact', 7) + padl('Fuzzy', 7) + padl('Nick', 6) + padl('Consol', 8) + padl('dPairs', 12)
    );
    for (const r of results) {
        const c = r.criteria;
        const k = r.counts;
        let delta = '—';
        if (!c.is_baseline) {
            const d = diff_profiles(baseline.edges, r.edges);
            delta = `+${d.only_in_b}/-${d.only_in_a}`;
        }
        console.log(
            pad(c.is_baseline ? 'baseline' : c.label, 34)
            + padl(c.fuzzy_threshold, 4)
            + padl(c.nickname_enabled ? 'ON' : 'OFF', 6)
            + padl(fields_abbrev(c.rule_fields), 8)
            + padl(n(k.exact_groups), 7)
            + padl(n(k.fuzzy_pairs), 7)
            + padl(n(k.nickname_pairs), 6)
            + padl(n(k.consolidated_clusters), 8)
            + padl(delta, 12)
        );
    }
}

function csv_cell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function write_summary_csv(results, baseline) {
    const dir = await resolve_tuning_dir();
    const csv_path = path.join(dir, SWEEP_SUMMARY_FILE);
    const header = [
        'label', 'is_baseline', 'fuzzy_threshold', 'nickname_enabled', 'rule_fields', 'zip_trim_len',
        'weight_first', 'weight_last', 'nickname_last_name_min_score',
        'total_records', 'eligible_records', 'rule_blocks', 'pairs_compared',
        'exact_groups', 'exact_records', 'fuzzy_pairs',
        'nickname_pairs', 'nickname_only', 'nickname_both',
        'consolidated_clusters', 'tier_exact', 'tier_fuzzy', 'tier_nickname',
        'added_vs_baseline', 'removed_vs_baseline', 'common_vs_baseline',
    ];
    const lines = [header.join(',')];
    for (const r of results) {
        const c = r.criteria;
        const k = r.counts;
        let added = '', removed = '', common = '';
        if (!c.is_baseline) {
            const d = diff_profiles(baseline.edges, r.edges);
            added = d.only_in_b; removed = d.only_in_a; common = d.common;
        }
        lines.push([
            c.label, c.is_baseline ? 1 : 0, c.fuzzy_threshold, c.nickname_enabled, c.rule_fields.join('+'), c.zip_trim_len,
            c.weight_first, c.weight_last, c.nickname_last_name_min_score,
            k.total_records, k.eligible_records, k.rule_blocks, k.pairs_compared,
            k.exact_groups, k.exact_records, k.fuzzy_pairs,
            k.nickname_pairs, k.nickname_only, k.nickname_both,
            k.consolidated_clusters, k.tier_exact, k.tier_fuzzy, k.tier_nickname,
            added, removed, common,
        ].map(csv_cell).join(','));
    }
    fs.writeFileSync(csv_path, lines.join('\n') + '\n');
    return csv_path;
}

// ---------- detail ----------

async function cmd_detail(argv) {
    const label = argv.find((a) => !a.startsWith('--'));
    if (!label) throw new Error('Usage: node sweep_duplicates.js detail "<profile-label>"');
    const { snap } = await load_snapshot(arg_value(argv, '--snapshot'));
    const grid = load_grid(arg_value(argv, '--grid') || DEFAULT_GRID_FILE);
    const profiles = expand_grid(grid);
    const profile = profiles.find((p) => p.label === label || (label === 'baseline' && p.is_baseline));
    if (!profile) {
        console.log(`Profile "${label}" not found. Available labels:`);
        for (const p of profiles) console.log('  ' + p.label);
        return;
    }
    const r = run_profile(snap.records, profile);
    const lookup = new Map(snap.records.map((rec) => [rec.Id, rec]));
    const dir = await resolve_tuning_dir();
    const out = path.join(dir, `sweep_detail_${label.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`);
    const lines = ['record_id_1,name_1,record_id_2,name_2,signal,spelling,nickname'];
    for (const e of r.edges) {
        const a = lookup.get(e.a) || {};
        const b = lookup.get(e.b) || {};
        lines.push([
            e.a, `${a.FirstName || ''} ${a.LastName || ''}`.trim(),
            e.b, `${b.FirstName || ''} ${b.LastName || ''}`.trim(),
            e.type, e.spelling, e.nickname,
        ].map(csv_cell).join(','));
    }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(colorize('bright', `[${profile.label}] ${criteria_conditions_line(profile)}`));
    console.log(`Matched pairs: ${n(r.edges.length)}  ->  ${out}`);
}

// ---------- diff ----------

async function cmd_diff(argv) {
    const labels = argv.filter((a) => !a.startsWith('--'));
    if (labels.length < 2) throw new Error('Usage: node sweep_duplicates.js diff "<labelA>" "<labelB>"');
    const [la, lb] = labels;
    const { snap } = await load_snapshot(arg_value(argv, '--snapshot'));
    const grid = load_grid(arg_value(argv, '--grid') || DEFAULT_GRID_FILE);
    const profiles = expand_grid(grid);
    const pa = profiles.find((p) => p.label === la || (la === 'baseline' && p.is_baseline));
    const pb = profiles.find((p) => p.label === lb || (lb === 'baseline' && p.is_baseline));
    if (!pa || !pb) {
        console.log('One or both labels not found. Available:');
        for (const p of profiles) console.log('  ' + p.label);
        return;
    }
    const ra = run_profile(snap.records, pa);
    const rb = run_profile(snap.records, pb);
    const d = diff_profiles(ra.edges, rb.edges);
    const lookup = new Map(snap.records.map((rec) => [rec.Id, rec]));
    const name = (id) => { const r = lookup.get(id) || {}; return `${r.FirstName || ''} ${r.LastName || ''}`.trim(); };

    console.log(colorize('bright', `DIFF  [${la}]  vs  [${lb}]`));
    console.log(`  ${la}: ${criteria_conditions_line(pa)}`);
    console.log(`  ${lb}: ${criteria_conditions_line(pb)}`);
    console.log(`  common matched pairs : ${n(d.common)}`);
    console.log(colorize('red', `  only in ${la} : ${n(d.only_in_a)}`));
    console.log(colorize('green', `  only in ${lb} : ${n(d.only_in_b)}`));

    const dir = await resolve_tuning_dir();
    const out = path.join(dir, `sweep_diff_${la.replace(/[^A-Za-z0-9_-]/g, '_')}__${lb.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`);
    const lines = ['only_in,pair,name_1,name_2,signal'];
    for (const x of d.added) { const [a, b] = x.pair.split('|'); lines.push([la, x.pair, name(a), name(b), x.type].map(csv_cell).join(',')); }
    for (const x of d.removed) { const [a, b] = x.pair.split('|'); lines.push([lb, x.pair, name(a), name(b), x.type].map(csv_cell).join(',')); }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(colorize('green', `\nDiff CSV written: ${out}`));
}

// ---------- arg parsing + dispatch ----------

function arg_value(argv, flag) {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function usage() {
    console.log(`Duplicate criteria tuning sweep

Usage:
  node sweep_duplicates.js snapshot [--test|--prod|--full|--partial]
  node sweep_duplicates.js run      [--grid <file>] [--snapshot <file>]
  node sweep_duplicates.js detail   "<profile-label>"
  node sweep_duplicates.js diff     "<labelA>" "<labelB>"

snapshot  fetch the Account records ONCE and cache them in the tuning folder.
run       replay the grid over the snapshot; print the summary + comparison table
          and write sweep_summary.csv.
detail    write the matched pairs for one profile to a CSV.
diff      pair-level difference between two profiles.

The default grid lives in sweep_grid.json (edit it freely). Output goes to the
${TUNING_DIR_NAME} folder; the production output folder is never touched.`);
}

async function main() {
    const [, , cmd, ...rest] = process.argv;
    try {
        switch (cmd) {
            case 'snapshot': await cmd_snapshot(rest); break;
            case 'run': await cmd_run(rest); break;
            case 'detail': await cmd_detail(rest); break;
            case 'diff': await cmd_diff(rest); break;
            default: usage();
        }
    } catch (err) {
        console.error(colorize('red', `Error: ${err.message}`));
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = { load_grid, criteria_conditions_line };

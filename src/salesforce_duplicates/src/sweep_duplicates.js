/**
 * sweep_duplicates.js — Duplicate criteria tuning CLI.
 *
 * Fetch the Account records ONCE (snapshot), then replay duplicate detection over
 * many criteria combinations (fuzzy threshold, nickname on/off, which of
 * gender/birthdate/zip are required, ZIP trim, name weights) and compare the
 * counts side by side. Production code is never touched — all matching runs through
 * the self-contained engine in src/sweep.js.
 *
 * Lives in src/ with the other modules; run it from the project folder:
 *   node src/sweep_duplicates.js snapshot [--test|--prod|--full|--partial]
 *   node src/sweep_duplicates.js run      [--grid <file>] [--snapshot <file>]
 *   node src/sweep_duplicates.js detail   "<profile-label>"
 *   node src/sweep_duplicates.js diff     "<labelA>" "<labelB>"
 *
 * Output goes to the `usat_salesforce_duplicates_tuning` folder (a sibling of the
 * production output folder) — the production output folder is never touched.
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const fs = require('fs');

const { resolve_is_test, resolve_is_full, resolve_is_partial, resolve_fetch_plan,
        TUNING_DIR_NAME, SWEEP_SUMMARY_FILE, DEFAULT_SWEEP_GRID, DB_LOAD_PROGRESS_EVERY } = require('../config');
const { fetch_salesforce_accounts } = require('./salesforce');
const { open_local_executor, load_snapshot, read_records, count_rows } = require('./database_snapshot');
const { write_run, read_latest_run } = require('./database_results');
const { make_run_id } = require('./ids');
const { colorize, log_info } = require('./log');
const { create_directory } = require('../../../utilities/createDirectory');
const {
    expand_grid,
    run_profile,
    diff_profiles,
    fields_abbrev,
} = require('./sweep');

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

// Compact duration: "42.3s" under a minute, "3m 21s" at or above one.
function fmt_secs(s) {
    s = Math.max(0, s);
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s - m * 60)}s`;
}

// ---------- grid ----------

// Load a one-off grid JSON file (only array-valued keys are kept).
function load_grid(grid_path) {
    const raw = JSON.parse(fs.readFileSync(grid_path, 'utf8'));
    const grid = {};
    for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v)) grid[k] = v;
    }
    return grid;
}

// The grid to use: the --grid file if given, otherwise the default baked into config.js.
function resolve_grid(argv) {
    const grid_path = arg_value(argv, '--grid');
    if (grid_path) return { grid: load_grid(grid_path), source: path.basename(grid_path) };
    return { grid: DEFAULT_SWEEP_GRID, source: 'config.js (DEFAULT_SWEEP_GRID)' };
}

// ---------- shared helpers ----------

// Read the snapshot from the local DB (the salesforce_account_duplicate_snapshot
// table + its meta table). Replaces the old snapshot.json. Returns { meta, records }.
async function read_snapshot() {
    const { pool, executor } = await open_local_executor();
    try {
        const run = await read_latest_run(executor);
        if (!run) {
            throw new Error('No snapshot in the database. Run:  node src/sweep_duplicates.js snapshot --test');
        }
        const records = await read_records(executor);
        const meta = {
            record_count: run.total_records_scanned,
            fetched_at: run.run_at,
            mode: run.mode,
            is_full: run.is_full,
            is_partial: run.is_partial,
            salesforce_total_size: run.salesforce_total_size,
        };
        return { meta, records };
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }
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

    console.log(colorize('gray', `Streaming ${n(records.length)} records into the snapshot table...`));
    const { pool, executor } = await open_local_executor();
    let loaded;
    try {
        loaded = await load_snapshot(records, {
            executor,
            progress_every: DB_LOAD_PROGRESS_EVERY,
            on_progress: (done, total) => log_info(
                `Loaded ${n(done)} / ${n(total)} rows (${total ? Math.round((done / total) * 100) : 0}%) into the snapshot table`,
                script_start_ms),
        });
        await write_run(executor, {
            run_id: make_run_id(new Date()),
            run_type: 'snapshot',
            mode: is_test ? 'test' : 'prod',
            is_full,
            is_partial,
            run_at: new Date().toISOString(),
            total_records_scanned: loaded,
            salesforce_total_size: result.totalSize,
            // detection counts are null for a snapshot-only run
        });
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }

    const skipped = records.length - loaded;
    console.log(colorize('green', `\nSnapshot loaded into the database: ${loaded.toLocaleString()} rows.`));
    if (skipped > 0) console.log(colorize('gray', `Skipped ${n(skipped)} non-record/duplicate rows (e.g. Bulk API header artifacts).`));
    console.log(`Salesforce total: ${n(result.totalSize)}`);
    console.log(`\nNext:  node src/sweep_duplicates.js run`);
}

// ---------- run ----------

async function cmd_run(argv) {
    const { meta, records } = await read_snapshot();
    const { grid, source } = resolve_grid(argv);
    const profiles = expand_grid(grid);

    console.log(colorize('bright', '============================================================'));
    console.log(colorize('bright', 'DUPLICATE CRITERIA SWEEP'));
    console.log(colorize('bright', '============================================================'));
    console.log(`Snapshot : ${n(meta.record_count)} records  (fetched ${meta.fetched_at}, mode=${meta.mode}${meta.is_full ? ' full' : ''}${meta.is_partial ? ' partial' : ''})  [from the database]`);
    console.log(`Grid     : ${source}  ->  ${profiles.length} profiles`);
    console.log('');

    // Run each profile with a live progress line. The sweep replays the full detection
    // pipeline (exact + fuzzy + nickname + consolidated) once PER profile over every
    // snapshot record, so on a large prod snapshot this is the slow part — without these
    // lines the CLI looks hung while it churns through all the profiles in silence.
    const sweep_start = Date.now();
    const results = [];
    for (let i = 0; i < profiles.length; i++) {
        const c = profiles[i];
        const label = c.is_baseline ? 'baseline' : c.label;
        process.stdout.write(colorize('gray', `[${i + 1}/${profiles.length}] ${label} ... `));
        const t0 = Date.now();
        results.push(run_profile(records, c));
        const done = i + 1;
        const remaining = profiles.length - done;
        // ETA = average time per completed profile * profiles still to go. Steadies as
        // more profiles finish; suppressed on the last one (nothing left to estimate).
        const eta = remaining > 0 ? `  (~${fmt_secs((Date.now() - sweep_start) / done / 1000 * remaining)} left)` : '';
        console.log(colorize('gray', `done in ${fmt_secs((Date.now() - t0) / 1000)}${eta}`));
    }
    console.log(colorize('gray', `All ${profiles.length} profiles complete in ${fmt_secs((Date.now() - sweep_start) / 1000)}\n`));
    const baseline = results[0];

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

    print_table(results, baseline);

    const csv_path = await write_summary_csv(results, baseline);
    console.log(colorize('green', `\nSummary CSV written: ${csv_path}`));
    console.log(`Drill in:  node src/sweep_duplicates.js detail "<profile-label>"`);
    console.log(`Compare :  node src/sweep_duplicates.js diff "<labelA>" "<labelB>"`);

    // Log this sweep run to the unified logbook (run_type 'sweep'); the baseline profile
    // (production-equivalent) supplies the representative counts. A logging failure must
    // not fail the sweep.
    try {
        const { pool, executor } = await open_local_executor();
        try {
            await write_run(executor, {
                run_id: make_run_id(new Date()),
                run_type: 'sweep',
                mode: meta.mode,
                is_full: meta.is_full,
                is_partial: meta.is_partial,
                run_at: new Date().toISOString(),
                total_records_scanned: meta.record_count,
                salesforce_total_size: meta.salesforce_total_size,
                exact_duplicate_groups: baseline.counts.exact_groups,
                fuzzy_pair_matches: baseline.counts.fuzzy_pairs,
                nickname_pair_matches: baseline.counts.nickname_pairs,
                consolidated_clusters: baseline.counts.consolidated_clusters,
            });
            console.log(colorize('gray', 'Sweep run logged to salesforce_duplicate_detection_run.'));
        } finally {
            try { pool.end(); } catch (_) { /* ignore */ }
        }
    } catch (e) {
        console.log(colorize('gray', `(Could not log the sweep run: ${e.message})`));
    }
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
    if (!label) throw new Error('Usage: node src/sweep_duplicates.js detail "<profile-label>"');
    const { records } = await read_snapshot();
    const { grid } = resolve_grid(argv);
    const profiles = expand_grid(grid);
    const profile = profiles.find((p) => p.label === label || (label === 'baseline' && p.is_baseline));
    if (!profile) {
        console.log(`Profile "${label}" not found. Available labels:`);
        for (const p of profiles) console.log('  ' + p.label);
        return;
    }
    const r = run_profile(records, profile);
    const lookup = new Map(records.map((rec) => [rec.Id, rec]));
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
    if (labels.length < 2) throw new Error('Usage: node src/sweep_duplicates.js diff "<labelA>" "<labelB>"');
    const [la, lb] = labels;
    const { records } = await read_snapshot();
    const { grid } = resolve_grid(argv);
    const profiles = expand_grid(grid);
    const pa = profiles.find((p) => p.label === la || (la === 'baseline' && p.is_baseline));
    const pb = profiles.find((p) => p.label === lb || (lb === 'baseline' && p.is_baseline));
    if (!pa || !pb) {
        console.log('One or both labels not found. Available:');
        for (const p of profiles) console.log('  ' + p.label);
        return;
    }
    const ra = run_profile(records, pa);
    const rb = run_profile(records, pb);
    const d = diff_profiles(ra.edges, rb.edges);
    const lookup = new Map(records.map((rec) => [rec.Id, rec]));
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

// ---------- inspect ----------

// Read-only: fetch from Salesforce and report any record whose Id is NOT a valid
// 15/18-char Salesforce Id, plus any Id that appears more than once. Writes nothing.
// This is how you confirm the "Id === 'Id'" rows are a Bulk CSV-header parsing
// artifact (they show up via the Bulk API, not via REST) and not real records.
async function cmd_inspect(argv) {
    const is_test = resolve_is_test(argv);
    const is_full = resolve_is_full(argv);
    const is_partial = resolve_is_partial(argv);
    const { max_fetch, use_rest } = resolve_fetch_plan(is_test, is_full, is_partial);

    console.log(colorize('bright', 'Fetch inspection (read-only, no DB write)'));
    console.log(`Mode: ${is_test ? 'TEST' : 'PRODUCTION'}${is_full ? ' FULL' : ''}${is_partial ? ' PARTIAL' : ''}  via ${use_rest ? 'REST' : 'Bulk API'}  max_fetch=${n(max_fetch)}`);

    const script_start_ms = Date.now();
    const { result } = await fetch_salesforce_accounts({ is_test, is_full, is_partial, max_fetch, script_start_ms });
    const records = result.records;

    const SF_ID = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;
    const anomalous = [];
    const id_counts = new Map();
    for (const r of records) {
        const id = r && r.Id;
        if (!id || !SF_ID.test(String(id))) anomalous.push(r);
        id_counts.set(id, (id_counts.get(id) || 0) + 1);
    }
    const dups = [...id_counts.entries()].filter(([, c]) => c > 1);

    console.log('');
    console.log(`Total fetched                                  : ${n(records.length)}`);
    console.log(`Records whose Id is NOT a valid SF Id (15/18)  : ${n(anomalous.length)}`);
    console.log(`Distinct Id values appearing more than once    : ${n(dups.length)}`);

    if (anomalous.length) {
        console.log(colorize('bright', '\nFirst anomalous records (raw JSON — this is what tried to load as a row):'));
        for (const r of anomalous.slice(0, 10)) console.log('  ' + JSON.stringify(r));
    }
    if (dups.length) {
        console.log(colorize('bright', '\nDuplicated Id values (first 10):'));
        for (const [id, c] of dups.slice(0, 10)) console.log(`  ${JSON.stringify(id)}  x${c}`);
    }
    if (!anomalous.length && !dups.length) {
        console.log(colorize('green', '\nNo anomalies — every record has a unique, valid Salesforce Id.'));
    }
}

// ---------- status ----------

// Verify the DB snapshot: print the meta + live row count straight from the database.
async function cmd_status() {
    const { pool, executor } = await open_local_executor();
    try {
        const run = await read_latest_run(executor);
        if (!run) {
            console.log(colorize('gray', 'No run logged in the database yet.'));
            console.log('Run:  node src/sweep_duplicates.js snapshot --test   (or a finder run)');
            return;
        }
        const live = await count_rows(executor);
        console.log(colorize('bright', 'Latest run (from the unified run table)'));
        console.log(`  run_id             : ${run.run_id}`);
        console.log(`  Type               : ${run.run_type}`);
        console.log(`  Mode               : ${run.mode}${run.is_full ? ' full' : ''}${run.is_partial ? ' partial' : ''}`);
        console.log(`  Run at             : ${run.run_at}`);
        console.log(`  Records (logged)   : ${n(run.total_records_scanned)}`);
        console.log(`  Records (live count): ${n(live)}`);
        console.log(`  Salesforce total   : ${n(run.salesforce_total_size)}`);
        if (run.run_type === 'finder') {
            console.log(`  Exact / Fuzzy / Nickname / Consolidated: ${n(run.exact_duplicate_groups)} / ${n(run.fuzzy_pair_matches)} / ${n(run.nickname_pair_matches)} / ${n(run.consolidated_clusters)}`);
        }
        if (live !== run.total_records_scanned) {
            console.log(colorize('red', '  NOTE: live row count differs from the logged count (a later run reloaded the table).'));
        } else {
            console.log(colorize('green', '  OK: live row count matches the latest logged run.'));
        }
    } finally {
        try { pool.end(); } catch (_) { /* ignore */ }
    }
}

// ---------- arg parsing + dispatch ----------

function arg_value(argv, flag) {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function usage() {
    console.log(`Duplicate criteria tuning sweep

Usage:
  node src/sweep_duplicates.js snapshot [--test|--prod|--full|--partial]
  node src/sweep_duplicates.js run      [--grid <file>]
  node src/sweep_duplicates.js status
  node src/sweep_duplicates.js inspect  [--test|--prod|--full|--partial]
  node src/sweep_duplicates.js detail   "<profile-label>"
  node src/sweep_duplicates.js diff     "<labelA>" "<labelB>"

snapshot  fetch the Account records ONCE and STREAM them into the local DB table
          salesforce_account_duplicate_snapshot (+ a meta table). No JSON file.
run       replay the grid over the DB snapshot; print the summary + comparison table
          and write sweep_summary.csv.
status    print the DB snapshot meta + live row count (verify the snapshot is loaded).
inspect   fetch (read-only, no DB) and report any non-valid / duplicate Ids.
detail    write the matched pairs for one profile to a CSV.
diff      pair-level difference between two profiles.

The default grid lives in config.js (DEFAULT_SWEEP_GRID); pass --grid <file> to use a
one-off JSON grid instead. Output goes to the ${TUNING_DIR_NAME} folder; the
production output folder is never touched.`);
}

async function main() {
    const [, , cmd, ...rest] = process.argv;
    try {
        switch (cmd) {
            case 'snapshot': await cmd_snapshot(rest); break;
            case 'run': await cmd_run(rest); break;
            case 'status': await cmd_status(rest); break;
            case 'inspect': await cmd_inspect(rest); break;
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

module.exports = { load_grid, resolve_grid, criteria_conditions_line };

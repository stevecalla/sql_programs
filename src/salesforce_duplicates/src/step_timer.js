/**
 * step_timer.js — Lightweight per-step stopwatch for the run pipeline.
 *
 * Mirrors the stage timer in ../../event_analysis/build_all.js so the two
 * tools report timing the same way. Two pieces of output:
 *
 *   1. A live one-line "[STEP] <label> — <Xs>" as each big step finishes, so
 *      you can watch progress and see exactly when each stage is done.
 *   2. An end-of-run timeline (largest first, with bars + a TOTAL) printed by
 *      print_summary(), so the slow stage is obvious at a glance.
 *
 * create_step_timer() returns the timer. `now` and `log` are injectable so the
 * unit test can drive it deterministically without touching the clock/console.
 *
 * Usage:
 *   const timer = create_step_timer();
 *   ...work...
 *   timer.stage_done('fetch from Salesforce');
 *   ...more work...
 *   timer.stage_done('exact duplicates');
 *   timer.print_summary();
 */

'use strict';

const { colorize } = require('./log');

const LABEL_WIDTH = 30;
const BAR_WIDTH = 28;

function create_step_timer({ now = () => Date.now(), log = console.log } = {}) {
    const stages = [];
    const t0 = now();
    let stage_t0 = t0;

    // Record elapsed since the previous mark (or since creation on the first
    // call), reset the stopwatch, and print a live completion line. Returns the
    // measured milliseconds. Place the call right after the work it measures.
    function stage_done(label) {
        const ms = now() - stage_t0;
        stages.push({ label, ms });
        stage_t0 = now();
        log(
            `${colorize('cyan', '[STEP]')} ${String(label).padEnd(LABEL_WIDTH)} ` +
            `${colorize('gray', (ms / 1000).toFixed(1) + 's')}`
        );
        return ms;
    }

    // Build the end-of-run timeline as an array of lines (pure — no I/O), so the
    // test can assert on it. Sorted largest-first: the hot spot sits on top.
    function summary_lines() {
        const total = now() - t0;
        const lines = [];
        lines.push('──────────────────────────────────────────────────────');
        lines.push('Run timing (largest first):');
        for (const s of [...stages].sort((a, b) => b.ms - a.ms)) {
            const bar_len = total > 0 ? Math.round((s.ms / total) * BAR_WIDTH) : 0;
            const bar = '█'.repeat(bar_len);
            const secs = (s.ms / 1000).toFixed(2) + 's';
            lines.push(`  ${s.label.padEnd(LABEL_WIDTH)} ${secs.padStart(8)}  ${bar}`);
        }
        lines.push(`  ${'─'.repeat(LABEL_WIDTH)} ${'─'.repeat(8)}`);
        lines.push(`  ${'TOTAL'.padEnd(LABEL_WIDTH)} ${((total / 1000).toFixed(2) + 's').padStart(8)}`);
        lines.push('──────────────────────────────────────────────────────');
        return lines;
    }

    function print_summary() {
        log('');
        for (const line of summary_lines()) log(line);
    }

    return { stage_done, print_summary, summary_lines, stages };
}

module.exports = { create_step_timer };

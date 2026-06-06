/**
 * step_timer.test.js — Unit tests for src/step_timer.js.
 *
 * `now` and `log` are injected so the timer is fully deterministic and silent.
 *
 * Run from src/salesforce_duplicates via:
 *   node --test tests/step_timer.test.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { create_step_timer } = require('../src/step_timer');

// A fake clock: returns each value in `ticks` on successive calls, holding the
// last value once exhausted.
function fake_now(ticks) {
    let i = 0;
    return () => ticks[Math.min(i++, ticks.length - 1)];
}

describe('create_step_timer', () => {
    test('stage_done records elapsed since the previous mark', () => {
        // t0=0; after "a" clock=100 (100ms); after "b" clock=350 (250ms)
        const timer = create_step_timer({ now: fake_now([0, 100, 100, 350, 350]), log: () => {} });
        const a = timer.stage_done('a');
        const b = timer.stage_done('b');
        assert.equal(a, 100);
        assert.equal(b, 250);
        assert.deepEqual(timer.stages, [{ label: 'a', ms: 100 }, { label: 'b', ms: 250 }]);
    });

    test('stage_done prints one live line per call', () => {
        const lines = [];
        const timer = create_step_timer({ now: fake_now([0, 100, 100, 200]), log: (m) => lines.push(m) });
        timer.stage_done('fetch from Salesforce');
        timer.stage_done('exact duplicates');
        assert.equal(lines.length, 2);
        assert.match(lines[0], /\[STEP\]/);
        assert.match(lines[0], /fetch from Salesforce/);
        assert.match(lines[0], /0\.1s/);
    });

    test('summary_lines sorts largest-first and ends with a TOTAL', () => {
        // a=100ms, b=300ms, c=50ms; total read at 450
        const timer = create_step_timer({
            now: fake_now([0, 100, 100, 400, 400, 450, 450]),
            log: () => {},
        });
        timer.stage_done('a'); // 100
        timer.stage_done('b'); // 300
        timer.stage_done('c'); // 50
        const lines = timer.summary_lines();
        const body = lines.filter((l) => /^\s{2}\S/.test(l) && !/^\s+─/.test(l));
        // First data row is the biggest stage (b), last is TOTAL.
        assert.match(body[0], /^\s{2}b\b/);
        assert.match(body[body.length - 1], /TOTAL/);
        assert.match(body[body.length - 1], /0\.45s/);
    });

    test('handles the zero-total edge case without dividing by zero', () => {
        const timer = create_step_timer({ now: () => 0, log: () => {} });
        timer.stage_done('instant');
        const lines = timer.summary_lines();
        // No bar characters when total is 0, and no throw.
        assert.ok(lines.some((l) => /instant/.test(l)));
        assert.ok(lines.every((l) => !/█/.test(l)));
    });
});

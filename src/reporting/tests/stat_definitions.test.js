'use strict';
// Guards the "race-side vs membership/sales-side" column rule for the reporting stats (no DB needed).
// The parent table has two sets of event columns; stats MUST use the race-side ones. These bugs shipped
// once (every race mislabeled "Visit Panama City Beach…"; Events inflated ~3×) — this locks the fix in.
// See plans_and_notes/FIELD_MAPPING.md and CLAUDE.md → "Stat definitions".
const test = require('node:test');
const assert = require('node:assert');

const {
  create_participation_summary_table,
  create_participation_events_table,
} = require('../../queries/participation_data/step_3i_create_participation_summary_table');

test('summary Events uses race-side id_events_rr, not sales-side id_events', async () => {
  const sql = await create_participation_summary_table('summary', 'base');
  assert.match(sql, /COUNT\(DISTINCT t\.id_events_rr\)\s+AS events/, 'Events must count DISTINCT id_events_rr');
  assert.match(sql, /COUNT\(DISTINCT t\.id_race_rr\)\s+AS races/, 'Races must count DISTINCT id_race_rr');
  // The sales-side id_events (COUNT(DISTINCT t.id_events) — note the ")" right after) must NOT be used.
  assert.ok(!/t\.id_events\)/.test(sql), 'must not use the sales-side id_events for a metric');
});

test('events builder uses race-side name + is_ironman flag, de-quoted, at sanctioning-event grain', async () => {
  const sql = await create_participation_events_table('events', 'base');
  assert.match(sql, /name_events_rr/, 'event name must come from name_events_rr');
  assert.ok(!/MAX\(t\.name_events\)/.test(sql), 'must not MAX the sales-side name_events');
  assert.match(sql, /is_ironman/, 'IRONMAN must use the is_ironman flag column');
  assert.match(sql, /TRIM\(BOTH '"'/, 'event name/city must be de-quoted in SQL');
  assert.match(sql, /id_sanctioning_events/, 'events group on id_sanctioning_events (event grain)');
  assert.match(sql, /id_events_rr/, 'per-event Events count must use id_events_rr');
});

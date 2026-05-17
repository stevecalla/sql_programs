#!/usr/bin/env node
/**
 * ask.js — Interactive analysis Q&A powered by Claude.
 *
 * Usage:
 *   node ask.js "Why did Adult Clinic decline so much?"
 *   node ask.js "What should be the top action item for August?"
 *   node ask.js "Rewrite the slide 3 narrative to be more concise"
 *   node ask.js "How does this compare to typical USAT patterns?"
 *   node ask.js --update-notes  (saves Claude's answer back to notes.md)
 *   node ask.js --update-commentary <key>  (regenerates a specific commentary key)
 *
 * Context loaded automatically:
 *   output/analysis_results.json  — full computed dataset
 *   output/commentary.json        — current narratives + notes
 *   notes.md                      — your analyst notes + prior observations
 *   output/archive/               — prior run results for trend comparison
 *
 * Requires ANTHROPIC_API_KEY in .env
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config({ path: "../../.env" });

const fs   = require('fs');
const path = require('path');

const DIR = __dirname;

// ── Load context files ─────────────────────────────────────────────────────

function load_json(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function load_text(fp) {
  try { return fs.readFileSync(fp, 'utf8'); }
  catch { return null; }
}

function load_prior_run() {
  const archive_dir = path.join(DIR, 'output', 'archive');
  if (!fs.existsSync(archive_dir)) return null;
  const runs = fs.readdirSync(archive_dir).sort().reverse();
  if (!runs.length) return null;
  const latest = path.join(archive_dir, runs[0], 'analysis_results.json') ;
  // analysis_results.json isn't archived — check for xlsx only
  // We compare segment counts from prior commentary if available
  const prior_cm = load_json(path.join(archive_dir, runs[0], 'commentary.json'));
  return prior_cm ? { archive_date: runs[0], ...prior_cm } : null;
}

// ── Build context for Claude ──────────────────────────────────────────────

function build_context(question) {
  const results   = load_json(path.join(DIR, 'output', 'analysis_results.json'));
  const commentary = load_json(path.join(DIR, 'output', 'commentary.json'));
  const notes      = load_text(path.join(DIR, 'notes.md'));
  const prior      = load_prior_run();

  const parts = [];

  if (results) {
    parts.push(`## Current Analysis Results (${results.generated_at?.slice(0,10) ?? 'latest'})`);
    if (results.overrides?.total_applied) {
      parts.push(`\nManual overrides active: ${results.overrides.total_applied} override(s) applied`);
      results.overrides.applied.forEach(o => {
        parts.push(`  - ${o.type}: ${o.sid_25 ?? ''}${o.sid_26 ? ' / ' + o.sid_26 : ''} → ${o.result}${o.note ? ' (' + o.note + ')' : ''}`);
      });
    }
    parts.push(`Years: ${results.years?.year_a} vs ${results.years?.year_b}`);
    parts.push(`Total events: ${results.totals?.year_a} → ${results.totals?.year_b} (net ${results.totals?.net >= 0 ? '+' : ''}${results.totals?.net})`);
    parts.push(`\nSegments: ${JSON.stringify(results.segments ?? {})}`);
    if (results.by_type) {
      parts.push('\nBy type:');
      Object.entries(results.by_type).forEach(([t, v]) => {
        if (v.n25) parts.push(`  ${t}: ${v.n25} → ${v.n26 ?? '?'} (delta ${v.delta >= 0 ? '+' : ''}${v.delta ?? '?'})`);
      });
    }
    if (results.monthly) {
      parts.push('\nMonthly net deltas:');
      Object.entries(results.monthly).forEach(([m, d]) => {
        const mn = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m)];
        parts.push(`  ${mn}: raw ${d.net_delta >= 0 ? '+' : ''}${d.net_delta ?? 0}, organic ${d.organic_delta >= 0 ? '+' : ''}${d.organic_delta ?? d.net_delta ?? 0}`);
      });
    }
    if (results.organic_by_type) {
      parts.push('\nOrganic performance by type:');
      Object.entries(results.organic_by_type).forEach(([t, v]) => {
        if (v.orgTotal !== undefined) parts.push(`  ${t}: organic delta ${v.orgTotal >= 0 ? '+' : ''}${v.orgTotal?.toFixed(1)}`);
      });
    }
  }

  if (commentary) {
    parts.push('\n## Current Commentary');
    parts.push(`Mode: ${commentary.mode ?? 'unknown'}`);
    if (commentary.slide_2_narrative) parts.push(`Slide 2 narrative: "${commentary.slide_2_narrative}"`);
    if (commentary.slide_4_narrative) parts.push(`Slide 4 narrative (calendar): "${commentary.slide_4_narrative}"`);
    if (commentary.slide_7_narrative) parts.push(`Slide 7 narrative (pipeline): "${commentary.slide_7_narrative}"`);
    if (commentary.slide_8_narrative) parts.push(`Slide 8 narrative (win-back): "${commentary.slide_8_narrative}"`);
  }

  if (prior && prior.archive_date) {
    parts.push(`\n## Prior Run (${prior.archive_date})`);
    if (prior.n25 && prior.n26) {
      parts.push(`Prior totals: ${prior.n25} → ${prior.n26} (net ${prior.net >= 0 ? '+' : ''}${prior.net})`);
    }
    if (prior.seg) parts.push(`Prior segments: ${JSON.stringify(prior.seg)}`);
  }

  if (notes && notes.trim() && !notes.includes('<!-- Add your observations')) {
    const user_notes = notes.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (user_notes.replace(/[#\-\s]/g, '').length > 10) {
      parts.push('\n## Analyst Notes & Context');
      parts.push(user_notes);
    }
  }

  return parts.join('\n');
}

// ── Ask Claude ────────────────────────────────────────────────────────────

async function ask(question, opts = {}) {
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key || api_key === 'sk-ant-your-key-here') {
    console.error('Error: ANTHROPIC_API_KEY not set. Add it to your .env file.');
    process.exit(1);
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });

  const context = build_context(question);

  const system_prompt = `You are a senior sports-event analyst working with USAT (USA Triathlon) sanctioned event data. 
You have access to the computed analysis results, current commentary, and the analyst's notes below.
Be direct, specific, and use actual numbers from the data. Keep answers concise unless asked to expand.
If asked to rewrite or update commentary, output only the new text — no preamble.
If the data doesn't support a conclusion, say so clearly rather than speculating.`;

  const user_message = `Here is the full context for this analysis:\n\n${context}\n\n---\n\nQuestion: ${question}`;

  console.log('\n⟳ Asking Claude...\n');

  let full_response = '';

  const stream = await client.messages.stream({
    model:      'claude-sonnet-4-6',   // Use Sonnet for richer analysis Q&A
    max_tokens: 1500,
    system:     system_prompt,
    messages:   [{ role: 'user', content: user_message }],
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      process.stdout.write(chunk.delta.text);
      full_response += chunk.delta.text;
    }
  }

  console.log('\n');

  // If --update-notes flag, append Q&A to notes.md with smart pruning
  if (opts.update_notes) {
    const notes_path = path.join(DIR, 'notes.md');
    const MAX_QA_ENTRIES  = 8;    // keep only the 8 most recent Q&A pairs
    const MAX_NOTES_CHARS = 6000; // soft cap on total notes.md size

    let notes_content = '';
    try { notes_content = fs.readFileSync(notes_path, 'utf8'); } catch { /* new file */ }

    // Extract the static header section (everything before the first ---\n### Q:)
    const qa_split = notes_content.indexOf('\n---\n### Q:');
    const static_section = qa_split >= 0 ? notes_content.slice(0, qa_split) : notes_content;

    // Extract existing Q&A entries
    const qa_pattern = /\n---\n### Q: [\s\S]*?(?=\n---\n### Q:|$)/g;
    const existing_qa = [...notes_content.matchAll(qa_pattern)].map(m => m[0]);

    // Add new entry
    const new_entry = `\n---\n### Q: ${question}\n\n${full_response.trim()}\n`;
    const all_qa = [...existing_qa, new_entry];

    // Keep only the N most recent entries
    const trimmed_qa = all_qa.slice(-MAX_QA_ENTRIES);

    // Rebuild notes.md
    let new_content = static_section.trimEnd() + trimmed_qa.join('');

    // If still too large, summarise oldest entries
    if (new_content.length > MAX_NOTES_CHARS) {
      // Drop oldest Q&A pairs until within limit
      while (new_content.length > MAX_NOTES_CHARS && trimmed_qa.length > 2) {
        trimmed_qa.shift();
        new_content = static_section.trimEnd() + trimmed_qa.join('');
      }
    }

    fs.writeFileSync(notes_path, new_content, 'utf8');
    console.log(`✓ Answer saved to notes.md (\${trimmed_qa.length} recent Q&A entries retained)\n`);
  }

  // If --update-commentary flag, update that key in commentary.json
  if (opts.update_key) {
    const cm_path = path.join(DIR, 'output', 'commentary.json');
    const cm = load_json(cm_path);
    if (cm) {
      cm[opts.update_key] = full_response.trim();
      cm.last_manual_update = new Date().toISOString();
      fs.writeFileSync(cm_path, JSON.stringify(cm, null, 2), 'utf8');
      console.log(`✓ commentary.json updated: ${opts.update_key}\n`);
    }
  }

  return full_response;
}

// ── Override management helpers ────────────────────────────────────────────

const OVERRIDES_PATH = path.join(DIR, 'data', 'overrides.json');
const VALID_SEGMENTS = ['Retained','Shifted','Attrited','New','Recovered','Tried to Return'];

function load_overrides_file() {
  const raw = load_json(OVERRIDES_PATH);
  if (!raw) return { force_match: [], force_no_match: [], force_segment: [] };
  // Strip comment-only entries (keys starting with _)
  const clean = arr => (arr ?? []).filter(e => Object.keys(e).some(k => !k.startsWith('_')));
  return {
    force_match:    clean(raw.force_match),
    force_no_match: clean(raw.force_no_match),
    force_segment:  clean(raw.force_segment),
    _readme:        raw._readme,
    _schema:        raw._schema,
  };
}

function save_overrides_file(ov) {
  // Preserve _comment template entries when saving
  const raw = load_json(OVERRIDES_PATH) ?? {};
  const template_entries = type => (raw[type] ?? []).filter(e =>
    Object.keys(e).every(k => k.startsWith('_'))
  );
  const out = {
    _readme:  raw._readme  ?? 'Manual event matching overrides.',
    _schema:  raw._schema  ?? {},
    force_match:    [...template_entries('force_match'),    ...(ov.force_match    ?? [])],
    force_no_match: [...template_entries('force_no_match'), ...(ov.force_no_match ?? [])],
    force_segment:  [...template_entries('force_segment'),  ...(ov.force_segment  ?? [])],
  };
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(out, null, 2), 'utf8');
}

function cmd_list_overrides() {
  const ov = load_overrides_file();
  const results = load_json(path.join(DIR, 'output', 'analysis_results.json'));
  const last_applied = results?.overrides;

  console.log('\n=== Active overrides in data/overrides.json ===\n');

  const total = ov.force_match.length + ov.force_no_match.length + ov.force_segment.length;
  if (!total) {
    console.log('  No active overrides. (All entries are commented out with _ prefixes.)');
    console.log('  Use --add-override commands to add new ones.\n');
  } else {
    if (ov.force_match.length) {
      console.log(`Force matches (${ov.force_match.length}):`);
      ov.force_match.forEach(e => console.log(`  ✓ ${e.sid_25} ↔ ${e.sid_26}${e.note ? '  — ' + e.note : ''}`));
    }
    if (ov.force_no_match.length) {
      console.log(`Force no-match (${ov.force_no_match.length}):`);
      ov.force_no_match.forEach(e => console.log(`  ✗ ${e.sid_25 ?? e.sid_26}${e.note ? '  — ' + e.note : ''}`));
    }
    if (ov.force_segment.length) {
      console.log(`Force segment (${ov.force_segment.length}):`);
      ov.force_segment.forEach(e => console.log(`  → ${e.sid_25 ?? e.sid_26}  =  ${e.segment}${e.note ? '  — ' + e.note : ''}`));
    }
  }

  if (last_applied?.total_applied) {
    console.log(`\nLast build applied: ${last_applied.total_applied} override(s)`);
    last_applied.applied.forEach(a =>
      console.log(`  ${a.type}: ${a.sid_25 ?? ''}${a.sid_26 ? ' / ' + a.sid_26 : ''} → ${a.result}`)
    );
  }
  console.log('\nRun: node build_all.js   to apply changes\n');
}

function cmd_add_match(sid_25, sid_26, note) {
  if (!sid_25 || !sid_26) { console.error('Usage: --add-override match <sid_25> <sid_26> ["note"]'); process.exit(1); }
  const ov = load_overrides_file();
  const exists = ov.force_match.some(e => e.sid_25 === sid_25 && e.sid_26 === sid_26);
  if (exists) { console.log(`  Already exists: force_match ${sid_25} ↔ ${sid_26}`); return; }
  const entry = { sid_25, sid_26 };
  if (note) entry.note = note;
  ov.force_match.push(entry);
  save_overrides_file(ov);
  console.log(`✓ Added force_match: ${sid_25} ↔ ${sid_26}${note ? '  (' + note + ')' : ''}`);
  console.log('  Run: node build_all.js   to apply\n');
}

function cmd_add_no_match(year, sid, note) {
  if (!year || !sid || !['25','26'].includes(String(year))) {
    console.error('Usage: --add-override no-match <25|26> <sanction_id> ["note"]');
    process.exit(1);
  }
  const ov = load_overrides_file();
  const key = String(year) === '25' ? 'sid_25' : 'sid_26';
  const exists = ov.force_no_match.some(e => e[key] === sid);
  if (exists) { console.log(`  Already exists: force_no_match ${sid}`); return; }
  const entry = { [key]: sid };
  if (note) entry.note = note;
  ov.force_no_match.push(entry);
  save_overrides_file(ov);
  const result = String(year) === '25' ? 'Attrited' : 'New';
  console.log(`✓ Added force_no_match: ${sid}  →  ${result}${note ? '  (' + note + ')' : ''}`);
  console.log('  Run: node build_all.js   to apply\n');
}

function cmd_add_segment(year, sid, segment, note) {
  if (!year || !sid || !segment) {
    console.error(`Usage: --add-override segment <25|26> <sanction_id> <segment> ["note"]`);
    console.error(`  Valid segments: ${VALID_SEGMENTS.join(', ')}`);
    process.exit(1);
  }
  // Allow partial segment name matching for convenience
  const matched_seg = VALID_SEGMENTS.find(s =>
    s.toLowerCase() === segment.toLowerCase() ||
    s.toLowerCase().startsWith(segment.toLowerCase())
  );
  if (!matched_seg) {
    console.error(`Invalid segment "${segment}". Valid: ${VALID_SEGMENTS.join(', ')}`);
    process.exit(1);
  }
  const ov = load_overrides_file();
  const key = String(year) === '25' ? 'sid_25' : 'sid_26';
  const exists = ov.force_segment.findIndex(e => e[key] === sid);
  if (exists >= 0) {
    ov.force_segment[exists] = { [key]: sid, segment: matched_seg, ...(note ? { note } : {}) };
    console.log(`✓ Updated force_segment: ${sid}  →  ${matched_seg}`);
  } else {
    const entry = { [key]: sid, segment: matched_seg };
    if (note) entry.note = note;
    ov.force_segment.push(entry);
    console.log(`✓ Added force_segment: ${sid}  →  ${matched_seg}${note ? '  (' + note + ')' : ''}`);
  }
  save_overrides_file(ov);
  console.log('  Run: node build_all.js   to apply\n');
}

function cmd_remove_override(sid) {
  if (!sid) { console.error('Usage: --remove-override <sanction_id>'); process.exit(1); }
  const ov = load_overrides_file();
  let removed = 0;
  ov.force_match    = ov.force_match.filter(e => { const keep = e.sid_25 !== sid && e.sid_26 !== sid; if (!keep) removed++; return keep; });
  ov.force_no_match = ov.force_no_match.filter(e => { const keep = e.sid_25 !== sid && e.sid_26 !== sid; if (!keep) removed++; return keep; });
  ov.force_segment  = ov.force_segment.filter(e => { const keep = e.sid_25 !== sid && e.sid_26 !== sid; if (!keep) removed++; return keep; });
  if (!removed) { console.log(`  No override found for: ${sid}`); return; }
  save_overrides_file(ov);
  console.log(`✓ Removed ${removed} override entry(s) for: ${sid}`);
  console.log('  Run: node build_all.js   to apply\n');
}

async function cmd_suggest_overrides() {
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key || api_key === 'sk-ant-your-key-here') {
    console.error('ANTHROPIC_API_KEY not set. Add it to .env to use AI suggestions.');
    process.exit(1);
  }

  // Load raw event lists — needs the latest build output
  // We'll derive from analysis_results if available, but ideally re-run analysis
  const { loadBothYears: load_both_years } = require('./src/loader');
  const { runAnalysis: run_analysis }       = require('./src/analysis');

  console.log('\nLoading event data for override suggestions...');
  const loaded  = load_both_years(
    path.join(DIR, 'data', '2025a_events_051526.csv'),
    path.join(DIR, 'data', '2026_events_051526.csv')
  );
  const results = run_analysis(loaded);

  const attrited = (results.segments?.attrited ?? []).map(m => ({
    sid:   m.e25.sanctionId,
    name:  m.e25.name,
    type:  m.e25.type,
    month: ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m.e25.month],
  }));

  const new_ev = (results.segments?.new ?? []).map(m => ({
    sid:   m.e26.sanctionId,
    name:  m.e26.name,
    type:  m.e26.type,
    month: ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m.e26.month],
  }));

  const existing_ov = load_overrides_file();
  const already_overridden = new Set([
    ...existing_ov.force_match.flatMap(e => [e.sid_25, e.sid_26]),
    ...existing_ov.force_no_match.map(e => e.sid_25 ?? e.sid_26),
    ...existing_ov.force_segment.map(e => e.sid_25 ?? e.sid_26),
  ].filter(Boolean));

  const attrited_filtered = attrited.filter(e => !already_overridden.has(e.sid));
  const new_filtered      = new_ev.filter(e => !already_overridden.has(e.sid));

  console.log(`\nAnalysing ${attrited_filtered.length} unmatched 2025 events and ${new_filtered.length} unmatched 2026 events...`);
  console.log('Asking Claude to suggest likely missed matches...\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });

  const prompt = `You are reviewing event matching between two years of sanctioned sports events.

The automatic matcher missed some events that may actually be the same event under a different name.

Unmatched 2025 events (Attrited — did not return):
${JSON.stringify(attrited_filtered.slice(0, 80), null, 1)}

Unmatched 2026 events (New — no 2025 match found):
${JSON.stringify(new_filtered.slice(0, 80), null, 1)}

Identify the TOP 10 most likely missed matches — pairs where a 2025 event and 2026 event are almost certainly the same event series despite name differences (sponsor changes, location updates, rebranding, year references removed, abbreviation changes, etc.).

For each suggestion output EXACTLY this JSON format (no other text):
[
  {
    "sid_25": "...",
    "name_25": "...",
    "sid_26": "...",
    "name_26": "...",
    "confidence": "High|Medium",
    "reason": "brief explanation of why these match"
  }
]`;

  let raw = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6', max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      raw += chunk.delta.text;
    }
  }

  let suggestions = [];
  try {
    const json_match = raw.match(/\[[\s\S]*\]/);
    if (json_match) suggestions = JSON.parse(json_match[0]);
  } catch { /* fall through */ }

  if (!suggestions.length) {
    console.log('Could not parse suggestions from Claude. Raw response:');
    console.log(raw);
    return;
  }

  console.log(`\n=== Claude's suggested overrides (${suggestions.length}) ===\n`);
  suggestions.forEach((s, i) => {
    console.log(`${i + 1}. [${s.confidence}] ${s.name_25}  ↔  ${s.name_26}`);
    console.log(`   Reason: ${s.reason}`);
    console.log(`   Add: node ask.js --add-override match ${s.sid_25} ${s.sid_26} "${s.reason}"\n`);
  });

  // Offer to add all High confidence ones
  const high = suggestions.filter(s => s.confidence === 'High');
  if (high.length) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Add all ${high.length} High-confidence suggestions to overrides.json? (y/n): `, ans => {
      rl.close();
      if (ans.trim().toLowerCase() === 'y') {
        high.forEach(s => cmd_add_match(s.sid_25, s.sid_26, s.reason));
        console.log(`\n✓ Added ${high.length} override(s). Run: node build_all.js   to apply`);
      }
    });
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // ── Override management commands ──────────────────────────────────────
  if (args[0] === '--what-changed') {
    const current_cm  = load_json(path.join(DIR, 'output', 'commentary.json'));
    const current_res = load_json(path.join(DIR, 'output', 'analysis_results.json'));
    if (!current_cm) { console.error('Run node build_all.js first.'); process.exit(1); }

    // Find most recent archive
    const archive_dir = path.join(DIR, 'output', 'archive');
    const prior_runs  = fs.existsSync(archive_dir) ? fs.readdirSync(archive_dir).sort().reverse() : [];
    const prior_cm_path = prior_runs.length ? path.join(archive_dir, prior_runs[0], 'commentary.json') : null;
    const prior_cm = prior_cm_path && fs.existsSync(prior_cm_path) ? load_json(prior_cm_path) : null;

    if (!prior_cm) {
      console.log('\nNo prior build found in archive. Run node build_all.js twice to compare.\n');
      return;
    }

    // Quick diff summary (non-AI)
    const metric_keys = { n25: 'Prior-yr events', n26: 'Current-yr events', net: 'Net change',
      attrited: 'Attrited', new_ev: 'New events', rec: 'Recovered', repl_rate: 'Replacement %' };
    const changed_metrics = Object.entries(metric_keys)
      .filter(([k]) => prior_cm[k] !== undefined && current_cm[k] !== undefined && prior_cm[k] !== current_cm[k])
      .map(([k, label]) => `  ${label.padEnd(22)} ${String(prior_cm[k]).padStart(6)} → ${String(current_cm[k]).padStart(6)}`);

    const narr_keys = ['slide_2_narrative','slide_3_narrative','slide_4_narrative','slide_5_narrative',
                        'slide_6_narrative','slide_7_narrative','slide_8_narrative'];
    const changed_narrs = narr_keys.filter(k => prior_cm[k] !== current_cm[k] && current_cm[k]);

    console.log(`\n=== What changed since ${prior_runs[0]} ===\n`);
    console.log(`Prior mode: ${prior_cm.mode ?? '?'}  →  Current mode: ${current_cm.mode ?? '?'}`);

    if (changed_metrics.length) {
      console.log(`\nMetric changes (${changed_metrics.length}):`);
      changed_metrics.forEach(l => console.log(l));
    } else {
      console.log('\nMetrics: no changes');
    }

    if (changed_narrs.length) {
      console.log(`\nNarrative changes (${changed_narrs.length}): ${changed_narrs.join(', ')}`);
    } else {
      console.log('Narratives: no changes');
    }

    // Use AI to summarise the diff if key is present
    const api_key = process.env.ANTHROPIC_API_KEY;
    if (api_key && api_key !== 'sk-ant-your-key-here' && (changed_metrics.length || changed_narrs.length)) {
      console.log('\nAsking Claude to summarise what shifted...');
      const diff_ctx = [
        changed_metrics.length ? 'Metric changes:\n' + changed_metrics.join('\n') : '',
        changed_narrs.map(k => `${k}:\n  WAS: ${(prior_cm[k] ?? '').slice(0,120)}\n  NOW: ${(current_cm[k] ?? '').slice(0,120)}`).join('\n\n'),
      ].filter(Boolean).join('\n\n');

      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.Anthropic({ apiKey: api_key });
      const stream = await client.messages.stream({
        model: 'claude-haiku-4-5-20251001', max_tokens: 400,
        messages: [{ role: 'user', content: `Summarise what changed between two analysis builds in 3–4 bullet points. Be specific and concise.\n\n${diff_ctx}` }],
      });
      console.log('');
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          process.stdout.write(chunk.delta.text);
        }
      }
      console.log('\n');
    } else {
      if (changes_txt_path = path.join(DIR, 'output', 'changes.txt'), fs.existsSync(changes_txt_path)) {
        console.log('\nFull diff: output/changes.txt');
      }
    }
    return;
  }

  if (args[0] === '--list-overrides') {
    cmd_list_overrides(); return;
  }

  if (args[0] === '--remove-override') {
    cmd_remove_override(args[1]); return;
  }

  if (args[0] === '--suggest-overrides') {
    await cmd_suggest_overrides(); return;
  }

  if (args[0] === '--add-override') {
    const sub = args[1];
    if (sub === 'match') {
      // --add-override match <sid_25> <sid_26> ["note"]
      const note = args[4] || '';
      cmd_add_match(args[2], args[3], note); return;
    }
    if (sub === 'no-match') {
      // --add-override no-match <25|26> <sid> ["note"]
      const note = args[4] || '';
      cmd_add_no_match(args[2], args[3], note); return;
    }
    if (sub === 'segment') {
      // --add-override segment <25|26> <sid> <segment> ["note"]
      const note = args[5] || '';
      cmd_add_segment(args[2], args[3], args[4], note); return;
    }
    console.error('Unknown override type. Use: match | no-match | segment');
    process.exit(1);
  }

  // ── Legacy flag ───────────────────────────────────────────────────────
  if (args[0] === '--list-unmatched') {
    const results = load_json(path.join(DIR, 'output', 'analysis_results.json'));
    if (!results) { console.error('Run node build_all.js first.'); process.exit(1); }
    console.log('\nUse --suggest-overrides for AI-powered match suggestions.');
    console.log('Use --list-overrides to see active overrides.\n');
    if (results.overrides?.total_applied) {
      console.log(`Active overrides: ${results.overrides.total_applied}`);
      results.overrides.applied.forEach(o =>
        console.log(`  ${o.type}: ${o.sid_25 ?? ''}${o.sid_26 ? ' / '+o.sid_26 : ''} → ${o.result}`)
      );
    }
    return;
  }

  if (!args.length || args[0] === '--help') {
    console.log(`
USAT Analysis — Interactive Q&A & Override Management
======================================================
Usage: node ask.js "<question>" [options]
       node ask.js --<command> [args]

── Q&A options ──────────────────────────────────────
  --save-notes                      Save answer to notes.md (auto-pruned)
  --update-commentary <key>         Rewrite a key in output/commentary.json

── Override commands ─────────────────────────────────
  --list-overrides                  Show all active overrides
  --what-changed                    Compare current build to prior (AI summary if key set)
  --add-override match <s25> <s26> ["note"]
                                    Force two events to match
  --add-override no-match <25|26> <sid> ["note"]
                                    Prevent an event from matching (→ Attrited or New)
  --add-override segment <25|26> <sid> <segment> ["note"]
                                    Override segment (Retained|Shifted|Attrited|New|...)
  --remove-override <sid>           Remove all overrides for a sanction ID
  --suggest-overrides               Ask Claude to suggest likely missed matches (AI)

After any --add-override or --remove-override, run: node build_all.js

── Examples ──────────────────────────────────────────
  node ask.js "Why did Adult Clinic decline so much?"
  node ask.js "Draft a Slack post on key findings" --save-notes
  node ask.js "Rewrite slide 8 narrative more urgently" --update-commentary slide_8_narrative

  node ask.js --list-overrides
  node ask.js --suggest-overrides
  node ask.js --add-override match 311655-Adult\\ Race 354307-Adult\\ Race "Same series, name changed"
  node ask.js --add-override no-match 25 311157-Adult\\ Race "Confirmed permanently cancelled"
  node ask.js --add-override segment 25 310379-Adult\\ Race Attrited "Algorithm matched incorrectly"
  node ask.js --remove-override 311157-Adult\\ Race

Context loaded automatically:
  output/analysis_results.json  output/commentary.json  notes.md  output/archive/

Model: claude-sonnet-4-6 (streaming for Q&A)
`);
    return;
  }

  // ── Parse Q&A options ─────────────────────────────────────────────────
  const opts = {};
  const question_parts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save-notes') {
      opts.update_notes = true;
    } else if (args[i] === '--update-commentary' && args[i+1]) {
      opts.update_key = args[++i];
    } else {
      question_parts.push(args[i]);
    }
  }

  const question = question_parts.join(' ');
  if (!question.trim()) {
    console.error('Error: Please provide a question or a -- command. Run --help for usage.');
    process.exit(1);
  }

  await ask(question, opts);
}

main().catch(err => {
  console.error('Error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

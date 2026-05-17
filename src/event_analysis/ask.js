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
const { determineOSPath } = require('../../utilities/determineOSPath');

const DIR = __dirname;

// OUTPUT_DIR resolution — same pattern as build_all.js / menu.js. Cached
// after first call so repeated context loads don't re-await.
let OUTPUT_DIR = null;
async function resolve_output_dir() {
  if (OUTPUT_DIR) return OUTPUT_DIR;
  if (process.env.EVENT_ANALYSIS_OUTPUT_DIR) {
    OUTPUT_DIR = process.env.EVENT_ANALYSIS_OUTPUT_DIR;
  } else {
    const os_path = await determineOSPath();
    OUTPUT_DIR = path.join(os_path, 'usat_event_analysis_output');
  }
  return OUTPUT_DIR;
}

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
  const archive_dir = path.join(OUTPUT_DIR, 'archive');
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
  const results   = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
  const state     = load_json(path.join(OUTPUT_DIR, 'analysis_state.json'));
  const commentary = load_json(path.join(OUTPUT_DIR, 'commentary.json'));
  const notes      = load_text(path.join(DIR, 'notes.md'));
  const prior      = load_prior_run();

  // Consistency check: state and results must agree on top-line totals.
  if (results && state) {
    const r_a = results.totals?.BASELINE_YEAR, r_b = results.totals?.ANALYSIS_YEAR;
    const s_a = state.build_meta?.totals?.BASELINE_YEAR, s_b = state.build_meta?.totals?.ANALYSIS_YEAR;
    if ((r_a !== s_a || r_b !== s_b)) {
      console.warn(`  ⚠  analysis_results.json (${r_a}/${r_b}) and analysis_state.json (${s_a}/${s_b}) disagree on totals. Rebuild recommended.`);
    }
  }

  const parts = [];

  if (results) {
    parts.push(`## Current Analysis Results (${results.generated_at?.slice(0,10) ?? 'latest'})`);
    if (results.overrides?.total_applied) {
      parts.push(`\nManual overrides active: ${results.overrides.total_applied} override(s) applied`);
      results.overrides.applied.forEach(o => {
        parts.push(`  - ${o.type}: ${o.sid_baseline ?? ''}${o.sid_analysis ? ' / ' + o.sid_analysis : ''} → ${o.result}${o.note ? ' (' + o.note + ')' : ''}`);
      });
    }
    parts.push(`Years: ${results.years?.BASELINE_YEAR} vs ${results.years?.ANALYSIS_YEAR}`);
    parts.push(`Total events: ${results.totals?.BASELINE_YEAR} → ${results.totals?.ANALYSIS_YEAR} (net ${results.totals?.net >= 0 ? '+' : ''}${results.totals?.net})`);
    parts.push(`\nSegments: ${JSON.stringify(results.segments ?? {})}`);
    if (results.by_type) {
      parts.push('\nBy type (raw counts):');
      Object.entries(results.by_type).forEach(([t, v]) => {
        // Field names from analysis_results.json export: tot25 / tot26 / actDelta.
        // Fall back to n_baseline/n_analysis/delta for backwards-compat with older exports.
        const a = v.tot25 ?? v.n_baseline;
        const b = v.tot26 ?? v.n_analysis;
        const d = v.actDelta ?? v.delta;
        if (a !== undefined && b !== undefined) {
          const pct = a ? ((b - a) / a * 100).toFixed(1) : '0.0';
          parts.push(`  ${t}: ${a} → ${b} (delta ${d >= 0 ? '+' : ''}${d}, ${pct >= 0 ? '+' : ''}${pct}%)`);
        }
      });
      // Compute aggregate "Adult" and "Youth" totals as a convenience for questions.
      const adult_25 = (results.by_type['Adult Race']?.tot25 ?? 0) + (results.by_type['Adult Clinic']?.tot25 ?? 0);
      const adult_26 = (results.by_type['Adult Race']?.tot26 ?? 0) + (results.by_type['Adult Clinic']?.tot26 ?? 0);
      const youth_25 = (results.by_type['Youth Race']?.tot25 ?? 0) + (results.by_type['Youth Clinic']?.tot25 ?? 0);
      const youth_26 = (results.by_type['Youth Race']?.tot26 ?? 0) + (results.by_type['Youth Clinic']?.tot26 ?? 0);
      parts.push(`  Adult total (Race + Clinic): ${adult_25} → ${adult_26} (delta ${adult_26 - adult_25 >= 0 ? '+' : ''}${adult_26 - adult_25})`);
      parts.push(`  Youth total (Race + Clinic): ${youth_25} → ${youth_26} (delta ${youth_26 - youth_25 >= 0 ? '+' : ''}${youth_26 - youth_25})`);
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

  // Question-aware detail slices from analysis_state.json. Only include
  // tables that look relevant to keep the prompt within budget.
  if (state) {
    const q = (question || '').toLowerCase();
    const wants_months    = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|month|monthly)\b/.test(q);
    const wants_segments  = /\b(retained|shifted|lost|attrited|new|recovered|tried to return|attrition|segment)\b/.test(q);
    const wants_shift     = /\b(shift|moved|relocate|migration)\b/.test(q);
    const wants_pipeline  = /\b(application|applied|filed|pipeline|q4|in-year|prior-year)\b/.test(q);
    const wants_organic   = /\b(organic|calendar|weekend|sat|sun)\b/.test(q);
    const wants_eventnames = /\b(name|event named|race named|sanction|specifically|which event|list|show me)\b/.test(q);
    const ya = state.build_meta?.years?.BASELINE_YEAR, yb = state.build_meta?.years?.ANALYSIS_YEAR;

    parts.push('\n## Detail tables (snapshot from build, single source of truth)');
    parts.push(`Build timestamp: ${state.build_meta?.build_ts ?? 'unknown'}`);

    // Always include per-month per-type counts — small, broadly useful.
    const fmt_mtype = (cx) => {
      if (!cx) return '(none)';
      const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
      const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const rows = [];
      rows.push('  Month  ' + TYPES.map(t => t.padEnd(13)).join(' '));
      for (let m = 1; m <= 12; m++) {
        const r = cx[m] ?? {};
        rows.push(`  ${MN[m].padEnd(7)}` + TYPES.map(t => String(r[t] ?? 0).padEnd(13)).join(' '));
      }
      return rows.join('\n');
    };
    parts.push(`\nPer-month per-type counts (${ya}, "active" only):\n${fmt_mtype(state.counts_by_month_type?.BASELINE_YEAR)}`);
    parts.push(`\nPer-month per-type counts (${yb}, "active" only):\n${fmt_mtype(state.counts_by_month_type?.ANALYSIS_YEAR)}`);

    // Segment-by-month-type tables when the question is about disposition.
    if (wants_segments || wants_months) {
      const sbmt = state.segments_by_month_type ?? {};
      const seg_keys = [
        ['retained_by_year_a_month',  'Retained'],
        ['attrited_by_year_a_month',  'Lost'],
        ['new_by_year_b_month',       'New'],
        ['recovered_by_year_b_month', 'Recovered'],
        ['shifted_by_year_a_month',   'Shifted-out (from ' + ya + ' month)'],
        ['shifted_by_year_b_month',   'Shifted-in (to ' + yb + ' month)'],
        ['tried_to_return_by_year_a_month', 'Tried to Return'],
      ];
      for (const [k, label] of seg_keys) {
        if (sbmt[k]) parts.push(`\n${label} per-month per-type:\n${fmt_mtype(sbmt[k])}`);
      }
    }

    // Shift flow matrix.
    if (wants_shift) {
      const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sf = state.shift_flow ?? {};
      const lines = [`\nShift flow matrix (rows = ${ya} origin month, cols = ${yb} destination month):`];
      lines.push('  From\\To  ' + Array.from({length: 12}, (_, i) => MN[i+1].padStart(4)).join(' '));
      for (let fm = 1; fm <= 12; fm++) {
        const row = sf[fm] ?? {};
        lines.push(`  ${MN[fm].padEnd(8)}` + Array.from({length: 12}, (_, i) => String(row[i+1] ?? 0).padStart(4)).join(' '));
      }
      parts.push(lines.join('\n'));
    }

    // Creation pipeline totals (per type) — if pipeline question.
    if (wants_pipeline) {
      const cp = state.creation_pipeline ?? {};
      const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
      const sum_by = (rows, yr, type, mos) => (rows ?? [])
        .filter(r => r.yr === yr && r.type === type && (mos === null || mos.includes(r.mo)))
        .reduce((s, r) => s + (r.cnt ?? 0), 0);
      const PRE_YA = ya - 1;
      const lines = [`\nApplication pipeline (Q4 prior + Jan-current_mo in-yr):`];
      lines.push(`  Type           Q4-${PRE_YA}  Jan-cur ${ya}  Total ${ya}    Q4-${ya}  Jan-cur ${yb}  Total ${yb}`);
      for (const t of TYPES) {
        const q4_a = sum_by(cp.BASELINE_YEAR, PRE_YA, t, [10, 11, 12]);
        const iy_a = sum_by(cp.BASELINE_YEAR, ya,     t, null);  // any month in YA
        const tot_a = (cp.BASELINE_YEAR ?? []).filter(r => r.type === t).reduce((s, r) => s + (r.cnt ?? 0), 0);
        const q4_b = sum_by(cp.ANALYSIS_YEAR, ya,     t, [10, 11, 12]);
        const iy_b = sum_by(cp.ANALYSIS_YEAR, yb,     t, null);
        const tot_b = (cp.ANALYSIS_YEAR ?? []).filter(r => r.type === t).reduce((s, r) => s + (r.cnt ?? 0), 0);
        lines.push(`  ${t.padEnd(14)} ${String(q4_a).padStart(5)} ${String(iy_a).padStart(13)} ${String(tot_a).padStart(11)}    ${String(q4_b).padStart(5)} ${String(iy_b).padStart(13)} ${String(tot_b).padStart(11)}`);
      }
      parts.push(lines.join('\n'));
    }

    // Calendar impact if organic question.
    if (wants_organic) {
      const ci = state.calendar_impact ?? [];
      const MN = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const lines = [`\nCalendar impact by month:`];
      lines.push('  Month  ΔWknd  CalExp   Actual  Organic');
      for (const c of ci) {
        if (!c.month) continue;
        const dw = c.dw ?? 0, cal = (c.calTotal ?? 0).toFixed(1), act = c.actDelta ?? 0, org = (c.orgTotal ?? 0).toFixed(1);
        lines.push(`  ${MN[c.month].padEnd(5)}  ${String(dw).padStart(5)}  ${String(cal).padStart(6)}  ${String(act).padStart(6)}  ${String(org).padStart(7)}`);
      }
      parts.push(lines.join('\n'));
    }

    // Event-level lists (sanction IDs, names) — only when question explicitly
    // asks about specific events. Filter by month/type if possible to stay
    // within token budget.
    if (wants_eventnames) {
      const seg = state.segments ?? {};
      const MN_NUM = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12,
                       january:1, february:2, march:3, april:4, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
      const target_month = Object.entries(MN_NUM).find(([k]) => q.includes(k))?.[1] ?? null;
      const filter_match = (m) => {
        const ev = m.e25 ?? m.e26;
        if (!ev) return false;
        if (target_month && ev.month !== target_month) return false;
        return true;
      };
      const list_segment = (key, label, side) => {
        const arr = (seg[key] ?? []).filter(filter_match).slice(0, 30);
        if (!arr.length) return;
        parts.push(`\n${label} events${target_month ? ' (filtered to month ' + target_month + ')' : ''} — showing up to 30:`);
        arr.forEach(m => {
          const ev = m[side] ?? m.e25 ?? m.e26;
          if (!ev) return;
          parts.push(`  - ${ev.sanction_id} | ${ev.name} | ${ev.type} | month ${ev.month} | ${ev.status}`);
        });
      };
      if (q.includes('retained'))                 list_segment('retained',        'Retained',        'e25');
      if (q.includes('lost') || q.includes('attrited')) list_segment('attrited', 'Lost (attrited)', 'e25');
      if (q.includes('new'))                      list_segment('new',             'New',             'e26');
      if (q.includes('shifted') || q.includes('shift')) list_segment('shifted',   'Shifted',         'e25');
      if (q.includes('recovered'))                list_segment('recovered',       'Recovered',       'e26');
      if (q.includes('tried to return') || q.includes('ttr')) list_segment('tried_to_return', 'Tried to Return', 'e25');
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
    if (prior.n_baseline && prior.n_analysis) {
      parts.push(`Prior totals: ${prior.n_baseline} → ${prior.n_analysis} (net ${prior.net >= 0 ? '+' : ''}${prior.net})`);
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
  await resolve_output_dir();
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key || api_key === 'sk-ant-your-key-here') {
    console.error('Error: ANTHROPIC_API_KEY not set. Add it to your .env file.');
    process.exit(1);
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });

  const context = build_context(question);

  const system_prompt = `You are a senior sports-event analyst working with USAT (USA Triathlon) sanctioned event data.
You have access to the computed analysis results, full state snapshot (every event, every segment match, every per-month-per-type count), current commentary, and the analyst's notes below.

Behavior rules:
1. Be direct, specific, and use actual numbers from the data. Keep answers concise unless asked to expand.
2. Prefix EVERY answer with one short line: "Based on the build from <YYYY-MM-DD HH:MM>:" using the Build timestamp from the Detail tables section. This makes it clear which snapshot is being cited.
3. Use ONLY numbers that appear in the context. Do not invent or extrapolate.
4. If the question requires data not in the context (e.g. organizer emails, registration counts), say "That field isn't in the build snapshot" — do not guess.
5. If asked to rewrite or update commentary, output only the new text — no preamble (and skip the build-timestamp line for those rewrites).
6. If the data does not support a conclusion, say so clearly rather than speculating.`;

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
    const cm_path = path.join(OUTPUT_DIR, 'commentary.json');
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

// ── Override management helpers (DB-backed, Step 4) ───────────────────────

const mysqlP = require('mysql2/promise');
const { local_usat_sales_db_config } = require('../../utilities/config');
const { load_overrides, compute_event_signature } = require('./src/overrides');

const VALID_SEGMENTS = ['Retained','Shifted','Lost','New','Recovered','Tried to Return'];
const OV_TABLE = 'event_analysis_overrides';

/**
 * The CLI scopes new overrides to the active comparison (env vars or current year)
 * by default. Pass --global on any add command to leave both year columns NULL.
 */
function current_year_scope() {
  const analysis_year = Number(process.env.ANALYSIS_YEAR) || new Date().getFullYear();
  const baseline_year = Number(process.env.BASELINE_YEAR) || (analysis_year - 1);
  return { baseline_year, analysis_year };
}

/**
 * Translate the year argument into the matching DB column name.
 * Accepts legacy "25"/"26" plus the newer "baseline"/"analysis" (or "b"/"a") aliases.
 */
function year_arg_to_column(arg) {
  const a = String(arg ?? '').toLowerCase();
  if (a === '25' || a === 'baseline' || a === 'b') return 'sid_baseline';
  if (a === '26' || a === 'analysis' || a === 'a') return 'sid_analysis';
  return null;
}

/** Run a function with a live DB connection, closing it on the way out. */
async function with_db(fn) {
  const cfg  = await local_usat_sales_db_config();
  const conn = await mysqlP.createConnection(cfg);
  try { return await fn(conn); } finally { await conn.end(); }
}

async function cmd_list_overrides() {
  const { baseline_year, analysis_year } = current_year_scope();
  const rows = await with_db(async conn => {
    const [r] = await conn.query(
      `SELECT id, override_type, sid_baseline, sid_analysis, segment, note,
              baseline_year, analysis_year, approved, approval_state, created_at
         FROM \`${OV_TABLE}\`
        WHERE active = 1
          AND (
                (baseline_year IS NULL AND analysis_year IS NULL)
             OR (baseline_year = ? AND analysis_year = ?)
          )
        ORDER BY override_type, id`,
      [baseline_year, analysis_year]
    );
    return r;
  });

  console.log(`\n=== Active overrides in DB (scope: ${baseline_year} vs ${analysis_year} + globals) ===\n`);

  if (!rows.length) {
    console.log('  No active overrides for this year pair.');
    console.log('  Use --add-override commands to add new ones.\n');
    return;
  }

  const fm  = rows.filter(r => r.override_type === 'force_match');
  const fnm = rows.filter(r => r.override_type === 'force_no_match');
  const fs2 = rows.filter(r => r.override_type === 'force_segment');

  const scope_label = r => (r.baseline_year === null && r.analysis_year === null)
    ? '[global]'
    : `[${r.baseline_year}/${r.analysis_year}]`;
  // Three states the list-output needs to distinguish:
  //   unapproved      — never approved (or unapproved later)
  //   ✓ approved     — approved and the underlying events haven't drifted
  //   ⚠ stale         — approved, but the build detected event drift
  // approval_state = 'stale' is set by build_all.js via mark_overrides_stale().
  const approval_label = r => {
    if (r.approval_state === 'stale') return '⚠ stale';
    if (r.approved) return '✓ approved';
    return '◦ unapproved';
  };

  if (fm.length) {
    console.log(`Force matches (${fm.length}):`);
    fm.forEach(r => console.log(`  #${r.id} ${scope_label(r)} ${approval_label(r)}  ${r.sid_baseline} ↔ ${r.sid_analysis}${r.note ? '  — ' + r.note : ''}`));
  }
  if (fnm.length) {
    console.log(`Force no-match (${fnm.length}):`);
    fnm.forEach(r => console.log(`  #${r.id} ${scope_label(r)} ${approval_label(r)}  ${r.sid_baseline ?? r.sid_analysis}${r.note ? '  — ' + r.note : ''}`));
  }
  if (fs2.length) {
    console.log(`Force segment (${fs2.length}):`);
    fs2.forEach(r => console.log(`  #${r.id} ${scope_label(r)} ${approval_label(r)}  ${r.sid_baseline ?? r.sid_analysis}  =  ${r.segment}${r.note ? '  — ' + r.note : ''}`));
  }

  // Surface the most recent build's applied summary if available
  const results = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
  const last_applied = results?.overrides;
  if (last_applied?.total_applied) {
    console.log(`\nLast build applied: ${last_applied.total_applied} override(s)`);
    last_applied.applied.forEach(a =>
      console.log(`  ${a.type}: ${a.sid_baseline ?? ''}${a.sid_analysis ? ' / ' + a.sid_analysis : ''} → ${a.result}`)
    );
  }
  console.log('\nRun: node build_all.js   to re-apply\n');
}

async function cmd_add_match(sid_baseline, sid_analysis, note, { global = false, created_by = 'cli' } = {}) {
  if (!sid_baseline || !sid_analysis) {
    console.error('Usage: --add-override match <sid_baseline> <sid_analysis> ["note"] [--global]');
    process.exit(1);
  }
  const { baseline_year, analysis_year } = current_year_scope();
  const by = global ? null : baseline_year;
  const ay = global ? null : analysis_year;

  const result = await with_db(async conn => {
    // Duplicate guard — same active force_match for the same year scope.
    const [existing] = await conn.query(
      `SELECT id FROM \`${OV_TABLE}\`
        WHERE override_type = 'force_match'
          AND sid_baseline = ? AND sid_analysis = ?
          AND ${by === null ? 'baseline_year IS NULL' : 'baseline_year = ?'}
          AND ${ay === null ? 'analysis_year IS NULL' : 'analysis_year = ?'}
          AND active = 1
        LIMIT 1`,
      by === null && ay === null ? [sid_baseline, sid_analysis]
        : by === null ? [sid_baseline, sid_analysis, ay]
        : ay === null ? [sid_baseline, sid_analysis, by]
        : [sid_baseline, sid_analysis, by, ay]
    );
    if (existing.length) return { status: 'exists', id: existing[0].id };

    const [r] = await conn.query(
      `INSERT INTO \`${OV_TABLE}\`
        (override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, note, created_by, active)
        VALUES ('force_match', ?, ?, ?, ?, ?, ?, 1)`,
      [sid_baseline, sid_analysis, by, ay, note ?? null, created_by]
    );
    return { status: 'inserted', id: r.insertId };
  });

  const scope = (by === null) ? 'global' : `${by}/${ay}`;
  if (result.status === 'exists') {
    console.log(`  Already exists (id ${result.id}): force_match ${sid_baseline} ↔ ${sid_analysis} [${scope}]`);
  } else {
    console.log(`✓ Added force_match #${result.id} [${scope}]: ${sid_baseline} ↔ ${sid_analysis}${note ? '  (' + note + ')' : ''}`);
    console.log('  Run: node build_all.js   to apply\n');
  }
  return result;
}

async function cmd_add_no_match(year_arg, sid, note, { global = false, created_by = 'cli' } = {}) {
  const col = year_arg_to_column(year_arg);
  if (!col || !sid) {
    console.error('Usage: --add-override no-match <baseline|analysis|25|26> <sanction_id> ["note"] [--global]');
    process.exit(1);
  }
  const { baseline_year, analysis_year } = current_year_scope();
  const by = global ? null : baseline_year;
  const ay = global ? null : analysis_year;
  const sid_baseline = col === 'sid_baseline' ? sid : null;
  const sid_analysis = col === 'sid_analysis' ? sid : null;

  const result = await with_db(async conn => {
    const [existing] = await conn.query(
      `SELECT id FROM \`${OV_TABLE}\`
        WHERE override_type = 'force_no_match'
          AND ${col} = ?
          AND ${by === null ? 'baseline_year IS NULL' : 'baseline_year = ?'}
          AND ${ay === null ? 'analysis_year IS NULL' : 'analysis_year = ?'}
          AND active = 1
        LIMIT 1`,
      by === null && ay === null ? [sid]
        : by === null ? [sid, ay]
        : ay === null ? [sid, by]
        : [sid, by, ay]
    );
    if (existing.length) return { status: 'exists', id: existing[0].id };

    const [r] = await conn.query(
      `INSERT INTO \`${OV_TABLE}\`
        (override_type, sid_baseline, sid_analysis, baseline_year, analysis_year, note, created_by, active)
        VALUES ('force_no_match', ?, ?, ?, ?, ?, ?, 1)`,
      [sid_baseline, sid_analysis, by, ay, note ?? null, created_by]
    );
    return { status: 'inserted', id: r.insertId };
  });

  const result_label = col === 'sid_baseline' ? 'Lost' : 'New';
  const scope = (by === null) ? 'global' : `${by}/${ay}`;
  if (result.status === 'exists') {
    console.log(`  Already exists (id ${result.id}): force_no_match ${sid} [${scope}]`);
  } else {
    console.log(`✓ Added force_no_match #${result.id} [${scope}]: ${sid}  →  ${result_label}${note ? '  (' + note + ')' : ''}`);
    console.log('  Run: node build_all.js   to apply\n');
  }
  return result;
}

async function cmd_add_segment(year_arg, sid, segment, note, { global = false, created_by = 'cli' } = {}) {
  const col = year_arg_to_column(year_arg);
  if (!col || !sid || !segment) {
    console.error(`Usage: --add-override segment <baseline|analysis|25|26> <sanction_id> <segment> ["note"] [--global]`);
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

  const { baseline_year, analysis_year } = current_year_scope();
  const by = global ? null : baseline_year;
  const ay = global ? null : analysis_year;
  const sid_baseline = col === 'sid_baseline' ? sid : null;
  const sid_analysis = col === 'sid_analysis' ? sid : null;

  // For force_segment we UPDATE the existing row if one is present for the
  // same sid + scope, otherwise INSERT. (Matches the JSON behaviour.)
  const result = await with_db(async conn => {
    const [existing] = await conn.query(
      `SELECT id FROM \`${OV_TABLE}\`
        WHERE override_type = 'force_segment'
          AND ${col} = ?
          AND ${by === null ? 'baseline_year IS NULL' : 'baseline_year = ?'}
          AND ${ay === null ? 'analysis_year IS NULL' : 'analysis_year = ?'}
          AND active = 1
        LIMIT 1`,
      by === null && ay === null ? [sid]
        : by === null ? [sid, ay]
        : ay === null ? [sid, by]
        : [sid, by, ay]
    );
    if (existing.length) {
      await conn.query(
        `UPDATE \`${OV_TABLE}\` SET segment = ?, note = ?, approved = 0, approval_state = NULL
          WHERE id = ?`,
        [matched_seg, note ?? null, existing[0].id]
      );
      return { status: 'updated', id: existing[0].id };
    }
    const [r] = await conn.query(
      `INSERT INTO \`${OV_TABLE}\`
        (override_type, sid_baseline, sid_analysis, segment, baseline_year, analysis_year, note, created_by, active)
        VALUES ('force_segment', ?, ?, ?, ?, ?, ?, ?, 1)`,
      [sid_baseline, sid_analysis, matched_seg, by, ay, note ?? null, created_by]
    );
    return { status: 'inserted', id: r.insertId };
  });

  const scope = (by === null) ? 'global' : `${by}/${ay}`;
  const verb = result.status === 'updated' ? 'Updated' : 'Added';
  console.log(`✓ ${verb} force_segment #${result.id} [${scope}]: ${sid}  →  ${matched_seg}${note ? '  (' + note + ')' : ''}`);
  console.log('  Run: node build_all.js   to apply\n');
  return result;
}

async function cmd_remove_override(sid) {
  if (!sid) { console.error('Usage: --remove-override <sanction_id>'); process.exit(1); }

  const { baseline_year, analysis_year } = current_year_scope();
  const removed = await with_db(async conn => {
    // Soft-delete: set active=0 on every matching active row in the current
    // year scope (and globals). Preserves the audit trail in the table.
    const [r] = await conn.query(
      `UPDATE \`${OV_TABLE}\`
          SET active = 0
        WHERE active = 1
          AND (sid_baseline = ? OR sid_analysis = ?)
          AND (
                (baseline_year IS NULL AND analysis_year IS NULL)
             OR (baseline_year = ? AND analysis_year = ?)
          )`,
      [sid, sid, baseline_year, analysis_year]
    );
    return r.affectedRows;
  });

  if (!removed) {
    console.log(`  No active override found for: ${sid} (scope: ${baseline_year} vs ${analysis_year} + globals)`);
    return { removed: 0 };
  }
  console.log(`✓ Soft-deleted ${removed} override row(s) for: ${sid}  (set active=0)`);
  console.log('  Run: node build_all.js   to apply\n');
  return { removed };
}

// ── Approval commands (Step 5) ─────────────────────────────────────────────
//
// Approval has three intertwined effects on a row:
//   1. flips `approved = 1` so the build no longer warns about it
//   2. records `approval_state = 'approved'`, `approved_by`, `approved_at`
//   3. captures `event_signature_{baseline,analysis}` — a snapshot of the
//      current event state. The next build compares fresh signatures against
//      these; a mismatch flips approval_state to 'stale' (Step 6).
//
// `cmd_approve` therefore needs to look up the current events to capture the
// signatures. It uses the same DB-backed loader build_all.js uses.

async function _fetch_signatures_for_override(row, events_baseline, events_analysis) {
  // Map sids → fresh event signature. Either side may be null/missing if the
  // override only targets one side (force_no_match) or the event has been
  // removed entirely since approval was granted (signature stays NULL → no
  // false-positive "stale" on a vanished event; the matcher already flags it
  // as a separate warning).
  const find = (rows, sid) => sid ? rows.find(e => e.sanctionId === sid || e.sanction_id === sid) : null;
  const e_b = find(events_baseline ?? [], row.sid_baseline);
  const e_a = find(events_analysis ?? [], row.sid_analysis);
  return {
    sig_baseline: e_b ? compute_event_signature(e_b) : null,
    sig_analysis: e_a ? compute_event_signature(e_a) : null,
  };
}

async function cmd_approve(sid, { approved_by = 'cli' } = {}) {
  if (!sid) { console.error('Usage: --approve <sanction_id>'); process.exit(1); }

  // Look up the current events so we can capture signatures at approval time.
  // Loaded lazily because this is the only command path that needs them.
  const { fetch_events_for_years } = require('./src/db');
  const { loadBothYearsFromRows } = require('./src/loader');
  const { baseline_year, analysis_year } = current_year_scope();
  const events_by_year = await fetch_events_for_years([baseline_year, analysis_year]);
  const { baseline_active, analysis_active } = loadBothYearsFromRows(
    events_by_year[baseline_year], events_by_year[analysis_year]
  );

  const result = await with_db(async conn => {
    // Pull every active override targeting this sid in scope+globals.
    const [rows] = await conn.query(
      `SELECT id, override_type, sid_baseline, sid_analysis, baseline_year, analysis_year
         FROM \`${OV_TABLE}\`
        WHERE active = 1
          AND (sid_baseline = ? OR sid_analysis = ?)
          AND (
                (baseline_year IS NULL AND analysis_year IS NULL)
             OR (baseline_year = ? AND analysis_year = ?)
          )`,
      [sid, sid, baseline_year, analysis_year]
    );
    if (rows.length === 0) return { approved: 0, missing_events: [] };

    let updated = 0;
    const missing_events = [];
    for (const r of rows) {
      const { sig_baseline, sig_analysis } = await _fetch_signatures_for_override(
        r, baseline_active, analysis_active
      );
      // Warn (but don't abort) if a side that was supposed to have an event
      // doesn't — usually means the event was renamed past recognition or
      // deleted. The override still gets approved; the build will surface
      // the disconnect via its own warning chain.
      if (r.sid_baseline && !sig_baseline) missing_events.push(`baseline sid "${r.sid_baseline}"`);
      if (r.sid_analysis && !sig_analysis) missing_events.push(`analysis sid "${r.sid_analysis}"`);

      await conn.query(
        `UPDATE \`${OV_TABLE}\`
            SET approved = 1,
                approval_state = 'approved',
                approved_by = ?,
                approved_at = NOW(),
                event_signature_baseline = ?,
                event_signature_analysis = ?
          WHERE id = ?`,
        [approved_by, sig_baseline, sig_analysis, r.id]
      );
      updated++;
    }
    return { approved: updated, missing_events };
  });

  if (!result.approved) {
    console.log(`  No active override found for: ${sid} (scope: ${baseline_year} vs ${analysis_year} + globals)`);
    return result;
  }
  console.log(`✓ Approved ${result.approved} override row(s) for: ${sid}`);
  if (result.missing_events.length) {
    console.warn(`  ⚠ Could not capture signature for: ${result.missing_events.join(', ')} (event not found in current pull)`);
  }
  console.log('  Run: node build_all.js   to verify\n');
  return result;
}

async function cmd_unapprove(sid) {
  if (!sid) { console.error('Usage: --unapprove <sanction_id>'); process.exit(1); }

  const { baseline_year, analysis_year } = current_year_scope();
  const updated = await with_db(async conn => {
    // Clear approval state and signatures; keep approved_by / approved_at as
    // historical audit ("who last touched this and when"). Next approve
    // overwrites them.
    const [r] = await conn.query(
      `UPDATE \`${OV_TABLE}\`
          SET approved = 0,
              approval_state = NULL,
              event_signature_baseline = NULL,
              event_signature_analysis = NULL
        WHERE active = 1
          AND (sid_baseline = ? OR sid_analysis = ?)
          AND (
                (baseline_year IS NULL AND analysis_year IS NULL)
             OR (baseline_year = ? AND analysis_year = ?)
          )`,
      [sid, sid, baseline_year, analysis_year]
    );
    return r.affectedRows;
  });

  if (!updated) { console.log(`  No active override found for: ${sid} (scope: ${baseline_year} vs ${analysis_year} + globals)`); return { unapproved: 0 }; }
  console.log(`✓ Unapproved ${updated} override row(s) for: ${sid}  (cleared approval state + signatures)`);
  console.log('  Run: node build_all.js   to verify\n');
  return { unapproved: updated };
}

async function cmd_suggest_overrides() {
  const api_key = process.env.ANTHROPIC_API_KEY;
  if (!api_key || api_key === 'sk-ant-your-key-here') {
    console.error('ANTHROPIC_API_KEY not set. Add it to .env to use AI suggestions.');
    process.exit(1);
  }

  // Pull live event rows from usat_sales_db (same path build_all.js uses).
  // The legacy CSV loader is gone; everything now flows through fetch_events_for_years.
  const { loadBothYearsFromRows: load_both_years_from_rows } = require('./src/loader');
  const { fetch_events_for_years } = require('./src/db');
  const { runAnalysis: run_analysis } = require('./src/analysis');

  const { baseline_year: BY, analysis_year: AY } = current_year_scope();
  console.log(`\nFetching events from usat_sales_db (${BY} vs ${AY})...`);
  const events_by_year = await fetch_events_for_years([BY, AY]);
  console.log(`  ${BY} rows: ${events_by_year[BY]?.length ?? 0}  |  ${AY} rows: ${events_by_year[AY]?.length ?? 0}`);

  const loaded = load_both_years_from_rows(events_by_year[BY], events_by_year[AY]);
  loaded.BASELINE_YEAR = BY;
  loaded.ANALYSIS_YEAR = AY;
  const results = await run_analysis(loaded);
  const ya = results.years?.BASELINE_YEAR ?? BY;
  const yb = results.years?.ANALYSIS_YEAR ?? AY;

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

  // Pull active overrides from the DB (year-scoped + globals) so we don't
  // re-suggest pairs that already have a manual decision. Safe-no-op if the
  // DB read fails — we just won't filter, which is preferable to crashing.
  const { baseline_year, analysis_year } = current_year_scope();
  const existing_ov = (await load_overrides({ baseline_year, analysis_year, silent: true })) ?? {
    force_match: [], force_no_match: [], force_segment: [],
  };
  const already_overridden = new Set([
    ...existing_ov.force_match.flatMap(e => [e.sid_baseline, e.sid_analysis]),
    ...existing_ov.force_no_match.map(e => e.sid_baseline ?? e.sid_analysis),
    ...existing_ov.force_segment.map(e => e.sid_baseline ?? e.sid_analysis),
  ].filter(Boolean));

  const attrited_filtered = attrited.filter(e => !already_overridden.has(e.sid));
  const new_filtered      = new_ev.filter(e => !already_overridden.has(e.sid));

  console.log(`\nAnalysing ${attrited_filtered.length} unmatched ${ya} events and ${new_filtered.length} unmatched ${yb} events...`);
  console.log('Asking Claude to suggest likely missed matches...\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });

  const prompt = `You are reviewing event matching between two years of sanctioned sports events.

The automatic matcher missed some events that may actually be the same event under a different name.

Unmatched ${ya} events (Lost — did not return):
${JSON.stringify(attrited_filtered.slice(0, 80), null, 1)}

Unmatched ${yb} events (New — no ${ya} match found):
${JSON.stringify(new_filtered.slice(0, 80), null, 1)}

Identify the TOP 10 most likely missed matches — pairs where a ${ya} event and ${yb} event are almost certainly the same event series despite name differences (sponsor changes, location updates, rebranding, year references removed, abbreviation changes, etc.).

For each suggestion output EXACTLY this JSON format (no other text):
[
  {
    "sid_baseline": "...",
    "name_25": "...",
    "sid_analysis": "...",
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
    console.log(`   Add: node ask.js --add-override match ${s.sid_baseline} ${s.sid_analysis} "${s.reason}"\n`);
  });

  // Offer to add all High confidence ones. Wrap the readline question in a
  // promise so we can `await` the inserts sequentially — otherwise the
  // success message prints before the DB writes finish, and rl.close()
  // races the unawaited cmd_add_match calls.
  const high = suggestions.filter(s => s.confidence === 'High');
  if (high.length) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question(`Add all ${high.length} High-confidence suggestions to the overrides DB? (y/n): `, ans => {
        rl.close();
        resolve(ans);
      });
    });
    if (answer.trim().toLowerCase() === 'y') {
      let added = 0;
      for (const s of high) {
        const r = await cmd_add_match(s.sid_baseline, s.sid_analysis, s.reason);
        if (r?.status === 'inserted') added++;
      }
      console.log(`\n✓ Added ${added} override(s) (${high.length - added} already present). Run: node build_all.js   to apply`);
    }
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  await resolve_output_dir();
  const args = process.argv.slice(2);

  // ── Override management commands ──────────────────────────────────────
  if (args[0] === '--what-changed') {
    const current_cm  = load_json(path.join(OUTPUT_DIR, 'commentary.json'));
    const current_res = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
    if (!current_cm) { console.error('Run node build_all.js first.'); process.exit(1); }

    // Find most recent archive
    const archive_dir = path.join(OUTPUT_DIR, 'archive');
    const prior_runs  = fs.existsSync(archive_dir) ? fs.readdirSync(archive_dir).sort().reverse() : [];
    const prior_cm_path = prior_runs.length ? path.join(archive_dir, prior_runs[0], 'commentary.json') : null;
    const prior_cm = prior_cm_path && fs.existsSync(prior_cm_path) ? load_json(prior_cm_path) : null;

    if (!prior_cm) {
      console.log('\nNo prior build found in archive. Run node build_all.js twice to compare.\n');
      return;
    }

    // Quick diff summary (non-AI)
    const metric_keys = { n_baseline: 'Prior-yr events', n_analysis: 'Current-yr events', net: 'Net change',
      attrited: 'Lost', new_ev: 'New events', rec: 'Recovered', repl_rate: 'Replacement %' };
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
      if (changes_txt_path = path.join(OUTPUT_DIR, 'changes.txt'), fs.existsSync(changes_txt_path)) {
        console.log('\nFull diff: output/changes.txt');
      }
    }
    return;
  }

  if (args[0] === '--list-overrides') {
    cmd_list_overrides(); return;
  }

  if (args[0] === '--remove-override') {
    await cmd_remove_override(args[1]); return;
  }

  if (args[0] === '--approve') {
    await cmd_approve(args[1]); return;
  }

  if (args[0] === '--unapprove') {
    await cmd_unapprove(args[1]); return;
  }

  if (args[0] === '--suggest-overrides') {
    await cmd_suggest_overrides(); return;
  }

  if (args[0] === '--add-override') {
    // Pull --global out of the trailing args so it can appear anywhere after
    // the positional values. Default is current-scope (year env vars); --global
    // leaves both year columns NULL so the override applies to every pair.
    const global = args.includes('--global');
    const positional = args.filter(a => a !== '--global');
    const sub = positional[1];

    if (sub === 'match') {
      // --add-override match <sid_baseline> <sid_analysis> ["note"] [--global]
      const note = positional[4] || '';
      await cmd_add_match(positional[2], positional[3], note, { global }); return;
    }
    if (sub === 'no-match') {
      // --add-override no-match <baseline|analysis|25|26> <sid> ["note"] [--global]
      const note = positional[4] || '';
      await cmd_add_no_match(positional[2], positional[3], note, { global }); return;
    }
    if (sub === 'segment') {
      // --add-override segment <baseline|analysis|25|26> <sid> <segment> ["note"] [--global]
      const note = positional[5] || '';
      await cmd_add_segment(positional[2], positional[3], positional[4], note, { global }); return;
    }
    console.error('Unknown override type. Use: match | no-match | segment');
    process.exit(1);
  }

  // ── Legacy flag ───────────────────────────────────────────────────────
  if (args[0] === '--list-unmatched') {
    const results = load_json(path.join(OUTPUT_DIR, 'analysis_results.json'));
    if (!results) { console.error('Run node build_all.js first.'); process.exit(1); }
    console.log('\nUse --suggest-overrides for AI-powered match suggestions.');
    console.log('Use --list-overrides to see active overrides.\n');
    if (results.overrides?.total_applied) {
      console.log(`Active overrides: ${results.overrides.total_applied}`);
      results.overrides.applied.forEach(o =>
        console.log(`  ${o.type}: ${o.sid_baseline ?? ''}${o.sid_analysis ? ' / '+o.sid_analysis : ''} → ${o.result}`)
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
  --help                            List options and commands
  --save-notes                      Save answer to notes.md (auto-pruned)
  --update-commentary <key>         Rewrite a key in output/commentary.json

── Override commands ─────────────────────────────────
  --list-overrides                  Show all active overrides
  --what-changed                    Compare current build to prior (AI summary if key set)
  --add-override match <s25> <s26> ["note"]
                                    Force two events to match
  --add-override no-match <25|26> <sid> ["note"]
                                    Prevent an event from matching (→ Lost or New)
  --add-override segment <25|26> <sid> <segment> ["note"]
                                    Override segment (Retained|Shifted|Lost|New|...)
  --remove-override <sid>           Remove all overrides for a sanction ID (soft-delete)
  --approve <sid>                   Approve overrides for a sid — silences build warnings
                                    and captures event signatures for stale-detection
  --unapprove <sid>                 Clear approval + signatures for a sid
  --suggest-overrides               Ask Claude to suggest likely missed matches (AI)

After any --add-override / --remove-override / --approve / --unapprove, run: node build_all.js

── Examples ──────────────────────────────────────────
  node ask.js "Why did Adult Clinic decline so much?"
  node ask.js "Draft a Slack post on key findings" --save-notes
  node ask.js "Rewrite slide 8 narrative more urgently" --update-commentary slide_8_narrative
  node ask.js "Rewrite slide 8 narrative with a more professional tone" --update-commentary slide_8_narrative

  node ask.js --list-overrides
  node ask.js --suggest-overrides
  node ask.js --add-override match 311655-Adult\\ Race 354307-Adult\\ Race "Same series, name changed"
  node ask.js --add-override no-match 25 311157-Adult\\ Race "Confirmed permanently cancelled"
  node ask.js --add-override segment 25 310379-Adult\\ Race Lost "Algorithm matched incorrectly"
  node ask.js --remove-override 311157-Adult\\ Race
  node ask.js --approve 310628-Adult\\ Race
  node ask.js --unapprove 310628-Adult\\ Race

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

// Only run main() when invoked as a script. When required as a module (by
// tests/overrides.test.js) we expose the cmd_* functions instead so they can
// be exercised directly against the DB.
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  cmd_add_match,
  cmd_add_no_match,
  cmd_add_segment,
  cmd_remove_override,
  cmd_list_overrides,
  cmd_approve,
  cmd_unapprove,
  current_year_scope,
  year_arg_to_column,
};

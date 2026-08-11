'use strict';
// eval/runner.js — orchestrates a stress-test run. Answers each question through the SAME grounding + model +
// system prompt the real bot uses (reuses api.build_system + the shared knowledge/corrections/ai services),
// grades it with eval/judge, aggregates a scorecard, and persists to eval/store. Runs as a BACKGROUND job with
// small concurrency (100 Qs x 2 AI calls would time out a request), exposing in-memory progress for polling.
const ai = require('../../../services/ai');
const kb = require('../../../services/knowledge');
const grounding = require('../../../services/knowledge/grounding');
const corrections = require('../../../services/corrections');
const corr_store = require('../../../services/corrections/mysql_store');
const settings = require('../settings');
const chatbot_api = require('../api');           // for build_system (identical prompt to the live bot)
const store = require('./store');
const questions = require('./questions');
const judge = require('./judge');

const RETRIEVE_N = Number(process.env.CHATBOT_RETRIEVE_N || 8);
const CONC = Math.max(1, Math.min(6, Number(process.env.CHATBOT_EVAL_CONCURRENCY || 4)));

let _store = null;
async function get_corr_store() { if (!_store) _store = await corr_store.create_store(); return _store; }

// In-memory progress for the active/recent runs (polled by the status endpoint). Lost on restart; the
// persisted eval_runs row is the durable record.
const JOBS = {};
function short_id() { return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// Provider for a model — from the shared registry (each row carries its provider), else inferred by name. This
// is why an OpenAI model must NOT be sent to the bot's default (Anthropic) provider just because settings say so.
function provider_for(model) {
  const m = String(model || '');
  try { const hit = (ai.list_models() || []).find(function (x) { return x.model === m; }); if (hit) return hit.provider; } catch (e) { /* ignore */ }
  return /claude|anthropic/i.test(m) ? 'anthropic' : 'openai';
}

// Answer ONE question exactly as the bot would (strict/broad per settings), returning answer + cost.
async function answer_question(queue, message, ctx) {
  const st = ctx.settings;
  const provider = ctx.answer_provider || provider_for(ctx.answer_model) || 'openai';
  const model = ctx.answer_model;
  const fileK = await kb.load_knowledge(queue);
  const ret = await grounding.retrieve(queue, message, RETRIEVE_N);
  const knowledge = grounding.combine(fileK, ret.block);
  let corr = [];
  try { corr = await corrections.grounding_lines(await get_corr_store(), 12, { queue: queue }); } catch (e) { corr = []; }
  const mode = st.grounding || 'strict';
  const t0 = Date.now();
  const raw = await ai.complete({ provider: provider, model: model, system: chatbot_api.build_system(queue, knowledge, corr, mode), prompt: 'User: ' + message + '\nAssistant:' });
  const latency = Date.now() - t0;
  const out = ai.norm_completion(raw, model);
  const usage = out.usage || {};
  const ptok = Number(usage.prompt_tokens) || 0, ctok = Number(usage.completion_tokens) || 0;
  // Provenance — WHERE the answer came from: the curated chunks retrieved for this question, PLUS the corrections
  // that were in the bot's context (corrections are authoritative and can be the real source of a link/date).
  let sources = [];
  try { sources = (grounding.provenance(ret.used || []) || []).slice(0, 6).map(function (p) { return { title: p.source_title || p.source_ref || '', url: p.source_ref || '', score: Math.round((Number(p.score) || 0) * 100) / 100, mode: ret.mode, snippet: p.snippet || '' }; }); } catch (e) { sources = []; }
  const corrText = (corr || []).map(String).join('\n').trim();
  if (corrText) {
    sources = sources.concat((corr || []).slice(0, 6).map(function (line) { return { title: 'Correction', url: '', score: null, mode: 'correction', snippet: String(line).replace(/\s+/g, ' ').trim().slice(0, 600) }; }));
  }
  // The JUDGE must grade against EXACTLY what the answering model was given: retrieved knowledge + the same
  // corrections. Corrections go first (authoritative) so the 9000-char cap never drops them. This is what keeps
  // the answerer and the judge from getting askew — both see the identical grounding material.
  const judgeKnowledge = [
    corrText ? ('CORRECTIONS (authoritative operator answers — treat as ground truth):\n' + corrText) : '',
    knowledge || '',
  ].filter(Boolean).join('\n\n');
  return {
    answer: (out && out.text) ? String(out.text).trim() : '',
    grounded: !!((knowledge && knowledge.length) || corrText),
    latency_ms: latency, prompt_tokens: ptok, completion_tokens: ctok,
    cost_usd: ai.cost_for(out.model || model, ptok, ctok),
    sources: sources, knowledge_chars: judgeKnowledge.length, retrieval_mode: ret.mode,
    // No cap: the answering model gets the FULL knowledge + corrections (build_system doesn't truncate), so the
    // judge gets the identical full text. They track exactly — the judge can never grade against less than the bot saw.
    knowledge_text: judgeKnowledge,
  };
}

// Concurrency-limited map.
async function pool_map(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: (e && e.message) || String(e) }; } } }
  const workers = []; for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

function scorecard(results) {
  const on = results.filter(function (r) { return r.expected !== 'deflect'; });
  const off = results.filter(function (r) { return r.expected === 'deflect'; });
  const grounded_ok = on.filter(function (r) { return r.category === 'correct-grounded'; }).length;
  const deflect_ok = off.filter(function (r) { return r.category === 'correct-deflected'; }).length;
  const avg = results.length ? Math.round(results.reduce(function (s, r) { return s + (Number(r.score) || 0); }, 0) / results.length) : 0;
  return {
    score_overall: avg,
    coverage_pct: on.length ? Math.round((grounded_ok / on.length) * 100) : 0,
    safety_pct: off.length ? Math.round((deflect_ok / off.length) * 100) : 0,
    on_topic: on.length, off_topic: off.length,
  };
}

// Core: grade a list of prepared items {question, expected, topic, bucket, source, expected_answer?} under one run.
async function run_items(items, meta) {
  const run_id = meta.run_id;
  const ctx = { settings: meta.settings, answer_model: meta.answer_model, answer_provider: meta.answer_provider };
  const job = JOBS[run_id];
  let ptok = 0, ctok = 0, cost = 0;
  const graded = await pool_map(items, CONC, async function (item) {
    if (job && job.cancelled) return null;   // Stop pressed — skip remaining items (don't spend more tokens)
    let ans = { answer: '', grounded: false, latency_ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, sources: [] };
    try { ans = await answer_question(meta.queue, item.question, ctx); } catch (e) { ans.answer = ''; ans.error = (e && e.message) || 'answer failed'; }
    const g = await judge.judge_one(item, ans.answer, ans.grounded, { judge_model: meta.judge_model, knowledge: ans.knowledge_text });
    const ju = g.usage || {};
    const jptok = Number(ju.prompt_tokens) || 0, jctok = Number(ju.completion_tokens) || 0;
    const jcost = g.model ? ai.cost_for(g.model, jptok, jctok) : 0;
    ptok += ans.prompt_tokens + jptok; ctok += ans.completion_tokens + jctok; cost += (ans.cost_usd || 0) + jcost;
    if (job) { job.graded++; job.cost_usd = Math.round(cost * 1e6) / 1e6; }
    return {
      question: item.question, bucket: item.bucket, expected: item.expected, topic: item.topic || null, source: item.source || null,
      answer: ans.answer, grounded: ans.grounded, category: g.category, score: g.score, reason: g.reason,
      latency_ms: ans.latency_ms, cost_usd: Math.round(((ans.cost_usd || 0) + jcost) * 1e6) / 1e6,
      sources: JSON.stringify(ans.sources || []),
    };
  });
  const results = graded.filter(Boolean);   // drop skipped (cancelled) items
  const stopped = !!(job && job.cancelled);
  const card = scorecard(results);
  await store.insert_results(run_id, results);
  await store.update_run(run_id, Object.assign({ status: stopped ? 'stopped' : 'done', graded: results.length, total: results.length, prompt_tokens: ptok, completion_tokens: ctok, cost_usd: Math.round(cost * 1e6) / 1e6 }, card));
  if (job) { Object.assign(job, { status: stopped ? 'stopped' : 'done' }, card, { cost_usd: Math.round(cost * 1e6) / 1e6 }); }
  return Object.assign({ run_id: run_id }, card);
}

// Start a run in the BACKGROUND. Returns { run_id, total } once the bank is assembled + row created.
async function start(opts) {
  opts = opts || {};
  const st = settings.get();
  // Provider must follow the CHOSEN model (registry), not the bot's default — else an OpenAI model gets sent to
  // Anthropic and every answer comes back empty. Fall back to settings only for the "(default)" choice.
  const provider = opts.answer_model ? provider_for(opts.answer_model) : (st.provider || 'openai');
  const answer_model = ai.resolve_model(provider, opts.answer_model || st.model || null, process.env);
  if (!answer_model) throw new Error('No answering model configured (set it in Settings).');
  // Resolve the judge (evaluation) model too, so the run RECORDS the real model used — not null when "default".
  const jprov = /claude|anthropic/i.test(String(opts.judge_model || '')) ? 'anthropic' : 'openai';
  const judge_model = ai.resolve_model(jprov, opts.judge_model || null, process.env) || answer_model;
  const queue = String(opts.queue || process.env.CHATBOT_QUEUE || 'Team USA');

  // Corrections are the 3rd knowledge source (URLs + files are read inside build_bank). Load them the same way the
  // answering path does, and feed them in so generated questions can also probe what the corrections cover.
  let corrText = '';
  try { const lines = await corrections.grounding_lines(await get_corr_store(), 60, { queue: queue }); corrText = (lines || []).join('\n'); } catch (e) { corrText = ''; }

  const built = await questions.build_bank({ queue: queue, total: opts.total, on_pct: opts.on_pct, sources: opts.sources, gen_model: opts.gen_model || judge_model, corrections_text: corrText });
  if (!built.bank.length) throw new Error('No questions assembled — add golden/off-topic questions or enable log/knowledge sources.');

  const run_id = short_id();
  await store.create_run({ run_id: run_id, queue: queue, answer_model: answer_model, judge_model: judge_model, total: built.total, on_topic: built.on_topic, off_topic: built.off_topic });
  JOBS[run_id] = { run_id: run_id, status: 'running', total: built.total, graded: 0, on_topic: built.on_topic, off_topic: built.off_topic, cost_usd: 0, queue: queue, requested: built.requested, note: built.note || '' };

  const meta = { run_id: run_id, queue: queue, settings: st, answer_provider: provider, answer_model: answer_model, judge_model: judge_model };
  // Fire-and-forget: process in the background so the HTTP request returns immediately.
  run_items(built.bank, meta).catch(async function (e) {
    try { await store.update_run(run_id, { status: 'error', error: String((e && e.message) || e).slice(0, 380) }); } catch (x) { /* ignore */ }
    if (JOBS[run_id]) JOBS[run_id].status = 'error', JOBS[run_id].error = (e && e.message) || String(e);
  });
  return { run_id: run_id, total: built.total, on_topic: built.on_topic, off_topic: built.off_topic, requested: built.requested, note: built.note || '' };
}

// Re-run only the failing/weak/gap questions from a prior run as a NEW run.
async function rerun_failures(prev_run_id, opts) {
  const rows = await store.results_for(prev_run_id, {});
  const bad = rows.filter(function (r) { return ['wrong', 'weak', 'missed-gap', 'error'].indexOf(r.category) >= 0; });
  if (!bad.length) throw new Error('No failing questions in that run to re-run.');
  const st = settings.get();
  const provider = (opts && opts.answer_model) ? provider_for(opts.answer_model) : (st.provider || 'openai');
  const answer_model = ai.resolve_model(provider, (opts && opts.answer_model) || st.model || null, process.env);
  const jprov = /claude|anthropic/i.test(String((opts && opts.judge_model) || '')) ? 'anthropic' : 'openai';
  const judge_model = ai.resolve_model(jprov, (opts && opts.judge_model) || null, process.env) || answer_model;
  const prev = await store.get_run(prev_run_id);
  const queue = (prev && prev.queue) || process.env.CHATBOT_QUEUE || 'Team USA';
  const items = bad.map(function (r) { return { question: r.question, expected: r.expected || 'answer', topic: r.topic, bucket: r.bucket || (r.expected === 'deflect' ? 'off' : 'on'), source: 'rerun' }; });
  const run_id = short_id();
  const on_topic = items.filter(function (i) { return i.expected !== 'deflect'; }).length;
  await store.create_run({ run_id: run_id, queue: queue, answer_model: answer_model, judge_model: judge_model, total: items.length, on_topic: on_topic, off_topic: items.length - on_topic });
  JOBS[run_id] = { run_id: run_id, status: 'running', total: items.length, graded: 0, on_topic: on_topic, off_topic: items.length - on_topic, cost_usd: 0, queue: queue };
  const meta = { run_id: run_id, queue: queue, settings: st, answer_provider: provider, answer_model: answer_model, judge_model: judge_model };
  run_items(items, meta).catch(async function (e) {
    try { await store.update_run(run_id, { status: 'error', error: String((e && e.message) || e).slice(0, 380) }); } catch (x) { /* ignore */ }
    if (JOBS[run_id]) JOBS[run_id].status = 'error';
  });
  return { run_id: run_id, total: items.length };
}

function progress(run_id) { return JOBS[run_id] || null; }
// Stop a running run — sets a cancel flag the grading loop checks between items. Already-graded rows are kept.
function cancel(run_id) { const j = JOBS[run_id]; if (j) { j.cancelled = true; return true; } return false; }

// Draft a CORRECTION for a failed question: re-retrieve the current knowledge and ask the AI to write the
// correct, grounded answer the bot SHOULD give. Returns the draft (a human approves it → it becomes a live
// correction the bot follows). Grounded in curated knowledge only — links must come from it, never invented.
async function suggest_correction(queue, question, wrong_answer, reason) {
  const st = settings.get();
  const provider = st.provider || 'openai';
  const model = ai.resolve_model(provider, st.model || null, process.env);
  if (!model) throw new Error('No model configured to draft a correction.');
  const q = String(question || '').trim();
  if (!q) throw new Error('No question to draft a correction for.');
  const fileK = await kb.load_knowledge(queue);
  const ret = await grounding.retrieve(queue, q, RETRIEVE_N);
  const knowledge = grounding.combine(fileK, ret.block);
  const system = 'You are drafting a CORRECTION that will be given to a USA Triathlon "' + String(queue || 'program') +
    '" assistant as AUTHORITATIVE guidance it must follow. Using ONLY the KNOWLEDGE below, write the correct, concise ' +
    'answer the assistant SHOULD give to the QUESTION. Include any relevant link as a Markdown [label](https://…) that ' +
    'appears in the KNOWLEDGE; never invent, guess, or modify a URL. If the KNOWLEDGE does not cover it, write exactly: ' +
    '"I don\'t have that information — please contact USA Triathlon at usatriathlon.org." Output ONLY the answer text, no preamble.\n\n' +
    'KNOWLEDGE:\n' + (knowledge || '(no knowledge retrieved)').slice(0, 12000);
  const prompt = 'QUESTION: ' + q + '\n' +
    (wrong_answer ? ('The assistant previously answered (INCORRECTLY):\n' + String(wrong_answer).slice(0, 1500) + '\n') : '') +
    (reason ? ('Why it was wrong: ' + String(reason) + '\n') : '') +
    '\nWrite the correct answer the assistant should give:';
  const raw = await ai.complete({ provider: provider, model: model, system: system, prompt: prompt });
  const out = ai.norm_completion(raw, model);
  return { suggestion: (out && out.text ? String(out.text).trim() : ''), model: out.model || model, sources: grounding.provenance(ret.used || []) };
}

module.exports = { start, rerun_failures, progress, cancel, suggest_correction, answer_question, scorecard };

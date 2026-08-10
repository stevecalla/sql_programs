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

// Answer ONE question exactly as the bot would (strict/broad per settings), returning answer + cost.
async function answer_question(queue, message, ctx) {
  const st = ctx.settings;
  const provider = st.provider || 'openai';
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
  return {
    answer: (out && out.text) ? String(out.text).trim() : '',
    grounded: !!(knowledge && knowledge.length),
    latency_ms: latency, prompt_tokens: ptok, completion_tokens: ctok,
    cost_usd: ai.cost_for(out.model || model, ptok, ctok),
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
  const ctx = { settings: meta.settings, answer_model: meta.answer_model };
  const job = JOBS[run_id];
  let ptok = 0, ctok = 0, cost = 0;
  const results = await pool_map(items, CONC, async function (item) {
    let ans = { answer: '', grounded: false, latency_ms: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
    try { ans = await answer_question(meta.queue, item.question, ctx); } catch (e) { ans.answer = ''; ans.error = (e && e.message) || 'answer failed'; }
    const g = await judge.judge_one(item, ans.answer, ans.grounded, { judge_model: meta.judge_model });
    const ju = g.usage || {};
    const jptok = Number(ju.prompt_tokens) || 0, jctok = Number(ju.completion_tokens) || 0;
    const jcost = g.model ? ai.cost_for(g.model, jptok, jctok) : 0;
    ptok += ans.prompt_tokens + jptok; ctok += ans.completion_tokens + jctok; cost += (ans.cost_usd || 0) + jcost;
    if (job) { job.graded++; job.cost_usd = Math.round(cost * 1e6) / 1e6; }
    return {
      question: item.question, bucket: item.bucket, expected: item.expected, topic: item.topic || null, source: item.source || null,
      answer: ans.answer, grounded: ans.grounded, category: g.category, score: g.score, reason: g.reason,
      latency_ms: ans.latency_ms, cost_usd: Math.round(((ans.cost_usd || 0) + jcost) * 1e6) / 1e6,
    };
  });
  const card = scorecard(results);
  await store.insert_results(run_id, results);
  await store.update_run(run_id, Object.assign({ status: 'done', graded: results.length, prompt_tokens: ptok, completion_tokens: ctok, cost_usd: Math.round(cost * 1e6) / 1e6 }, card));
  if (job) { Object.assign(job, { status: 'done' }, card, { cost_usd: Math.round(cost * 1e6) / 1e6 }); }
  return Object.assign({ run_id: run_id }, card);
}

// Start a run in the BACKGROUND. Returns { run_id, total } once the bank is assembled + row created.
async function start(opts) {
  opts = opts || {};
  const st = settings.get();
  const provider = /claude|anthropic/i.test(String(opts.answer_model || '')) ? 'anthropic' : (st.provider || 'openai');
  const answer_model = ai.resolve_model(provider, opts.answer_model || st.model || null, process.env);
  if (!answer_model) throw new Error('No answering model configured (set it in Settings).');
  const judge_model = opts.judge_model || null;
  const queue = String(opts.queue || process.env.CHATBOT_QUEUE || 'Team USA');

  const built = await questions.build_bank({ queue: queue, total: opts.total, on_pct: opts.on_pct, sources: opts.sources, gen_model: opts.gen_model || judge_model });
  if (!built.bank.length) throw new Error('No questions assembled — add golden/off-topic questions or enable log/knowledge sources.');

  const run_id = short_id();
  await store.create_run({ run_id: run_id, queue: queue, answer_model: answer_model, judge_model: judge_model, total: built.total, on_topic: built.on_topic, off_topic: built.off_topic });
  JOBS[run_id] = { run_id: run_id, status: 'running', total: built.total, graded: 0, on_topic: built.on_topic, off_topic: built.off_topic, cost_usd: 0, queue: queue };

  const meta = { run_id: run_id, queue: queue, settings: Object.assign({}, st, { provider: provider }), answer_model: answer_model, judge_model: judge_model };
  // Fire-and-forget: process in the background so the HTTP request returns immediately.
  run_items(built.bank, meta).catch(async function (e) {
    try { await store.update_run(run_id, { status: 'error', error: String((e && e.message) || e).slice(0, 380) }); } catch (x) { /* ignore */ }
    if (JOBS[run_id]) JOBS[run_id].status = 'error', JOBS[run_id].error = (e && e.message) || String(e);
  });
  return { run_id: run_id, total: built.total, on_topic: built.on_topic, off_topic: built.off_topic };
}

// Re-run only the failing/weak/gap questions from a prior run as a NEW run.
async function rerun_failures(prev_run_id, opts) {
  const rows = await store.results_for(prev_run_id, {});
  const bad = rows.filter(function (r) { return ['wrong', 'weak', 'missed-gap', 'error'].indexOf(r.category) >= 0; });
  if (!bad.length) throw new Error('No failing questions in that run to re-run.');
  const st = settings.get();
  const provider = /claude|anthropic/i.test(String((opts && opts.answer_model) || '')) ? 'anthropic' : (st.provider || 'openai');
  const answer_model = ai.resolve_model(provider, (opts && opts.answer_model) || st.model || null, process.env);
  const judge_model = (opts && opts.judge_model) || null;
  const prev = await store.get_run(prev_run_id);
  const queue = (prev && prev.queue) || process.env.CHATBOT_QUEUE || 'Team USA';
  const items = bad.map(function (r) { return { question: r.question, expected: r.expected || 'answer', topic: r.topic, bucket: r.bucket || (r.expected === 'deflect' ? 'off' : 'on'), source: 'rerun' }; });
  const run_id = short_id();
  const on_topic = items.filter(function (i) { return i.expected !== 'deflect'; }).length;
  await store.create_run({ run_id: run_id, queue: queue, answer_model: answer_model, judge_model: judge_model, total: items.length, on_topic: on_topic, off_topic: items.length - on_topic });
  JOBS[run_id] = { run_id: run_id, status: 'running', total: items.length, graded: 0, on_topic: on_topic, off_topic: items.length - on_topic, cost_usd: 0, queue: queue };
  const meta = { run_id: run_id, queue: queue, settings: Object.assign({}, st, { provider: provider }), answer_model: answer_model, judge_model: judge_model };
  run_items(items, meta).catch(async function (e) {
    try { await store.update_run(run_id, { status: 'error', error: String((e && e.message) || e).slice(0, 380) }); } catch (x) { /* ignore */ }
    if (JOBS[run_id]) JOBS[run_id].status = 'error';
  });
  return { run_id: run_id, total: items.length };
}

function progress(run_id) { return JOBS[run_id] || null; }

module.exports = { start, rerun_failures, progress, answer_question, scorecard };

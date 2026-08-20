'use strict';
// eval/api.js — HTTP surface for the stress-test / training harness. Admin/operator-gated (panel 'chatbot').
// Runs are BACKGROUND jobs: POST /run returns a run_id immediately; the client polls GET /status. Question-bank
// CRUD + bulk upload feed the curated pools. Mounted by modules/chatbot/module.js.
//   POST /api/chatbot/eval/run           { queue, total, on_pct, sources, answer_model, judge_model } -> { run_id }
//   GET  /api/chatbot/eval/status?run_id -> { running, progress, run }
//   GET  /api/chatbot/eval/run?run_id    -> { run, results }
//   GET  /api/chatbot/eval/last          -> { run, results }   (most recent completed)
//   GET  /api/chatbot/eval/runs          -> { runs }            (history / trend)
//   POST /api/chatbot/eval/rerun         { run_id }             (re-run failures as a new run)
//   GET  /api/chatbot/eval/questions?bucket -> { questions, count }
//   POST /api/chatbot/eval/questions     { question,... } | { questions:[...] }  (add one or bulk)
//   POST /api/chatbot/eval/questions/update { id, ... }
//   POST /api/chatbot/eval/questions/delete { id }
//   POST /api/chatbot/eval/promote       { question, expected, topic, bucket }   (add a result to the bank)
const { require_panel } = require('../../../auth/require_auth');
const store = require('./store');
const runner = require('./runner');

const P = '/api/chatbot/eval';
// Stress test / training harness is its own grantable page: panel 'chatbot-stress'. (The shared operator
// surface it also reads — queues, context, corrections — lives in ../api.js under any_gate, so a
// stress-only grant still loads that data.)
const gate = require_panel('chatbot-stress');

function mount(app) {
  // ---- runs ----
  app.post(P + '/run', gate, async function (req, res) {
    const b = req.body || {};
    try {
      const r = await runner.start({
        queue: b.queue, total: b.total, on_pct: b.on_pct, sources: b.sources,
        answer_model: b.answer_model, judge_model: b.judge_model, gen_model: b.gen_model,
      });
      res.json(Object.assign({ ok: true }, r));
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'run failed to start' }); }
  });
  app.get(P + '/status', gate, async function (req, res) {
    try {
      const run_id = String(req.query.run_id || '');
      const prog = runner.progress(run_id);
      const run = await store.get_run(run_id);
      res.json({ ok: true, running: !!(prog && prog.status === 'running'), progress: prog || null, run: run || null });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.get(P + '/run', gate, async function (req, res) {
    try {
      const run_id = String(req.query.run_id || '');
      const run = await store.get_run(run_id);
      const results = run ? await store.results_for(run_id, { category: req.query.category || undefined }) : [];
      res.json({ ok: true, run: run, results: results });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.get(P + '/last', gate, async function (req, res) {
    try {
      const run = await store.last_run();
      const results = run ? await store.results_for(run.run_id, {}) : [];
      res.json({ ok: true, run: run, results: results });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.get(P + '/runs', gate, async function (req, res) {
    try { res.json({ ok: true, runs: await store.list_runs(Number(req.query.limit) || 12, req.query.queue || undefined) }); }
    catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/rerun', gate, async function (req, res) {
    const b = req.body || {};
    try { res.json(Object.assign({ ok: true }, await runner.rerun_failures(String(b.run_id || ''), { answer_model: b.answer_model, judge_model: b.judge_model }))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'rerun failed' }); }
  });
  // AI-draft a correction for a failed question (human approves it → live). Grounded in current knowledge.
  app.post(P + '/suggest-correction', gate, async function (req, res) {
    const b = req.body || {};
    try {
      let queue = b.queue;
      if (!queue && b.run_id) { const run = await store.get_run(String(b.run_id)); queue = run && run.queue; }
      const r = await runner.suggest_correction(queue, String(b.question || ''), b.answer, b.reason);
      res.json({ ok: true, suggestion: r.suggestion, sources: r.sources });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'suggest failed' }); }
  });
  // Stop a running stress test — keeps whatever has been graded so far.
  app.post(P + '/stop', gate, function (req, res) {
    const b = req.body || {};
    try { res.json({ ok: true, stopped: runner.cancel(String(b.run_id || '')) }); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'stop failed' }); }
  });
  // Human override of the judge's verdict on one result ('correct' | 'wrong' | null to reset). Recomputes the run.
  app.post(P + '/result/override', gate, async function (req, res) {
    const b = req.body || {};
    try {
      const r = await store.set_override(b.id, b.verdict, b.score);
      const run = r.run_id ? await store.get_run(r.run_id) : null;
      const results = r.run_id ? await store.results_for(r.run_id, {}) : [];
      res.json({ ok: true, run: run, results: results });
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'override failed' }); }
  });

  // ---- question bank ----
  app.get(P + '/questions', gate, async function (req, res) {
    try {
      const questions = await store.list_questions({ bucket: req.query.bucket || undefined, queue: req.query.queue || undefined });
      res.json({ ok: true, questions: questions, count: await store.count_questions() });
    } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || 'error' }); }
  });
  app.post(P + '/questions', gate, async function (req, res) {
    const b = req.body || {};
    try {
      if (Array.isArray(b.questions)) { res.json(Object.assign({ ok: true }, await store.bulk_add(b.questions))); }
      else { res.json(Object.assign({ ok: true }, await store.add_question(b))); }
    } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'add failed' }); }
  });
  app.post(P + '/questions/update', gate, async function (req, res) {
    const b = req.body || {};
    try { res.json(Object.assign({ ok: true }, await store.update_question(b.id, b))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'update failed' }); }
  });
  app.post(P + '/questions/delete', gate, async function (req, res) {
    const b = req.body || {};
    try { res.json(Object.assign({ ok: true }, await store.delete_question(b.id))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'delete failed' }); }
  });
  app.post(P + '/promote', gate, async function (req, res) {
    const b = req.body || {};
    try { res.json(Object.assign({ ok: true }, await store.add_question({ bucket: b.bucket || (b.expected === 'deflect' ? 'offtopic' : 'golden'), question: b.question, expected: b.expected, topic: b.topic, queue: b.queue }))); }
    catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || 'promote failed' }); }
  });
}

module.exports = { mount };

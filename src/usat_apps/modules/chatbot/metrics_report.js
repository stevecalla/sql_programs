'use strict';
// metrics_report.js — chatbot usage + cost report, read from chatbot_conversations. Mirrors the email queue's
// metrics/metrics_report.js in spirit (windowed, is_test-aware, one JSON blob the panel renders), but shaped
// for the chatbot: conversations/questions/answers, grounding, cost (tokens x per-model price), frequent
// channels, and the most-asked questions. Read-only; safe to call from an admin-gated endpoint.
//
// Cost/token columns are captured per bot turn by public.js (via services/ai/models.cost_for). Cached answers
// cost $0. We call conversations.ensure() first so the columns exist even on a fresh deploy.
const db = require('../../store/db');
const convo = require('./conversations');
const chunk_store = require('../../services/knowledge/chunk_store');   // shared knowledge index → embedding spend

const TABLE = 'chatbot_conversations';

function n0(v) { return Number(v) || 0; }
function usd6(v) { return Math.round((Number(v) || 0) * 1e6) / 1e6; }

// opts: { days (default 30, 1..365), is_test (0=real | 1=test | undefined=both) }
async function report(opts) {
  opts = opts || {};
  await convo.ensure();   // guarantees the table + token/cost columns exist before we query them
  const days = Math.max(1, Math.min(365, Number(opts.days) || 30));
  const W = ['created_at_utc >= (UTC_TIMESTAMP() - INTERVAL ? DAY)']; const A = [days];
  if (opts.is_test === 0 || opts.is_test === 1) { W.push('is_test = ?'); A.push(opts.is_test); }
  const where = 'WHERE ' + W.join(' AND ');

  // Overview — conversations / questions (user turns) / answers (bot turns) / grounding / latency / span.
  const ov = (await db.query(
    'SELECT COUNT(DISTINCT conversation_id) conversations, ' +
    "SUM(role='user') questions, SUM(role='bot') answers, SUM(role='bot' AND grounded=1) grounded_answers, " +
    "AVG(CASE WHEN role='bot' THEN latency_ms END) avg_latency, " +
    "DATE_FORMAT(MIN(created_at_mtn), '%Y-%m-%d %H:%i') first_mtn, DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i') last_mtn " +
    'FROM ' + TABLE + ' ' + where, A))[0] || {};

  // Cost — total + real/test split + token totals + AI-call counts (bot turns that actually hit the model;
  // cached turns carry no model, so they're excluded from "calls" but still cost $0).
  const cost = (await db.query(
    'SELECT SUM(cost_usd) total, SUM(prompt_tokens) ptok, SUM(completion_tokens) ctok, ' +
    'SUM(CASE WHEN is_test=0 THEN cost_usd ELSE 0 END) real_usd, SUM(CASE WHEN is_test=1 THEN cost_usd ELSE 0 END) test_usd, ' +
    "SUM(role='bot' AND model IS NOT NULL AND model<>'') calls, " +
    "SUM(role='bot' AND is_test=0 AND model IS NOT NULL AND model<>'') real_calls, " +
    "SUM(role='bot' AND is_test=1 AND model IS NOT NULL AND model<>'') test_calls " +
    'FROM ' + TABLE + ' ' + where, A))[0] || {};

  const by_model = await db.query(
    'SELECT model, COUNT(*) calls, SUM(prompt_tokens) ptok, SUM(completion_tokens) ctok, SUM(cost_usd) cost ' +
    'FROM ' + TABLE + ' ' + where + " AND role='bot' AND model IS NOT NULL AND model<>'' " +
    'GROUP BY model ORDER BY cost DESC, calls DESC LIMIT 8', A);

  // Daily trend — conversations / questions / answers / cost per wall-clock (MTN) day.
  const trend = await db.query(
    "SELECT DATE_FORMAT(created_at_mtn, '%Y-%m-%d') day, COUNT(DISTINCT conversation_id) conversations, " +
    "SUM(role='user') questions, SUM(role='bot') answers, SUM(cost_usd) cost " +
    'FROM ' + TABLE + ' ' + where + ' GROUP BY day ORDER BY day ASC', A);

  // Sources (grounding) — how answers were sourced: grounded vs not, avg knowledge used, avg corrections applied.
  const src = (await db.query(
    "SELECT SUM(role='bot' AND grounded=1) grounded, SUM(role='bot' AND (grounded=0 OR grounded IS NULL)) ungrounded, " +
    "AVG(CASE WHEN role='bot' THEN knowledge_chars END) avg_kchars, AVG(CASE WHEN role='bot' THEN corrections_used END) avg_corr " +
    'FROM ' + TABLE + ' ' + where, A))[0] || {};

  // Frequent channels — where the traffic comes from (web-widget, internal-poc, per-embed channel, …).
  const channels = await db.query(
    "SELECT channel, COUNT(DISTINCT conversation_id) conversations, SUM(role='user') questions, " +
    'SUM(role=\'bot\') answers, SUM(cost_usd) cost ' +
    'FROM ' + TABLE + ' ' + where + " AND channel IS NOT NULL AND channel<>'' " +
    'GROUP BY channel ORDER BY questions DESC, conversations DESC LIMIT 12', A);

  // Frequent questions ("searched") — top user messages, normalized (case/space-insensitive), with a sample.
  const questions = await db.query(
    "SELECT LOWER(TRIM(text)) qn, COUNT(*) n, MAX(text) sample " +
    'FROM ' + TABLE + ' ' + where + " AND role='user' AND text IS NOT NULL AND TRIM(text)<>'' " +
    'GROUP BY LOWER(TRIM(text)) ORDER BY n DESC, qn ASC LIMIT 15', A);

  // Conversations worked ("turns worked") — per conversation_id: turn counts, grounding, cost, last activity.
  const convos = await db.query(
    "SELECT conversation_id, MAX(channel) channel, SUM(role='user') questions, SUM(role='bot') answers, " +
    "SUM(role='bot' AND grounded=1) grounded, SUM(cost_usd) cost, MAX(is_test) is_test, " +
    "DATE_FORMAT(MAX(created_at_mtn), '%Y-%m-%d %H:%i') last_mtn " +
    'FROM ' + TABLE + ' ' + where + " AND conversation_id IS NOT NULL AND conversation_id<>'' " +
    'GROUP BY conversation_id ORDER BY MAX(created_at_utc) DESC LIMIT 50', A);

  // Embedding spend — index-build cost from the SHARED knowledge_chunks index (not windowed / not per-chat:
  // a chunk is embedded once per source). Read-only; falls back to zeros if the table/columns aren't there yet.
  let embedding = { cost_usd: 0, tokens: 0, embedded: 0, chunks: 0, by_model: [] };
  try { embedding = await chunk_store.embedding_cost_summary(); } catch (e) { /* index empty / not migrated — show zeros */ }

  const answers = n0(ov.answers), grounded = n0(ov.grounded_answers), conversations = n0(ov.conversations);

  // Reference: the exact metric queries behind this page, as runnable SQL with the CURRENT window/test filter
  // already substituted (no ? params) so an analyst can copy one and pull the number by hand. Mirrors the
  // queries executed above; the "Table reference" section on the page renders these.
  const wlit = 'WHERE created_at_utc >= (UTC_TIMESTAMP() - INTERVAL ' + days + ' DAY)' +
    (opts.is_test === 0 ? "\n  AND is_test = 0" : opts.is_test === 1 ? "\n  AND is_test = 1" : '');
  const queries = [
    { label: 'Overview — conversations / questions / answers / grounded / avg latency',
      sql: "SELECT COUNT(DISTINCT conversation_id) AS conversations,\n       SUM(role='user') AS questions,\n       SUM(role='bot') AS answers,\n       SUM(role='bot' AND grounded=1) AS grounded_answers,\n       AVG(CASE WHEN role='bot' THEN latency_ms END) AS avg_latency_ms\nFROM " + TABLE + "\n" + wlit + ";" },
    { label: 'AI spend — total + real/test split + tokens + call counts',
      sql: "SELECT SUM(cost_usd) AS total_usd,\n       SUM(CASE WHEN is_test=0 THEN cost_usd ELSE 0 END) AS real_usd,\n       SUM(CASE WHEN is_test=1 THEN cost_usd ELSE 0 END) AS test_usd,\n       SUM(prompt_tokens) AS input_tokens, SUM(completion_tokens) AS output_tokens,\n       SUM(role='bot' AND model IS NOT NULL AND model<>'') AS ai_calls\nFROM " + TABLE + "\n" + wlit + ";" },
    { label: 'AI cost by model',
      sql: "SELECT model, COUNT(*) AS calls, SUM(prompt_tokens) AS input_tokens,\n       SUM(completion_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd\nFROM " + TABLE + "\n" + wlit + "\n  AND role='bot' AND model IS NOT NULL AND model<>''\nGROUP BY model ORDER BY cost_usd DESC;" },
    { label: 'Activity by day (MTN)',
      sql: "SELECT DATE_FORMAT(created_at_mtn,'%Y-%m-%d') AS day,\n       COUNT(DISTINCT conversation_id) AS conversations,\n       SUM(role='user') AS questions, SUM(role='bot') AS answers,\n       SUM(cost_usd) AS cost_usd\nFROM " + TABLE + "\n" + wlit + "\nGROUP BY day ORDER BY day;" },
    { label: 'Sources / grounding',
      sql: "SELECT SUM(role='bot' AND grounded=1) AS grounded,\n       SUM(role='bot' AND (grounded=0 OR grounded IS NULL)) AS deflected,\n       AVG(CASE WHEN role='bot' THEN knowledge_chars END) AS avg_knowledge_chars,\n       AVG(CASE WHEN role='bot' THEN corrections_used END) AS avg_corrections\nFROM " + TABLE + "\n" + wlit + ";" },
    { label: 'Frequent channels (which bot)',
      sql: "SELECT channel, COUNT(DISTINCT conversation_id) AS conversations,\n       SUM(role='user') AS questions, SUM(role='bot') AS answers, SUM(cost_usd) AS cost_usd\nFROM " + TABLE + "\n" + wlit + "\n  AND channel IS NOT NULL AND channel<>''\nGROUP BY channel ORDER BY questions DESC;" },
    { label: 'Most-asked questions',
      sql: "SELECT MAX(text) AS sample_question, COUNT(*) AS times_asked\nFROM " + TABLE + "\n" + wlit + "\n  AND role='user' AND TRIM(text)<>''\nGROUP BY LOWER(TRIM(text)) ORDER BY times_asked DESC LIMIT 15;" },
    { label: 'Conversations worked (turns per conversation)',
      sql: "SELECT conversation_id, MAX(channel) AS channel,\n       SUM(role='user') AS questions, SUM(role='bot') AS answers,\n       SUM(role='bot' AND grounded=1) AS grounded, SUM(cost_usd) AS cost_usd,\n       DATE_FORMAT(MAX(created_at_mtn),'%Y-%m-%d %H:%i') AS last_seen\nFROM " + TABLE + "\n" + wlit + "\n  AND conversation_id IS NOT NULL AND conversation_id<>''\nGROUP BY conversation_id ORDER BY MAX(created_at_utc) DESC LIMIT 50;" },
    { label: 'Embedding spend — shared knowledge index (not windowed)',
      sql: "SELECT COALESCE(SUM(embed_cost_usd),0) AS index_cost_usd,\n       COALESCE(SUM(embed_tokens),0) AS tokens,\n       SUM(embedding IS NOT NULL) AS embedded, COUNT(*) AS chunks\nFROM knowledge_chunks WHERE excluded = 0;\n\n-- by embedding model:\nSELECT embed_model, COUNT(*) AS chunks, COALESCE(SUM(embed_tokens),0) AS tokens,\n       COALESCE(SUM(embed_cost_usd),0) AS cost_usd\nFROM knowledge_chunks\nWHERE excluded = 0 AND embedding IS NOT NULL AND embed_model IS NOT NULL AND embed_model<>''\nGROUP BY embed_model ORDER BY cost_usd DESC;" },
  ];

  return {
    embedding: embedding,
    // Reference SQL rendered on the page: DDL to recreate the tables + the metric queries above.
    schema: { chatbot_conversations: convo.DDL, knowledge_chunks: chunk_store.DDL_CHUNKS || '' },
    queries: queries,
    window: {
      days: days,
      is_test: (opts.is_test === 0 || opts.is_test === 1) ? opts.is_test : null,
      first_mtn: ov.first_mtn || null, last_mtn: ov.last_mtn || null,
    },
    overview: {
      conversations: conversations,
      questions: n0(ov.questions),
      answers: answers,
      grounded_answers: grounded,
      grounded_pct: answers ? Math.round((grounded / answers) * 100) : 0,
      deflected: Math.max(0, answers - grounded),   // answers not grounded → the polite "don't have that" fallback
      avg_latency_ms: Math.round(n0(ov.avg_latency)),
    },
    cost: {
      total_usd: usd6(cost.total),
      real_usd: usd6(cost.real_usd),
      test_usd: usd6(cost.test_usd),
      prompt_tokens: n0(cost.ptok),
      completion_tokens: n0(cost.ctok),
      per_conversation_usd: conversations ? usd6(n0(cost.total) / conversations) : 0,
      calls: n0(cost.calls),
      real_calls: n0(cost.real_calls),
      test_calls: n0(cost.test_calls),
      by_model: by_model.map(function (r) { return { model: r.model, calls: n0(r.calls), prompt_tokens: n0(r.ptok), completion_tokens: n0(r.ctok), cost_usd: usd6(r.cost) }; }),
    },
    trend: trend.map(function (r) { return { day: String(r.day || ''), conversations: n0(r.conversations), questions: n0(r.questions), answers: n0(r.answers), cost_usd: usd6(r.cost) }; }),
    sources: {
      grounded: n0(src.grounded),
      ungrounded: n0(src.ungrounded),
      grounded_pct: answers ? Math.round((grounded / answers) * 100) : 0,
      avg_knowledge_chars: Math.round(n0(src.avg_kchars)),
      avg_corrections: Math.round(n0(src.avg_corr) * 10) / 10,
    },
    channels: channels.map(function (r) { return { channel: String(r.channel || ''), conversations: n0(r.conversations), questions: n0(r.questions), answers: n0(r.answers), cost_usd: usd6(r.cost) }; }),
    questions: questions.map(function (r) { return { text: String(r.sample || '').slice(0, 120), n: n0(r.n) }; }),
    conversations_list: convos.map(function (r) {
      return {
        id: String(r.conversation_id || ''), channel: String(r.channel || ''),
        questions: n0(r.questions), answers: n0(r.answers), grounded: n0(r.grounded),
        cost_usd: usd6(r.cost), is_test: n0(r.is_test), last_mtn: r.last_mtn || null,
      };
    }),
  };
}

module.exports = { report };

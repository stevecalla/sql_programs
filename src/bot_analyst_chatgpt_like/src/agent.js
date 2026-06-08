/**
 * agent.js (ChatGPT-like tool loop) — FULL (ROBUST, UPDATED)
 *
 * ✅ Robust Zod parsing (safeParse + coercions)
 * ✅ pick_source.candidates tolerates strings/objects/singletons and normalizes
 * ✅ Fix duplicate normalize_model_payload() overwrite bug
 * ✅ safe_json_parse handles ```json fences + extra text
 * ✅ tool_run_query uses dyn_catalog (no undefined dynamic_catalog)
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { z } = require("zod");

const { assert_safe_select } = require("./sql_guard");
const { run_bigquery } = require("./bigquery");
const { get_schema_for_table } = require("./sources");

// -----------------------------
// USAT context YAML cache (optional tool + prompt grounding)
// -----------------------------
let _usat_ctx_cache = null;
let _usat_ctx_cache_loaded_at = 0;

function load_usat_context_yaml() {
  const filePath = path.resolve(__dirname, "./config/usat_context.yaml");
  const raw = fs.readFileSync(filePath, "utf8");

  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("usat_context.yaml must contain a YAML object");
  }

  return yaml.dump(parsed, { lineWidth: 120 });
}

function get_usat_context_cached() {
  const max_age_ms = 30 * 60 * 1000;
  if (_usat_ctx_cache && Date.now() - _usat_ctx_cache_loaded_at < max_age_ms) {
    return _usat_ctx_cache;
  }
  _usat_ctx_cache = load_usat_context_yaml();
  _usat_ctx_cache_loaded_at = Date.now();
  return _usat_ctx_cache;
}

// --------------------------------------------
// Helpers
// --------------------------------------------
function safe_json_parse(text) {
  try {
    if (typeof text !== "string") return null;

    // strip code fences
    const unfenced = text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    // direct parse
    try {
      return JSON.parse(unfenced);
    } catch {}

    // extract first {...} block
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = unfenced.slice(start, end + 1);
      return JSON.parse(slice);
    }

    return null;
  } catch {
    return null;
  }
}

function pick_output_text(resp_json) {
  const out = resp_json.output?.find((o) => o.type === "message");
  const content = out?.content?.find((c) => c.type === "output_text")?.text;
  return content || null;
}

function compact_sources_for_model(dyn_catalog) {
  return (dyn_catalog || []).slice(0, 250).map((t) => ({
    id: t.id,
    dataset: t.dataset,
    table: t.table,
    fqn: `${t.project}.${t.dataset}.${t.table}`,
    description: t.description,
    tags: t.tags || [],
    pii_risk: t.pii_risk || "unknown",
    date_field: t.date_field || null,
    date_expr: t.date_expr || null,
    example_questions: (t.example_questions || []).slice(0, 3),
  }));
}

function looks_like_all_null_or_empty(sample_rows) {
  const r0 = Array.isArray(sample_rows) && sample_rows.length ? sample_rows[0] : null;
  if (!r0) return true;

  const vals = Object.values(r0);
  if (!vals.length) return true;

  return !vals.some((v) => {
    if (v === null || v === undefined) return false;
    const s = typeof v === "string" ? v.trim() : String(v);
    return s !== "" && s !== "null" && s !== "undefined";
  });
}

// --------------------------------------------
// ✅ Normalizers (pre-Zod)
// --------------------------------------------
function stringify_list_items(arr) {
  if (!Array.isArray(arr)) return arr;

  return arr.map((x) => {
    if (x === null || x === undefined) return "";
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  });
}

function normalize_model_payload(p) {
  if (!p || typeof p !== "object") return p;

  if (Array.isArray(p.insights)) p.insights = stringify_list_items(p.insights);
  if (Array.isArray(p.followups)) p.followups = stringify_list_items(p.followups);

  return p;
}

function normalize_text(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function question_has_explicit_table(user_question) {
  // detects dataset.table or project.dataset.table patterns
  const q = String(user_question || "");
  return /[a-z0-9_\-]+\.[a-z0-9_\-]+(\.[a-z0-9_\-]+)?/i.test(q);
}

/**
 * Deterministic intent detector:
 * membership YTD this year vs last year + abs + % change
 */
function is_membership_ytd_yoy_question(user_question) {
  const q = normalize_text(user_question);
  const has = (x) => q.includes(x);

  const membershipish = has("membership") || has("memberships");
  const ytdish = has("ytd") || has("year to date") || has("year-to-date");
  const compareish =
    (has("this year") && (has("last year") || has("prior year"))) ||
    has("year over year") ||
    has("yoy");
  const changeish =
    has("absolute") ||
    has("abs change") ||
    has("difference") ||
    has("delta") ||
    has("percent") ||
    has("%") ||
    has("pct");

  return membershipish && ytdish && compareish && changeish;
}

// --------------------------------------------
// Candidate table suggestion (scoring + preferences)
// --------------------------------------------
function score_source(question, src) {
  const q = String(question || "").toLowerCase();

  const hay = [
    src.id,
    `${src.dataset}.${src.table}`,
    src.fqn,
    src.dataset,
    src.table,
    src.description,
    ...(src.tags || []),
    ...((src.example_questions || []) || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 30);

  let score = 0;
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (hay.includes(t)) score += 1;
  }

  const has = (s) => q.includes(s);

  if (has("membership") && hay.includes("membership")) score += 4;
  if ((has("ytd") || has("year to date")) && (hay.includes("ytd") || hay.includes("year")))
    score += 2;

  // Preference boosts for transactional/detail tables for sales questions
  if (hay.includes("membership_detail")) score += 6;
  if (hay.includes("membership_data")) score += 4;

  // Mild penalty for pre-aggregated YOY rollups unless user explicitly asked for that table
  if (!has("sales_year_over_year_data") && hay.includes("sales_year_over_year")) score -= 2;

  if (String(src.pii_risk || "").toLowerCase().includes("high")) score -= 2;

  return score;
}

function preferred_candidates_for_membership_ytd(dyn_catalog) {
  const compact = compact_sources_for_model(dyn_catalog);

  const preferred_contains = [
    "membership_reporting.membership_detail_data",
    "membership_reporting.membership_data",
    "membership_reporting.sales_actual_vs_goal_data",
    "membership_reporting.sales_year_over_year_data",
    "membership_reporting.sales_year_over_year_2026_data",
  ];

  const preferred = [];
  for (const needle of preferred_contains) {
    const hit = compact.find((s) => s.fqn.toLowerCase().includes(needle.toLowerCase()));
    if (hit) preferred.push(hit);
  }

  return preferred;
}

function top_sources_for_question(dyn_catalog, question, k = 6) {
  const compact = compact_sources_for_model(dyn_catalog);

  const ranked = compact
    .map((src) => ({ src, score: score_source(question, src) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => ({
      id: x.src.id,
      fqn: x.src.fqn,
      dataset: x.src.dataset,
      table: x.src.table,
      description: x.src.description,
      tags: x.src.tags,
      score: x.score,
    }));

  return ranked.slice(0, Math.max(2, k));
}

function make_pick_source_response({ dyn_catalog, user_question, prompt, max = 6 }) {
  const curated = preferred_candidates_for_membership_ytd(dyn_catalog);

  const rankedFqns = top_sources_for_question(dyn_catalog, user_question, 12).map((x) =>
    x.fqn.toLowerCase()
  );

  const seen = new Set();
  const combined = [];

  for (const s of curated) {
    if (!s?.fqn) continue;
    const key = s.fqn.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(s);
    }
  }

  const compact = compact_sources_for_model(dyn_catalog);
  for (const fqnLower of rankedFqns) {
    const hit = compact.find((s) => s.fqn.toLowerCase() === fqnLower);
    if (hit) {
      const key = hit.fqn.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(hit);
      }
    }
    if (combined.length >= max) break;
  }

  const final = combined.slice(0, max);
  if (final.length < 2) {
    const generic = top_sources_for_question(dyn_catalog, user_question, 6);
    return {
      type: "pick_source",
      prompt: prompt || "Pick the best table to use for this question:",
      candidates: generic.slice(0, 6).map((x) => ({
        id: x.id,
        fqn: x.fqn,
        dataset: x.dataset,
        table: x.table,
        description: x.description,
        tags: x.tags,
      })),
    };
  }

  return {
    type: "pick_source",
    prompt: prompt || "Pick the best table to use for this question:",
    candidates: final.map((x) => ({
      id: x.id,
      fqn: x.fqn,
      dataset: x.dataset,
      table: x.table,
      description: x.description,
      tags: x.tags,
    })),
  };
}

// --------------------------------------------
// ✅ Robust Zod schema: pick_source.candidates
// --------------------------------------------
const candidate_obj_schema = z
  .object({
    id: z.string().optional(),
    fqn: z.string().optional(),
    dataset: z.string().optional(),
    table: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const candidates_schema = z
  .preprocess((val) => {
    // tolerate singleton mistakes
    if (typeof val === "string") return [val];
    if (val && typeof val === "object" && !Array.isArray(val)) return [val];
    return val;
  }, z.array(z.union([candidate_obj_schema, z.string()])))
  .transform((arr) => {
    const out = (arr || []).map((c, idx) => {
      if (typeof c === "string") {
        const raw = c.trim().replace(/`/g, "");
        const parts = raw.split(".");
        const dataset = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : undefined;
        const table = parts.length === 3 ? parts[2] : parts.length === 2 ? parts[1] : undefined;

        return {
          id: `candidate_${idx + 1}`,
          fqn: raw,
          dataset,
          table,
          tags: [],
        };
      }

      const fqn =
        c.fqn ??
        (c.dataset && c.table ? `${c.dataset}.${c.table}` : undefined) ??
        (c.id ? String(c.id) : undefined);

      return {
        ...c,
        id: c.id ?? `candidate_${idx + 1}`,
        fqn: fqn ?? `unknown.${idx + 1}`,
        tags: Array.isArray(c.tags) ? c.tags : [],
      };
    });

    // enforce 2..8 without blowing up on singleton
    if (out.length === 1) out.push({ ...out[0], id: "candidate_2" });
    return out.slice(0, 8);
  })
  .refine((arr) => Array.isArray(arr) && arr.length >= 2, {
    message: "candidates must have at least 2 items",
  });

// --------------------------------------------
// Model output schema
// --------------------------------------------
const final_answer_schema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("final"),
      model: z.string().optional(),
      chosen_source: z.string().optional(),
      used_table_fqn: z.string().optional(),
      sql: z.string().optional(),
      short_answer: z.string().optional(),
      narrative: z.string().optional(),
      insights: z.array(z.string()).default([]),
      followups: z.array(z.string()).default([]),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("clarify"),
      question: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("pick_source"),
      prompt: z.string(),
      candidates: candidates_schema,
    })
    .passthrough(),
]);

/**
 * Calls OpenAI Responses API
 */
async function call_openai_responses({ model, api_key, input, tools }) {
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input, tools }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI error: ${resp.status} ${txt}`);
  }

  return await resp.json();
}

// --------------------------------------------
// Tool implementations
// --------------------------------------------
async function tool_list_sources({ dyn_catalog }) {
  const sources = compact_sources_for_model(dyn_catalog);
  return { sources, count: sources.length };
}

async function tool_suggest_sources({ dyn_catalog, question }) {
  const suggestions = top_sources_for_question(dyn_catalog, question, 6);
  return { suggestions };
}

async function tool_get_schema({ project_id, dataset_id, table_id }) {
  const cols = await get_schema_for_table(project_id, dataset_id, table_id);
  return { columns: cols || [], count: (cols || []).length };
}

async function tool_get_usat_context() {
  return { usat_context_yaml: get_usat_context_cached() };
}

async function tool_run_query({ sql, forced_table_fqn, dyn_catalog }) {
  const sql_trim = String(sql || "").trim();

  // Guard: SELECT-only + allowlist (dyn_catalog is required by your guard impl)
  const used_table_fqn = assert_safe_select(sql_trim, dyn_catalog);

  // ✅ If user forced a table, enforce it here
  if (forced_table_fqn) {
    const forced = String(forced_table_fqn).trim();
    const s = sql_trim.toLowerCase();

    const forced_plain = forced.toLowerCase();
    const forced_bt = `\`${forced}\``.toLowerCase();

    if (!s.includes(forced_plain) && !s.includes(forced_bt)) {
      throw new Error(
        `SQL must reference the user-selected table: ${forced}. ` +
          `It instead referenced: ${used_table_fqn || "unknown"}`
      );
    }
  }

  const res = await run_bigquery(sql_trim, undefined, {
    max_rows: Number(process.env.BQ_MAX_ROWS || "500"),
    sample_rows: Number(process.env.AGENT_SAMPLE_ROWS || "40"),
  });

  return {
    used_table_fqn,
    sql: sql_trim,
    row_count: (res.rows || []).length,
    bytes_processed_estimate: res.bytes_processed_estimate || 0,
    sample_rows: res.sample_rows || [],
    rows_for_slack: res.rows || [],
  };
}

// --------------------------------------------
// ✅ Deterministic post-query truth layer (from old agent)
// --------------------------------------------
function safe_num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/,/g, "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function detect_no_evidence(rows) {
  const r0 = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!r0) {
    return { no_evidence: true, reason: "no rows returned", checked: [] };
  }

  const keys = Object.keys(r0);
  const checked = [];

  let anyNumericFound = false;
  let anyNonZero = false;

  for (const k of keys) {
    const v = safe_num(r0[k]);
    if (v === null) continue;

    anyNumericFound = true;
    checked.push({ key: k, value: v });

    if (v !== 0) anyNonZero = true;
  }

  if (anyNumericFound && !anyNonZero) {
    return {
      no_evidence: true,
      reason: "all numeric metrics are 0 in summary row",
      checked,
    };
  }

  return {
    no_evidence: false,
    reason: anyNumericFound ? "some numeric metrics non-zero" : "no numeric metrics found",
    checked,
  };
}

function infer_driver_fields(rows) {
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0] || {});
  const pick = (cands) => cands.find((c) => cols.includes(c)) || null;

  const revenue_current = pick([
    "current_sales_revenue",
    "revenue_current",
    "sales_revenue_current",
    "sales_revenue_current_year",
    "sales_revenue_this_year",
    "sales_revenue_ytd_this_year",
    "sales_revenue",
  ]);

  const revenue_prior = pick([
    "prior_sales_revenue",
    "revenue_prior",
    "sales_revenue_prior",
    "sales_revenue_prior_year",
    "sales_revenue_last_year",
    "sales_revenue_ytd_last_year",
  ]);

  const units_current = pick([
    "current_sales_units",
    "units_current",
    "sales_units_current",
    "sales_units_current_year",
    "sales_units_this_year",
    "sales_units_ytd_this_year",
    "sales_units",
  ]);

  const units_prior = pick([
    "prior_sales_units",
    "units_prior",
    "sales_units_prior",
    "sales_units_prior_year",
    "sales_units_last_year",
    "sales_units_ytd_last_year",
  ]);

  const revenue_diff = pick([
    "revenue_diff_abs",
    "absolute_change_revenue",
    "revenue_diff",
    "revenue_change",
    "delta_revenue",
    "abs_sales_revenue_change",
    "sales_revenue_abs_change",
    "current_minus_prior_sales_revenue",
  ]);

  const units_diff = pick([
    "units_diff_abs",
    "units_change",
    "delta_units",
    "abs_sales_units_change",
    "sales_units_abs_change",
    "current_minus_prior_sales_units",
  ]);

  return {
    revenue_current,
    revenue_prior,
    units_current,
    units_prior,
    revenue_diff,
    units_diff,
  };
}

function compute_revenue_bridge(row, fields) {
  if (!row || !fields) return null;

  const rc = fields.revenue_current ? safe_num(row[fields.revenue_current]) : null;
  const rp = fields.revenue_prior ? safe_num(row[fields.revenue_prior]) : null;
  const uc = fields.units_current ? safe_num(row[fields.units_current]) : null;
  const up = fields.units_prior ? safe_num(row[fields.units_prior]) : null;

  if (rc === null || rp === null || uc === null || up === null) return null;
  if (uc === 0 || up === 0) return null;

  const arpu_current = rc / uc;
  const arpu_prior = rp / up;

  const du = uc - up;
  const darpu = arpu_current - arpu_prior;

  const volume_impact = du * arpu_prior;
  const arpu_impact = up * darpu;
  const interaction_impact = du * darpu;

  const revenue_diff_calc = rc - rp;
  const bridge_total = volume_impact + arpu_impact + interaction_impact;

  return {
    volume_impact,
    arpu_impact,
    interaction_impact,
    revenue_diff_calc,
    bridge_total,
    bridge_residual: revenue_diff_calc - bridge_total,
  };
}

function compute_arpu_signal(row, fields) {
  if (!row || !fields) return null;

  const rc = fields.revenue_current ? safe_num(row[fields.revenue_current]) : null;
  const rp = fields.revenue_prior ? safe_num(row[fields.revenue_prior]) : null;
  const uc = fields.units_current ? safe_num(row[fields.units_current]) : null;
  const up = fields.units_prior ? safe_num(row[fields.units_prior]) : null;

  if (rc === null || rp === null || uc === null || up === null) return null;
  if (uc === 0 || up === 0) return null;

  const arpu_current = rc / uc;
  const arpu_prior = rp / up;
  const arpu_diff = arpu_current - arpu_prior;
  const arpu_diff_pct = arpu_prior !== 0 ? arpu_diff / arpu_prior : null;

  const units_diff_abs = uc - up;
  const units_diff_pct = up !== 0 ? units_diff_abs / up : null;

  const bridge = compute_revenue_bridge(row, fields);

  return {
    arpu_current,
    arpu_prior,
    arpu_diff,
    arpu_diff_pct,
    units_diff_abs,
    units_diff_pct,
    value_per_unit_direction: arpu_diff > 0 ? "up" : arpu_diff < 0 ? "down" : "flat",
    volume_direction: units_diff_abs > 0 ? "up" : units_diff_abs < 0 ? "down" : "flat",
    bridge,
  };
}

function summarize_rows(rows, analysis_type = "trend_summary") {
  const summary = {
    row_count: rows?.length || 0,
    analysis_type,
    arpu_signals: null,
    revenue_bridge: null,
    no_evidence: null,
  };

  if (!rows?.length) {
    summary.no_evidence = { no_evidence: true, reason: "no rows returned", checked: [] };
    return summary;
  }

  summary.no_evidence = detect_no_evidence(rows);

  const fields = infer_driver_fields(rows);
  const r0 = rows[0] || null;

  if (r0 && fields?.revenue_current && fields?.revenue_prior && fields?.units_current && fields?.units_prior) {
    const arpu = compute_arpu_signal(r0, fields);
    if (arpu) summary.arpu_signals = { fields, sample: [{ row: r0, signal: arpu }] };

    const bridge = compute_revenue_bridge(r0, fields);
    if (bridge) summary.revenue_bridge = { fields, sample: [{ row: r0, bridge }] };
  }

  return summary;
}

function get_model_style_instructions(model) {
  if (!model) return "";

  // Only apply to 5.1 family
  if (model.startsWith("gpt-5.1")) {
    return `
STYLE OVERRIDE (5.1 ONLY — MUST FOLLOW):

GOAL:
- Produce an insight-led executive brief grounded ONLY in the returned data.
- Optimize for "what changed / why it matters / what to watch", not metadata or bookkeeping.

DO:
- Lead with 1–2 sentence headline insight in short_answer.
- Interpret trends: direction, inflection points, peaks/troughs, recovery/plateau, recent vs historical benchmark.
- Call out anomalies/disruptions explicitly when visible in the table (e.g., shock years).
- Keep tone like a senior analytics leader briefing executives.
- Use numbers as evidence, not as the main product.
- For driver analysis, explicitly identify Top 3 positive and Bottom 3 negative drivers ranked by revenue impact.

HARD LIMIT:
- The combined Slack-visible text MUST be <= 300 characters.
- Prefer short_answer only; keep narrative empty; insights/followups empty unless absolutely necessary.

DON'T:
- Do NOT answer with coverage-only summaries (earliest_year/latest_year/year_count/total-sum) as the main output.
- Do NOT over-explain definitions unless the user asked "what does X mean?"
- Do NOT produce a single aggregate row when the user asked for multi-year insights.
- Do NOT speculate about causes that are not directly supported by the data.
- Do NOT embed "Key insights" or "Follow-ups" as headings inside narrative.

DRIVER ANALYSIS OUTPUT RULES (MANDATORY): When the user asks for a driver analysis (YoY actual or vs goal):

1) Rank rows by revenue delta (rev_diff_abs or equivalent), descending.
2) Select:
   - Top 3 POSITIVE drivers (largest positive revenue delta)
   - Top 3 NEGATIVE drivers (largest negative revenue delta)
3) These 6 rows define the analysis universe.
   - Do NOT discuss additional rows.
   - Do NOT average or summarize beyond these drivers.
4) Each driver explanation MUST reference:
   - revenue delta
   - unit delta
   - ARPU delta (or state "not observed")
5) If fewer than 3 positives or negatives exist, show all available.

STRUCTURE OUTPUT MAPPING (REQUIRED):
- short_answer: 3-4 sentences, no headings.
- narrative: 1 short paragraph of context (optional). NO bullet lists. NO section headers.
- insights: 3-4 bullet strings. Each bullet MUST reference at least one metric from the result table.
- followups: 1–3 bullet strings.

GUARDRAILS:
- If a metric is missing or null, say "not observed" and move on.
- If all key metrics are 0/null, output: "No evidence in cohort for requested cut." + 1 follow-up question.
- Target 180–450 words total across all fields.
`.trim();
  }

  // Other models: no override
  return "";
}

function needs_insight_retry({ model, user_question, result_rows, short_answer, insights, sql }) {
  if (!model?.startsWith("gpt-5.1")) return false;

  const q = String(user_question || "").toLowerCase();
  const is_multi_year_insights_ask =
    q.includes("since the earliest") ||
    q.includes("earliest year") ||
    q.includes("until 2025") ||
    q.includes("by year") ||
    q.includes("over time") ||
    q.includes("trend") ||
    q.includes("insight");

  const row_count = Array.isArray(result_rows) ? result_rows.length : null;
  const looks_like_single_rollup = row_count === 1;

  const text = `${short_answer || ""}\n${(insights || []).join("\n")}`.toLowerCase();

  const coverage_only_signals = [
    "earliest year",
    "latest year",
    "year_count",
    "total active members",
    "summed across all years",
    "not a de-duplicated lifetime count",
    "data coverage",
  ];

  const is_coverage_only =
    coverage_only_signals.filter((s) => text.includes(s)).length >= 2 &&
    (insights || []).length <= 3;

  // If the user asked for multi-year insights, but SQL produced a rollup or the narrative is coverage-only → retry.
  if (is_multi_year_insights_ask && (looks_like_single_rollup || is_coverage_only)) return true;

  return false;
}

function get_insight_retry_addendum() {
  return `
RETRY INSTRUCTION (ONE TIME ONLY):
- The user asked for multi-year INSIGHTS. Your last draft was coverage/rollup-heavy.
- Re-answer as an insight-led trend brief.
- You MUST reference the year-by-year pattern. If your query returned a single rollup row, you MUST run a year-by-year query first, then provide insights from that result.
- Do NOT mention earliest/latest/year_count totals unless explicitly asked.
- Keep the response grounded ONLY in returned data; missing metrics are "not observed".
`.trim();
}

function route_model_for_request({ user_question, domain, forced_table_fqn }) {
  const q = normalize_text(user_question || "");

  // 🔒 Hard override (debug / emergency)
  // if (process.env.OPENAI_MODEL_FORCE) {
  //   return process.env.OPENAI_MODEL_FORCE;
  // }

  // 🧠 High-stakes analytics → robust model
  const analytics_signals = [
    "vs goal",
    "against goal",
    "variance",
    "delta",
    "difference",
    "year over year",
    "yoy",
    "driver",
    "why",
    "explain",
    "underperformed",
    "overperformed",
  ];

  if (analytics_signals.some((s) => q.includes(s))) {
    return "gpt-5.1";
  }

  // 🧮 Membership / revenue questions default to 5.1
  if (domain === "membership" || domain === "goals" || domain === "rev_recognition") {
    return "gpt-5.1";
  }

  // 🗂 Table picking / schema exploration
  const exploration_signals = [
    "what tables",
    "what sources",
    "what data sources",
    "what fields",
    "schema",
    "columns",
  ];

  if (exploration_signals.some((s) => q.includes(s))) {
    return "gpt-4.1-mini";
  }

  // 🔢 Forced table + simple aggregation → mini is fine
  if (forced_table_fqn) {
    return "gpt-4.1-mini";
  }

  // 🧭 Default safe choice
  return "gpt-5.1";
}

// --------------------------------------------
// Main: ChatGPT-like tool loop
// --------------------------------------------
async function chatgpt_like_answer({ user_question, domain, memory, dyn_catalog, thread_ts, forced_table }) {
  const api_key = process.env.OPENAI_API_KEY;
  if (!api_key) throw new Error("OPENAI_API_KEY is required in .env");

  // ✅ Accept forced_table as either string or object with fqn
  const forced_table_fqn =
    typeof forced_table === "string"
      ? forced_table.trim()
      : forced_table?.fqn
      ? String(forced_table.fqn).trim()
      : null;

  // ✅ Route model AFTER forced_table_fqn exists
  const model =
    route_model_for_request({
      user_question,
      domain,
      forced_table_fqn,
    }) || process.env.OPENAI_MODEL;

  if (!model) throw new Error("OPENAI_MODEL is required in .env");

  // ✅ Log routing decision (place it right here)
  console.log("🤖 model routing:", {
    model,
    domain,
    forced_table: forced_table_fqn || null,
  });

  const project_id = String(process.env.USAT_BQ_PROJECT_ID || "").trim();
  const allowed_datasets = String(process.env.USAT_BQ_ALLOWED_DATASETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // ✅ Deterministic prompt for membership YTD YoY (if no forced table)
  if (!forced_table_fqn && !question_has_explicit_table(user_question) && is_membership_ytd_yoy_question(user_question)) {
    return make_pick_source_response({
      dyn_catalog,
      user_question,
      prompt:
        "For YTD membership sales YoY, I can compute this from different tables (transaction-level vs rollups). " +
        "Which table should I use? Reply with a number:",
      max: 6,
      model,
    });
  }

  let last_used_table_fqn = null;
  let last_sql = null;

  const tools = [
    {
      type: "function",
      name: "suggest_sources",
      description:
        "Suggest the best 3-6 tables to answer the user question. Use if table selection is ambiguous or prior query returned NULL/empty/no-evidence results.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "list_sources",
      description: "List available allowlisted data sources (tables). Use if you need the full list.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "get_schema",
      description: "Get schema for a specific table. Provide dataset_id and table_id.",
      parameters: {
        type: "object",
        properties: {
          dataset_id: { type: "string" },
          table_id: { type: "string" },
        },
        required: ["dataset_id", "table_id"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "run_query",
      description: "Run a BigQuery Standard SQL query (SELECT-only). Returns sample rows and metadata.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string" } },
        required: ["sql"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "get_usat_context",
      description: "Return USAT business definitions YAML.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ];

  const usat_context_yaml = get_usat_context_cached();

  const style_override = get_model_style_instructions(model);

  const system = `
You are a careful analytics assistant for USA Triathlon in Slack.

${style_override ? `\n${style_override}\n` : ""}

Canonical USAT business context (MUST FOLLOW):
USAT_CONTEXT_YAML:
---
${usat_context_yaml}
---

How to work:
- Use tools to inspect schema and run queries.
- If table selection is ambiguous OR a query returns NULL/empty/no-evidence results, call suggest_sources() and return type="pick_source".
- If the user has explicitly selected a table (provided in the prompt), you MUST use ONLY that table and proceed directly to get_schema() then run_query().

BigQuery rules:
- SELECT-only. No DDL/DML. No scripting.
- Use fully-qualified tables: \`project.dataset.table\`.
- Prefer aggregated outputs; avoid PII.
- Do not invent column names.
- Do not CAST/SAFE_CAST revenue/units; treat numeric metric columns as numeric.

Timeframe policy (mandatory, non-negotiable):
If the question is YTD and compares "this year" vs "last year" (YoY),
you MUST implement timeframe exactly like this:

WITH params AS (
  SELECT
    DATE_SUB(CURRENT_DATE("America/Denver"), INTERVAL 1 DAY) AS cutoff_date,
    EXTRACT(YEAR FROM DATE_SUB(CURRENT_DATE("America/Denver"), INTERVAL 1 DAY)) AS current_year,
    EXTRACT(YEAR FROM DATE_SUB(CURRENT_DATE("America/Denver"), INTERVAL 1 DAY)) - 1 AS prior_year
),
aligned AS (
  SELECT
    p.*,
    DATE_DIFF(p.cutoff_date, DATE(p.current_year, 1, 1), DAY) AS days_into_year,
    DATE_ADD(DATE(p.prior_year, 1, 1), INTERVAL DATE_DIFF(p.cutoff_date, DATE(p.current_year, 1, 1), DAY) DAY) AS prior_year_cutoff_date
  FROM params p
)

YAML Rules:
- If YAML says a default table applies, do not second-guess it based on column names.
- Use YAML notes to interpret fields (your “2025_actual represents 2026 when year_goal=2026” rule).

Goal Rules:
- If the question is a goal vs actual comparison, you MUST use the YAML’s goal_and_actual_comparison.default_table. 
- Do not ask the user to pick a table unless the query fails after attempting the YAML table. 
- "Filter (use SQL WHERE clause) by 'year_goal' equal to the year in question. e.g. 'year_goal = 2026'"
- Column names may be misleading; follow YAML notes (e.g., actual columns may be labeled 2025 but represent 2026 when year_goal=2026).

Driver rules (non-negotiable)
- “Identify the top positive and negative membership categories ranked by revenue delta vs goal for x Month and Y Year (i.e. January 2026), and explain how mix and price drove the net variance.”
- Rank by revenue delta vs goal (not units)
- Include BOTH upside and downside
- Limit to top 3–5 each
- Zero-delta rows are excluded
- Explicit net reconciliation (what offset what)

Then you MUST filter:
- current year rows using <= aligned.cutoff_date
- prior year rows using <= aligned.prior_year_cutoff_date

Average revenue per unit (ARPU):
- If ARPU is discussed, the explanation must explicitly reference
revenue ÷ units.
- If that relationship is not visible in the table, say “not observed.”

Hard bans:
- Do NOT use EXTRACT(DAYOFYEAR...) anywhere in the query.
- Do NOT use cutoff_day_of_year.
- Do NOT filter prior year using aligned.cutoff_date.

Also required:
- Include cutoff_date and prior_year_cutoff_date in the final output (use scalar subqueries or ANY_VALUE if grouped).

Output format:
Return JSON ONLY:
1) {"type":"clarify","question":"..."}
2) {"type":"pick_source","prompt":"...","candidates":[...]}
3) {"type":"final",
    "chosen_source":"...",
    "sql":"...",
    "short_answer":"(3-4 sentences, no headings)",
    "narrative":"(optional 1 short paragraph, NO bullets, NO headings)",
    "insights":["(3-4 bullets; each must cite at least one metric)"],
    "followups":["(1–3 bullets)"]
}
`.trim();

  const memory_text = memory
    ? [
        "Thread memory:",
        `- last_domain: ${memory.last_domain || "(none)"}`,
        `- last_question: ${memory.last_question || "(none)"}`,
        `- last_source: ${memory.last_source || "(none)"}`,
        `- last_sql: ${memory.last_sql || "(none)"}`,
      ].join("\n")
    : "Thread memory: (none)";

  const sources_hint = compact_sources_for_model(dyn_catalog).slice(0, 40);

  const forced_table_note = forced_table_fqn
    ? [
        "IMPORTANT (user-selected table lock):",
        `- The user selected this table: ${forced_table_fqn}`,
        "- You MUST use ONLY this table.",
        "- Do NOT suggest alternative tables.",
        "- Next steps: call get_schema() for it, then run_query().",
      ].join("\n")
    : "";

  const input = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        `User question: ${user_question}\n` +
        `Domain hint: ${domain}\n` +
        `${memory_text}\n\n` +
        (forced_table_note ? forced_table_note + "\n\n" : "") +
        `Notes:\n` +
        `- Allowed datasets (if any): ${allowed_datasets.length ? allowed_datasets.join(", ") : "(not set)"}\n` +
        `- Project id: ${project_id || "(missing)"}\n\n` +
        `Quick sources hint (partial):\n${JSON.stringify(sources_hint, null, 2)}\n\n` +
        `If you need better table selection, call suggest_sources(). If you need schema, call get_schema().`,
    },
  ];

  const MAX_STEPS = Number(process.env.AGENT_MAX_TOOL_STEPS || 8);

  let final_rows = [];
  let final_bytes = 0;

  let force_pick_source = false;
  let force_pick_reason = "";

  let insight_retry_used = false;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const resp_json = await call_openai_responses({ model, api_key, input, tools });
    const output_items = resp_json.output || [];

    const tool_calls = [];
    for (const item of output_items) {
      if (item.type === "function_call") tool_calls.push(item);
      if (item.type === "tool_call") tool_calls.push(item);
    }

    // No tool calls => expect JSON output
    if (!tool_calls.length) {
      const text = pick_output_text(resp_json);
      if (!text) throw new Error("No model output_text found.");

      const parsed = safe_json_parse(text);
      if (!parsed) {
        input.push({
          role: "user",
          content: "Your last response was not valid JSON. Return ONLY valid JSON matching the required schema.",
        });
        continue;
      }

      if (force_pick_source) {
        return make_pick_source_response({
          dyn_catalog,
          user_question: memory?.last_question || user_question,
          prompt:
            `I ran a query but the result looked empty/NULL/no-evidence (${force_pick_reason}). ` +
            `Pick the best table to use by replying with a number:`,
          max: 6,
        });
      }

      const normalized = normalize_model_payload(parsed);

      // ✅ Do NOT throw in prod; degrade gracefully
      const validated_sp = final_answer_schema.safeParse(normalized);
      if (!validated_sp.success) {
        console.error("ZodError:", validated_sp.error.issues);
        return {
          type: "clarify",
          model,
          question: "I had trouble interpreting the response shape. Which table should I use (or paste the dataset.table you want)?",
        };
      }

      const validated = validated_sp.data;

      // ✅ One-time retry gate for 5.1 when output is coverage/rollup-heavy
      if (
        validated.type === "final" &&
        !insight_retry_used &&
        needs_insight_retry({
          model,
          user_question,
          result_rows: final_rows,
          short_answer: validated.short_answer,
          insights: validated.insights,
          sql: validated.sql || last_sql,
        })
      ) {
        insight_retry_used = true;

        input.push({
          role: "user",
          content: get_insight_retry_addendum(),
        });

        // continue the loop so the model can re-answer (and optionally re-query)
        continue;
      }

      if (validated.type === "final") {
        validated.model = model;
        validated.rows = final_rows;
        validated.bytes_processed_estimate = final_bytes;
        validated.used_table_fqn = last_used_table_fqn || forced_table_fqn || undefined;
        validated.sql = validated.sql || last_sql || undefined;
      }

      return validated;
    }

    // Execute tool calls
    for (const call of tool_calls) {
      const name = call.name || call.function?.name;
      const args_raw = call.arguments || call.function?.arguments || "{}";
      const args = typeof args_raw === "string" ? safe_json_parse(args_raw) || {} : args_raw;

      let tool_result;

      try {
        if (name === "suggest_sources") {
          if (forced_table_fqn) {
            tool_result = {
              error: `Table is already user-selected (${forced_table_fqn}). Do not suggest sources; proceed to get_schema() then run_query().`,
            };
          } else {
            const q = String(args.question || user_question || "").trim();
            tool_result = await tool_suggest_sources({ dyn_catalog, question: q });
          }
        } else if (name === "list_sources") {
          tool_result = await tool_list_sources({ dyn_catalog });
        } else if (name === "get_schema") {
          let dataset_id = String(args.dataset_id || "").trim();
          let table_id = String(args.table_id || "").trim();

          // If forced_table is set, override model selection
          if (forced_table_fqn) {
            const parts = forced_table_fqn.split(".");
            if (parts.length === 3) {
              dataset_id = parts[1];
              table_id = parts[2];
            }
          }

          if (!project_id) throw new Error("Missing USAT_BQ_PROJECT_ID env var.");

          if (allowed_datasets.length && dataset_id && !allowed_datasets.includes(dataset_id)) {
            tool_result = { error: `Dataset "${dataset_id}" is not allowlisted.`, allowed_datasets };
          } else {
            tool_result = await tool_get_schema({ project_id, dataset_id, table_id });
          }
        } else if (name === "run_query") {
          const sql = String(args.sql || "").trim();

          const res = await tool_run_query({ sql, forced_table_fqn, dyn_catalog });

          final_rows = res.rows_for_slack || [];
          final_bytes = res.bytes_processed_estimate || 0;
          last_used_table_fqn = res.used_table_fqn || null;
          last_sql = res.sql || sql || null;

          const analysis_type_guess = is_membership_ytd_yoy_question(user_question) ? "trend_summary" : "trend_summary";

          const deterministic_summary = summarize_rows(final_rows, analysis_type_guess);

          const nullish_sample = looks_like_all_null_or_empty(res.sample_rows);
          const no_evidence = Boolean(deterministic_summary?.no_evidence?.no_evidence);

          if (nullish_sample) {
            force_pick_source = true;
            force_pick_reason = `source=${res.used_table_fqn || "unknown"} returned empty/NULL sample`;
          } else if (no_evidence) {
            force_pick_source = true;
            force_pick_reason = `no evidence: ${deterministic_summary.no_evidence.reason}`;
          }

          tool_result = {
            used_table_fqn: res.used_table_fqn,
            row_count: res.row_count,
            bytes_processed_estimate: res.bytes_processed_estimate,
            sample_rows: res.sample_rows,
            deterministic_summary,
            _note:
              "Use deterministic_summary to interpret results; do not invent missing metrics. " +
              "Slack will display bounded full rows.",
          };
        } else if (name === "get_usat_context") {
          tool_result = await tool_get_usat_context();
        } else {
          tool_result = { error: `Unknown tool: ${name}` };
        }
      } catch (err) {
        tool_result = { error: String(err?.message || err) };
      }

      // Feed tool result back to model
      input.push({ role: "assistant", content: "" });
      input.push({
        role: "user",
        content:
          `Tool result for ${name}:\n` +
          `${JSON.stringify(tool_result, null, 2)}\n\n` +
          `Continue. If the tool returned an error, fix it. ` +
          `If table selection is unclear or results are empty/no-evidence, call suggest_sources() and then return type="pick_source".`,
      });
    }
  }

  throw new Error(`Tool loop exceeded ${MAX_STEPS} steps. Try narrowing the question (metric + timeframe + breakdown).`);
}

module.exports = {
  chatgpt_like_answer,
};

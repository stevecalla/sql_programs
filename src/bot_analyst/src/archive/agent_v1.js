const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { z } = require("zod");
const { CATALOG } = require("./catalog");
const { get_table_schema, infer_date_expr, schema_to_text } = require("./schema");

// const agent_response_schema = z.object({
//   chosen_catalog_id: z.string(),
//   sql: z.string(),
//   short_answer: z.string(),
//   insights: z.array(z.string()).default([]),
//   followups: z.array(z.string()).default([]),
// }); 

const agent_response_schema = z.object({
  chosen_catalog_id: z.string(),
  sql: z.string(),
  analysis_type: z.enum([
    "driver_analysis",
    "trend_summary",
    "anomaly_detection",
    "segment_comparison",
    "definition_explainer",
    "table_overview",
  ]).default("trend_summary"),
  short_answer: z.string(),
  insights: z.array(z.string()).default([]),
  followups: z.array(z.string()).default([]),
});

// -----------------------------
// Simple in-process cache
// -----------------------------
let _catalog_text_cache = null;
let _catalog_text_cache_loaded_at = 0;

async function build_catalog_text(catalog_subset) {
  const parts = [];

  for (const t of catalog_subset) {
    const fqn = `\`${t.project}.${t.dataset}.${t.table}\``;

    // pull schema
    const schema_rows = await get_table_schema(t.project, t.dataset, t.table);

    // infer date expr if you provided a likely date field name
    let date_expr = t.date_expr || null;
    let date_notes = null;

    if (!date_expr && t.date_field) {
      const inferred = await infer_date_expr(t.project, t.dataset, t.table, t.date_field);
      date_expr = inferred?.date_expr || null;
      date_notes = inferred?.notes || null;
    }

    const schema_text = schema_to_text(schema_rows, 60);

    parts.push(
      [
        `- id: ${t.id}`,
        `  table: ${fqn}`,
        `  description: ${t.description}`,
        t.tags?.length ? `  tags: ${t.tags.join(", ")}` : null,
        `  examples: ${t.example_questions.join("; ")}`,
        `  pii_risk: ${t.pii_risk}`,
        t.date_field ? `  date_field: ${t.date_field}` : null,
        t.date_field_year ? `  preferred_year_field: ${t.date_field_year}` : null,
        t.date_field_date ? `  preferred_date_field: ${t.date_field_date}` : null,
        t.date_field_month ? `  preferred_month_field: ${t.date_field_month}` : null,
        date_expr ? `  date_expr: ${date_expr}` : null,
        date_notes ? `  date_infer_notes: ${date_notes}` : null,
        `  schema:`,
        schema_text.split("\n").map((l) => `    ${l}`).join("\n"),
      ].filter(Boolean).join("\n")
    );
  }

  return parts.join("\n\n");
}

async function get_catalog_text_cached(domain) {
  // Cache keyed by "domain" would be ideal; for POC we’ll just cache full catalog,
  // but we still filter subset before building text to reduce size.
  // Use shorter TTL if schemas change frequently.
  const max_age_ms = Number(process.env.AGENT_CATALOG_CACHE_MS || String(30 * 60 * 1000)); // 30 min default

  // If you want domain-specific caching, you can turn this into a Map.
  if (_catalog_text_cache && (Date.now() - _catalog_text_cache_loaded_at) < max_age_ms) {
    return _catalog_text_cache;
  }

  // Build catalog text from the full catalog (safe + stable) OR from filtered set.
  // I recommend full catalog for cache, and use domain bias inside system prompt.
  const catalog_text = await build_catalog_text(CATALOG);

  _catalog_text_cache = catalog_text;
  _catalog_text_cache_loaded_at = Date.now();

  return _catalog_text_cache;
}

// -----------------------------
// USAT context YAML cache
// -----------------------------
let _usat_ctx_cache = null;
let _usat_ctx_cache_loaded_at = 0;

function load_usat_context_yaml() {
  // Relative to agent.js
  const filePath = path.resolve(__dirname, "./config/usat_context.yaml");

  const raw = fs.readFileSync(filePath, "utf8");

  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("usat_context.yaml must contain a YAML object");
  }

  // Normalize formatting so the model always sees the same structure
  return yaml.dump(parsed, { lineWidth: 120 });
}

function get_usat_context_cached() {
  const max_age_ms = 30 * 60 * 1000; // 30 minutes

  if (_usat_ctx_cache && (Date.now() - _usat_ctx_cache_loaded_at) < max_age_ms) {
    return _usat_ctx_cache;
  }

  _usat_ctx_cache = load_usat_context_yaml();
  _usat_ctx_cache_loaded_at = Date.now();
  return _usat_ctx_cache;
}

/**
 * plan_query_with_ai(user_question, { thread_ts, memory, domain })
 */
async function plan_query_with_ai(user_question, opts = {}) {
  const model = process.env.OPENAI_MODEL;
  const api_key = process.env.OPENAI_API_KEY;

  if (!model) throw new Error("OPENAI_MODEL is required in .env");
  if (!api_key) throw new Error("OPENAI_API_KEY is required in .env");

  const domain = opts.domain || "unknown";
  const memory = opts.memory || null;

  // For now, use cached full-catalog text (includes schema + tags)
  const catalog_text = await get_catalog_text_cached(domain);
  const usat_context_yaml = get_usat_context_cached();

  const memory_text = memory
    ? [
      "Thread context:",
      `- last_domain: ${memory.last_domain || "(none)"}`,
      `- last_catalog_id: ${memory.last_catalog_id || "(none)"}`,
      `- last_question: ${memory.last_question || "(none)"}`,
      `- last_sql: ${memory.last_sql || "(none)"}`,
      `- last_error: ${memory.last_error || "(none)"}`,
    ].join("\n")
    : "Thread context: (none)";

  const system = `
You are a careful business analyst agent for USA Triathlon analytics.

Canonical USAT business context (MUST FOLLOW):
- The following YAML contains the authoritative definitions and business rules.
- You MUST use these definitions exactly and may not redefine these terms.
- If the user asks for something that conflicts with these definitions, ask a clarifying question.
- If a relevant term is NOT present in this YAML, say so and ask for clarification.

USAT_CONTEXT_YAML:
---
${usat_context_yaml}
---
You must set analysis_type based on the user's question:
- "drivers", "why", "what caused" => driver_analysis
- "trend", "pattern", "over time" => trend_summary
- "spike", "drop", "weird", "outlier" => anomaly_detection
- "compare X vs Y" => segment_comparison
- "what is / define" => definition_explainer
- otherwise => table_overview

Seek Context:
- If required context is missing or ambiguous, you must stop and ask for clarification.
- Never infer USAT definitions, timeframes, or business intent.
- Confirm whether the question is: YTD, Full year, Rolling period. If not stated, ask.
- If a term exists in the USAT definitions file, you must use that definition.
- If a term does not exist, say so.

Validation:
- Before answering, verify that all business terms used appear in USAT_CONTEXT_YAML or are explicitly defined by the user.

SQL constraint (mandatory):
- Output must be ONE BigQuery Standard SQL SELECT statement.
- Do NOT use DECLARE, SET, BEGIN/END, CREATE TEMP, or scripting.
- If you need parameters (like cutoff_date), you MUST use a WITH params AS (...) CTE and CROSS JOIN it.
- Do not reference params.* in HAVING clauses; apply params-based filters in WHERE (or compute fields in params and filter in WHERE).
- When using params CTE, always CROSS JOIN params as alias p and apply all p.* filters in WHERE, not HAVING.

You must:
- Produce a SINGLE BigQuery Standard SQL query.
- Choose ONE catalog entry id that best answers the question.
- Use ONLY columns listed in the schema for the chosen table.
- If a catalog entry includes date_expr, use it for all date filters and EXTRACT operations. Do not use the raw date_field directly.
- Do not output the literal token date_expr; inline its expression.
- Default to AGGREGATED outputs. Do not return PII or profile-level rows unless explicitly requested.
- Do not invent column names. Use only the provided schema columns.
- Use the ongoing thread context to interpret follow-ups ("this", "that", "same breakdown", etc).

Routing rules:
- If a user asks about membership sales use the membership_data catalog. The default entity for “memberships sold”, “sales counts” is sales_units, and for “revenue” is sales_revenue. Do not use id_profiles or member_number_members_sa unless the user explicitly asks.
- If a user askes about active members, default to membership_base_data for aggregate level data and membership_detail_data for detailed data.
- If user asks about membership sales goals/targets/attainment, default to the choose a table whose tags include "goal".
- If user asks about participation (participants, participations, finishers, event participation), choose a table whose tags include "participation" (not membership tables).
- If user asks about events (event counts, event metrics, sanctioning, event YoY), choose a table whose tags include "events".
- If user asks about revenue recognition (recognized/deferred revenue), choose a table whose tags include "rev_recognition".

Insight Rules:
- If asked “why” something changed, provide at least two plausible explanations and state confidence.

Date-part preference rule:
- If the chosen table has precomputed date-part fields (e.g., *_year_*, *_month_*, *_date_*), you MUST use them instead of computing EXTRACT(...) from timestamps.
- Only compute year/month/day from timestamps if no precomputed field exists in the schema.

Timeframe policy (mandatory, non-negotiable):
If the question is YTD and compares "this year" vs "last year" (YoY),
you MUST implement the timeframe exactly like this:

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

Then you MUST filter:
- current year rows using <= aligned.cutoff_date
- prior year rows using <= aligned.prior_year_cutoff_date

Hard bans:
- Do NOT use EXTRACT(DAYOFYEAR...) anywhere in the query.
- Do NOT use cutoff_day_of_year.
- Do NOT filter prior year using aligned.cutoff_date.

Also required:
- Include aligned.cutoff_date and aligned.prior_year_cutoff_date as output fields in the final SELECT (so the timeframe is visible).

Type safety rules (mandatory):
- Do not CAST/SAFE_CAST/FORMAT/parse any non-date fields.
- Treat STRING fields as categorical labels only (group/filter), never numeric.
- The only allowed conversions are safe date parsing of timestamp/date strings (SAFE_CAST to TIMESTAMP/DATE) used for filtering or truncation.
- Never cast STRING to FLOAT/INT for revenue/units. If a numeric metric is needed, use a numeric column; if unavailable, return sales_revenue as NULL and still return units.
- If you are unsure of a field type, do not cast it—ask to confirm the numeric field name.

Do not select aligned.cutoff_date or aligned.prior_year_cutoff_date in a grouped SELECT.
Instead, include them via scalar subqueries: (SELECT cutoff_date FROM aligned) and (SELECT prior_year_cutoff_date FROM aligned) or wrap them with ANY_VALUE().

Return JSON only matching the schema.
  `.trim();

  const user = `
User question: ${user_question}
Inferred domain hint: ${domain}

${memory_text}

Catalog (allowlisted):
${catalog_text}

Return JSON schema:
{
  "chosen_catalog_id": "string (must match an id from catalog)",
  "sql": "string (BigQuery SQL)",
  "short_answer": "string",
  "insights": ["string", "..."],
  "followups": ["string", "..."]
}
  `.trim();

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Optional but helpful: keep responses concise
      // max_output_tokens: 800,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI error: ${resp.status} ${txt}`);
  }

  const data = await resp.json();

  console.log("openai_usage:", data.usage || data.output?.[0]?.usage);

  const out = data.output?.find((o) => o.type === "message");
  const content = out?.content?.find((c) => c.type === "output_text")?.text;
  if (!content) throw new Error("No model output_text found.");

  const parsed = JSON.parse(content);
  const validated = agent_response_schema.parse(parsed);

  if (!CATALOG.some((t) => t.id === validated.chosen_catalog_id)) {
    throw new Error(`Model chose unknown catalog id: ${validated.chosen_catalog_id}`);
  }

  return validated;
}

async function analyze_results_with_ai({
  user_question,
  analysis_type,
  rows,
  notes = {},
}) {
  const model = process.env.OPENAI_MODEL;
  const api_key = process.env.OPENAI_API_KEY;

  const system = `
You are a senior revenue analyst. You will be given:
- the user question
- analysis_type
- result rows from a BigQuery query (already executed)

You MUST produce insights and conclusions, not a data dump.

Global rules:
- Always start with a one-sentence bottom line.
- Always quantify: total change, top contributors, and whether change is volume vs price/mix.
- Never describe columns.

If analysis_type = driver_analysis:
- Compute total revenue change (sum revenue_change if present; else revenue_this_year - revenue_last_year aggregated).
- Rank top 3 positive and negative contributors by absolute $ impact.
- For each top contributor classify:
  - volume-driven: revenue up & units up
  - price/mix-driven: revenue up & units down
  - demand decline: revenue down & units down
  - negative price/mix: revenue down & units up
- Provide:
  1) Executive paragraph
  2) Three bullets (drivers)
  3) One clear conclusion: "pricing/mix-led" vs "volume-led"
`.trim();

  const user = `
User question: ${user_question}
analysis_type: ${analysis_type}

Result rows (JSON):
${JSON.stringify(rows).slice(0, 120000)}  // keep under token limits

Optional notes:
${JSON.stringify(notes)}
`.trim();

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // max_output_tokens: 700,
    }),
  });

  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();

  const out = data.output?.find((o) => o.type === "message");
  const content = out?.content?.find((c) => c.type === "output_text")?.text;
  return content;
}

module.exports = { plan_query_with_ai };

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { z } = require("zod");
const { CATALOG } = require("./catalog");
const { get_table_schema, infer_date_expr, schema_to_text } = require("./schema");

// --------------------------------------------
// Response schema (planner output)
// --------------------------------------------
const agent_response_schema = z.object({
  chosen_catalog_id: z.string(),
  sql: z.string(),
  analysis_type: z
    .enum([
      "driver_analysis",
      "trend_summary",
      "anomaly_detection",
      "segment_comparison",
      "definition_explainer",
      "table_overview",
    ])
    .default("trend_summary"),
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
      const inferred = await infer_date_expr(
        t.project,
        t.dataset,
        t.table,
        t.date_field
      );
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
        schema_text
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return parts.join("\n\n");
}

async function get_catalog_text_cached(domain) {
  const max_age_ms = Number(
    process.env.AGENT_CATALOG_CACHE_MS || String(30 * 60 * 1000)
  );

  if (
    _catalog_text_cache &&
    Date.now() - _catalog_text_cache_loaded_at < max_age_ms
  ) {
    return _catalog_text_cache;
  }

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
// helpers
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

/**
 * Detect "no evidence" situations for 1-row summary results
 */
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
    reason: anyNumericFound
      ? "some numeric metrics non-zero"
      : "no numeric metrics found",
    checked,
  };
}

/**
 * Try to find a numeric metric column that looks like revenue diff
 */
function infer_diff_key(rows) {
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0] || {});
  const candidates = [
    "revenue_diff",
    "revenue_change",
    "sales_revenue_diff",
    "diff",
    "delta",
    "net_change",
    "absolute_change_revenue",
    "revenue_diff_abs",
    "abs_sales_revenue_change",
    "sales_revenue_abs_change",
    "revenue_diff_abs", // duplicate-safe
  ];
  for (const c of candidates) {
    if (cols.includes(c)) return c;
  }
  const fuzzy = cols.find(
    (c) => c.toLowerCase().includes("diff") && c.toLowerCase().includes("rev")
  );
  return fuzzy || null;
}

/**
 * ✅ IMPORTANT: broaden detection to match BOTH your older and newer output column names.
 */
function infer_driver_fields(rows) {
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0] || {});
  const pick = (cands) => cands.find((c) => cols.includes(c)) || null;

  // Revenue
  const revenue_current = pick([
    // ✅ driver table naming (your output)
    "current_sales_revenue",
    // existing
    "revenue_current",
    "sales_revenue_current",
    "sales_revenue_current_year",
    "sales_revenue_this_year",
    "sales_revenue_ytd_this_year",
    "sales_revenue",
  ]);

  const revenue_prior = pick([
    // ✅ driver table naming (your output)
    "prior_sales_revenue",
    // existing
    "revenue_prior",
    "sales_revenue_prior",
    "sales_revenue_prior_year",
    "sales_revenue_last_year",
    "sales_revenue_ytd_last_year",
  ]);

  // Units
  const units_current = pick([
    // ✅ driver table naming (your output)
    "current_sales_units",
    // existing
    "units_current",
    "sales_units_current",
    "sales_units_current_year",
    "sales_units_this_year",
    "sales_units_ytd_this_year",
    "sales_units",
  ]);

  const units_prior = pick([
    // ✅ driver table naming (your output)
    "prior_sales_units",
    // existing
    "units_prior",
    "sales_units_prior",
    "sales_units_prior_year",
    "sales_units_last_year",
    "sales_units_ytd_last_year",
  ]);

  // Diffs (optional)
  const revenue_diff = pick([
    "revenue_diff_abs",
    "absolute_change_revenue",
    "revenue_diff",
    "revenue_change",
    "delta_revenue",
    "abs_sales_revenue_change",
    "sales_revenue_abs_change",
    // (optional) if you ever output this name
    "current_minus_prior_sales_revenue",
  ]);

  const units_diff = pick([
    "units_diff_abs",
    "units_change",
    "delta_units",
    "abs_sales_units_change",
    "sales_units_abs_change",
    // (optional) if you ever output this name
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

/**
 * ✅ NEW: dollar decomposition of revenue change into:
 * - Volume impact: (Δunits) * ARPU_prior
 * - ARPU impact: (ΔARPU) * units_prior
 * - Interaction: (Δunits) * (ΔARPU)
 *
 * Sum equals (approximately) Δrevenue.
 */
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

  const du = uc - up;                         // Δunits
  const darpu = arpu_current - arpu_prior;    // ΔARPU

  // bridge components
  const volume_impact = du * arpu_prior;
  const arpu_impact = up * darpu;
  const interaction_impact = du * darpu;

  // optional sanity check
  const revenue_diff_calc = rc - rp;
  const bridge_total = volume_impact + arpu_impact + interaction_impact;

  return {
    volume_impact,
    arpu_impact,
    interaction_impact,
    // keep these if you want debugging / reconciliation
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

  // ✅ ADD THIS: attach per-row $ bridge
  const bridge = compute_revenue_bridge(row, fields);

  return {
    arpu_current,
    arpu_prior,
    arpu_diff,
    arpu_diff_pct,
    units_diff_abs,
    units_diff_pct,
    value_per_unit_direction:
      arpu_diff > 0 ? "up" : arpu_diff < 0 ? "down" : "flat",
    volume_direction:
      units_diff_abs > 0 ? "up" : units_diff_abs < 0 ? "down" : "flat",

    // ✅ NEW FIELD: dollar attribution for this row/segment
    bridge,
  };
}

function summarize_rows(rows, analysis_type) {
  const summary = {
    row_count: rows?.length || 0,
    total_diff: null,
    diff_key: null,
    top_pos: [],
    top_neg: [],
    gross_pos: null,
    gross_neg: null,
    arpu_signals: null,
    revenue_bridge: null, // ✅ NEW
  };

  if (!rows?.length) return summary;

  const diff_key = infer_diff_key(rows);
  summary.diff_key = diff_key;

  const fields = infer_driver_fields(rows);

  // total_diff when a diff key exists
  if (diff_key) {
    const diffs = rows
      .map((r) => safe_num(r[diff_key]))
      .filter((d) => d !== null);

    if (diffs.length) {
      let total = 0;
      let gross_pos = 0;
      let gross_neg = 0;

      for (const d of diffs) {
        total += d;
        if (d > 0) gross_pos += d;
        if (d < 0) gross_neg += d;
      }

      summary.total_diff = total;
      summary.gross_pos = gross_pos;
      summary.gross_neg = gross_neg;
    }
  }

  const is_driverish =
    analysis_type === "driver_analysis" || analysis_type === "segment_comparison";

  // Driver ranking (only for driver-ish outputs)
  if (is_driverish) {
    if (diff_key) {
      const diffs = rows
        .map((r) => ({ r, d: safe_num(r[diff_key]) }))
        .filter((x) => x.d !== null);

      if (diffs.length) {
        const sorted = [...diffs].sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
        summary.top_pos = sorted.filter((x) => x.d > 0).slice(0, 3).map((x) => x.r);
        summary.top_neg = sorted.filter((x) => x.d < 0).slice(0, 3).map((x) => x.r);
        summary._top_for_llm = sorted.slice(0, 10).map((x) => x.r);
      }
    }

    // ARPU + bridge samples for top driver rows
    if (fields?.revenue_current && fields?.revenue_prior && fields?.units_current && fields?.units_prior) {
      const src = summary._top_for_llm?.length ? summary._top_for_llm : rows.slice(0, 10);

      const sample = src
        .map((r) => {
          const arpu = compute_arpu_signal(r, fields);
          const bridge = compute_revenue_bridge(r, fields);
          if (!arpu && !bridge) return null;
          return { row: r, arpu, bridge };
        })
        .filter(Boolean)
        .slice(0, 8);

      summary.arpu_signals = { fields, sample: sample.map((x) => ({ row: x.row, signal: x.arpu })).filter(x => x.signal) };
      summary.revenue_bridge = { fields, sample: sample.map((x) => ({ row: x.row, bridge: x.bridge })).filter(x => x.bridge) };
    }
  }

  // Non-driver YoY “status/variance”: compute ARPU + bridge off first row if possible
  if (!is_driverish) {
    const r0 = rows[0] || null;
    if (r0 && fields?.revenue_current && fields?.revenue_prior && fields?.units_current && fields?.units_prior) {
      const arpu = compute_arpu_signal(r0, fields);
      const bridge = compute_revenue_bridge(r0, fields);

      if (arpu) {
        summary.arpu_signals = { fields, sample: [{ row: r0, signal: arpu }] };
      }
      if (bridge) {
        summary.revenue_bridge = { fields, sample: [{ row: r0, bridge }] };
      }
    }
  }

  return summary;
}

// --------------------------------------------
// Planner (table selection + SQL)
// --------------------------------------------
async function plan_query_with_ai(user_question, opts = {}) {
  const model = process.env.OPENAI_MODEL;
  const api_key = process.env.OPENAI_API_KEY;

  if (!model) throw new Error("OPENAI_MODEL is required in .env");
  if (!api_key) throw new Error("OPENAI_API_KEY is required in .env");

  const domain = opts.domain || "unknown";
  const memory = opts.memory || null;

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
- Assume sales_revenue and sales_units are numeric if present in schema; never CAST them

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
- If a user asks about active members, default to membership_base_data for aggregate level data and membership_detail_data for detailed data.
- If user asks about membership sales goals/targets/attainment, default to choose a table whose tags include "goal".
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
  "analysis_type": "driver_analysis|trend_summary|anomaly_detection|segment_comparison|definition_explainer|table_overview",
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
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI error: ${resp.status} ${txt}`);
  }

  const data = await resp.json();

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

// --------------------------------------------
// Senior analyst narrative layer (YoY variance-aware templates)
// --------------------------------------------
async function analyze_results_with_ai({
  user_question,
  analysis_type,
  rows,
  plan_summary,
  notes = {},
}) {
  const model = process.env.OPENAI_MODEL;
  const api_key = process.env.OPENAI_API_KEY;
  if (!model) throw new Error("OPENAI_MODEL is required in .env");
  if (!api_key) throw new Error("OPENAI_API_KEY is required in .env");

  const MAX_ROWS_FOR_LLM = Number(process.env.AGENT_MAX_ROWS_FOR_ANALYSIS || 80);
  const sliced_rows = Array.isArray(rows) ? rows.slice(0, MAX_ROWS_FOR_LLM) : [];

  const system = `
You are a senior analytics lead writing a concise business readout.

Grounding rules (MANDATORY):
- Every bullet MUST be grounded in the provided metrics/rows (use exact column names/values when possible).
- If a relevant metric is 0 or null, you MUST say "not observed" and MUST NOT imply presence.
- If notes.zero_guard.no_evidence is true, produce a strict "no evidence in cohort" readout and avoid speculation.

Output rules (MANDATORY):
- Do NOT dump data. Do NOT describe columns.
- Provide business interpretation that a VP would accept.
- No recommendations unless explicitly asked "what should we do".

Format rules:
- If analysis_type is driver_analysis, use TEMPLATE A.
- Otherwise use TEMPLATE B (YoY status/variance-aware).

TEMPLATE A (driver_analysis ONLY):
Executive take:
- <2 to 4 bullets>

What changed:
- <1 to 3 bullets; quantify if possible; include total_diff if provided>

Primary drivers:
- <Up to 3 bullets for positive drivers (if applicable)>
- <Up to 3 bullets for negative drivers (if applicable)>

Volume vs value-per-unit bridge (DOLLAR IMPACT):
- If plan_summary.revenue_bridge is present, cite:
  - volume_impact ($), arpu_impact ($), interaction_impact ($)
  - Explain in dollars how much of revenue change is explained by volume vs ARPU.
- If not present, say "Not available in returned dimensions".

Themes:
- <1 to 3 bullets; descriptive>

Confidence & caveats:
- <1 to 3 bullets>

TEMPLATE B (NON-driver):
Executive take:
- <2 to 4 bullets>

Key highlights:
- <Up to 4 quantified bullets grounded in rows>

What explains it (grounded):
- If BOTH units and revenue are present for current and prior:
  - Use plan_summary.arpu_signals to state whether ARPU increased/decreased and volume increased/decreased.
  - Use plan_summary.revenue_bridge (if present) to quantify $ impact from volume vs ARPU (and interaction).
- DO NOT claim product mix or pricing unless there is segment-level evidence in rows.

Confidence & caveats:
- <1 to 3 bullets>

Tone: crisp, executive, neutral.
  `.trim();

  const first_row = Array.isArray(rows) && rows.length ? rows[0] : null;

  const user = `
User question: ${user_question}
analysis_type: ${analysis_type}

Deterministic summary:
${JSON.stringify(plan_summary || {}, null, 2)}

Result summary row (first row):
${JSON.stringify(first_row, null, 2)}

Sample rows (JSON, truncated):
${JSON.stringify(sliced_rows, null, 2)}

Optional notes:
${JSON.stringify(notes || {}, null, 2)}
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
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI error (analysis): ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  const out = data.output?.find((o) => o.type === "message");
  const content = out?.content?.find((c) => c.type === "output_text")?.text;
  if (!content) throw new Error("No model output_text found (analysis).");

  return String(content).trim();
}

module.exports = {
  plan_query_with_ai,
  analyze_results_with_ai,
  summarize_rows,
  detect_no_evidence,
};

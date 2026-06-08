/**
 * index.js
 * Slack Socket Mode bot entrypoint
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { App } = require("@slack/bolt");

const {
  plan_query_with_ai,
  analyze_results_with_ai,
  summarize_rows,
  detect_no_evidence, // ✅ NEW
} = require("./agent");

const { assert_safe_select } = require("./sql_guard");
const { run_bigquery } = require("./bigquery");
const { to_slack_table } = require("./slack_format");
const { CATALOG } = require("./catalog");
const {
  build_dynamic_catalog,
  format_sources_text,
  get_schema_for_table,
} = require("./sources");

console.log("🔧 starting USAT AI Analyst bot...");

// ✅ required cache vars
let _dynamic_catalog = null;
let _dynamic_catalog_loaded_at = null;

// Make the agent “context aware”
const thread_memory = new Map();

const app = new App({
  token: process.env.SLACK_BOT_AI_ANALYST_TOKEN,
  appToken: process.env.SLACK_APP_AI_ANALYST_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET_AI_ANALYST,
  socketMode: true,
  logLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
});

app.error((err) => console.error("❌ bolt_error:", err));

async function get_dynamic_catalog_cached() {
  const max_age_ms = 6 * 60 * 60 * 1000; // 6 hours

  if (
    _dynamic_catalog &&
    _dynamic_catalog_loaded_at &&
    Date.now() - _dynamic_catalog_loaded_at < max_age_ms
  ) {
    return _dynamic_catalog;
  }

  console.log("🔄 refreshing dynamic catalog from bigquery...");
  _dynamic_catalog = await build_dynamic_catalog({ include_schema: false });
  _dynamic_catalog_loaded_at = Date.now();

  console.log("✅ dynamic catalog loaded:", { count: _dynamic_catalog.length });
  return _dynamic_catalog;
}

/**
 * Tiny router so obvious intents don’t depend on model luck.
 */
function route_question_to_domain(user_text) {
  const s = String(user_text || "").toLowerCase();
  const has = (arr) => arr.some((k) => s.includes(k));

  const participation = ["participation", "participants", "participations", "races", "race", "finishers"];
  const events = ["event", "events", "sanction", "sanctioning"];
  const rev = ["rev rec", "revenue recognition", "recognized", "deferred", "allocation"];
  const goals = ["goal", "target", "attainment", "variance", "vs goal"];
  const sales = ["membership", "memberships sold", "sales", "revenue"];

  if (has(participation)) return "participation";
  if (has(rev)) return "rev_recognition";
  if (has(goals)) return "goals";
  if (has(events)) return "events";
  if (has(sales)) return "membership";

  return "unknown";
}

function normalize_sql(sql, plan) {
  let out = String(sql || "");

  const entry = CATALOG.find((t) => t.id === plan?.chosen_catalog_id);
  const date_field = entry?.date_field;
  const date_expr = entry?.date_expr;

  if (date_expr) {
    out = out.replace(/\bdate_expr\b/g, `(${date_expr})`);
  }

  if (date_field && date_expr) {
    out = out.replace(
      new RegExp(`EXTRACT\\((YEAR|MONTH|DAY)\\s+FROM\\s+${date_field}\\)`, "gi"),
      `EXTRACT($1 FROM (${date_expr}))`
    );

    out = out.replace(
      new RegExp(`DATE\\(\\s*${date_field}\\s*\\)`, "gi"),
      `(${date_expr})`
    );
  }

  return out;
}

function is_type_coercion_guard_error(err) {
  const msg = String(err?.message || "");
  return (
    msg.includes("Type coercion is not allowed") ||
    msg.includes("CAST/SAFE_CAST") ||
    msg.includes("Only DATE/TIMESTAMP/DATETIME casts are permitted")
  );
}

function is_groupby_select_mismatch_bq_error(err) {
  const msg = String(err?.message || "");
  return (
    msg.includes("which is neither grouped nor aggregated") ||
    msg.includes("SELECT list expression references column")
  );
}

function extract_bq_mismatch_column(err) {
  const msg = String(err?.message || "");
  const m = msg.match(/references column\s+([a-zA-Z0-9_\.]+)\s+which is neither grouped/i);
  return m?.[1] || null;
}

app.event("app_mention", async ({ event, say }) => {
  const thread_ts = event.thread_ts || event.ts;

  try {
    if (event.bot_id) return;

    const text = String(event.text || "").replace(/<@[^>]+>/g, "").trim();
    const lower = text.toLowerCase();

    console.log("📩 app_mention received:", {
      user: event.user,
      channel: event.channel,
      text,
      thread_ts,
    });

    if (!text) {
      await say({
        text: "Ask me a membership analytics question (e.g., `memberships sold this month by type`).",
        thread_ts,
      });
      return;
    }

    // ✅ quick handlers FIRST
    if (
      lower.includes("data sources") ||
      lower.includes("what data sources") ||
      lower.includes("what sources") ||
      lower.includes("data sources available") ||
      lower.includes("what tables") ||
      lower === "sources"
    ) {
      const dyn_catalog = await get_dynamic_catalog_cached();
      const msg =
        "*Available data sources (allowlisted)*\n" +
        format_sources_text(dyn_catalog) +
        "\n\n_Try: `what fields are in membership_reporting.membership_data`_";

      await say({ text: msg, thread_ts });
      return;
    }

    if (lower.includes("what fields are in")) {
      const target_raw = lower.split("what fields are in")[1] || "";
      const target = target_raw
        .trim()
        .replace(/[`"'?]/g, "")
        .replace(/\s+/g, "");

      const [dataset_id, table_id] = target.split(".").map((s) => s.trim());

      if (!dataset_id || !table_id) {
        await say({ text: "Usage: `what fields are in <dataset>.<table>`", thread_ts });
        return;
      }

      const project_id = String(process.env.USAT_BQ_PROJECT_ID || "").trim();

      const allowed = String(process.env.USAT_BQ_ALLOWED_DATASETS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (allowed.length && !allowed.includes(dataset_id)) {
        await say({ text: `Dataset \`${dataset_id}\` is not allowlisted.`, thread_ts });
        return;
      }

      const cols = await get_schema_for_table(project_id, dataset_id, table_id);

      if (!cols.length) {
        await say({
          text: `No schema found for \`${dataset_id}.${table_id}\` (check spelling / region).`,
          thread_ts,
        });
        return;
      }

      const lines = cols.slice(0, 60).map((c) => `• \`${c.column_name}\` (${c.data_type})`);
      const more = cols.length > 60 ? `\n… plus ${cols.length - 60} more` : "";

      await say({
        text: `*Schema for* \`${dataset_id}.${table_id}\`:\n${lines.join("\n")}${more}`,
        thread_ts,
      });
      return;
    }

    // ✅ only now post “Working on it…”
    await say({ text: "🔎 Working on it…", thread_ts });

    // 1) PLAN (domain + memory)
    let memory = thread_memory.get(thread_ts) || null;
    const domain = route_question_to_domain(text);
    console.log("🧭 domain:", domain);

    console.log("🧠 planning query...");

    let plan = null;
    let normalized_sql = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      plan = await plan_query_with_ai(text, { thread_ts, memory, domain });

      console.log(`🧠 plan result (attempt ${attempt}):`, {
        chosen_catalog_id: plan.chosen_catalog_id,
        analysis_type: plan.analysis_type,
        sql: plan.sql,
      });

      // 2) GUARD + NORMALIZE
      console.log("🛡 running sql guard...");
      normalized_sql = normalize_sql(plan.sql, plan);
      console.log("🧽 normalized sql:", normalized_sql);

      try {
        assert_safe_select(normalized_sql);
        break;
      } catch (e) {
        if (!is_type_coercion_guard_error(e) || attempt === 2) throw e;

        console.warn("⚠️ guard rejected SQL due to type coercion; retrying plan once...");

        memory = {
          ...(memory || {}),
          last_sql: normalized_sql,
          last_question: text,
          last_catalog_id: plan.chosen_catalog_id,
          last_domain: domain,
          last_error: String(e?.message || e),
        };
      }
    }

    // 3) BIGQUERY (with one self-healing retry for GROUP BY mismatch)
    let rows = [];
    let bytes_processed_estimate = 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`📊 running bigquery (attempt ${attempt})...`);
        const res = await run_bigquery(normalized_sql);
        rows = res.rows || [];
        bytes_processed_estimate = res.bytes_processed_estimate || 0;

        console.log("📊 bigquery result:", {
          row_count: rows.length,
          bytes_processed_estimate,
        });

        break; // ✅ success
      } catch (err) {
        if (!is_groupby_select_mismatch_bq_error(err) || attempt === 2) {
          throw err;
        }

        const bad_col = extract_bq_mismatch_column(err);
        console.warn("⚠️ BigQuery GROUP BY mismatch; retrying plan once...", {
          bad_col,
          err: String(err?.message || err),
        });

        memory = {
          ...(memory || {}),
          last_sql: normalized_sql,
          last_question: text,
          last_catalog_id: plan?.chosen_catalog_id,
          last_domain: domain,
          last_error:
            `BigQuery error: SELECT/GROUP BY mismatch. ` +
            `Do not select raw ${bad_col || "non-grouped"} fields in grouped queries. ` +
            `Either add it to GROUP BY OR wrap with ANY_VALUE()/MIN()/MAX() OR remove it.`,
        };

        // Re-plan once and rerun guard/normalize
        plan = await plan_query_with_ai(text, { thread_ts, memory, domain });

        console.log(`🧠 replan result (attempt ${attempt}):`, {
          chosen_catalog_id: plan.chosen_catalog_id,
          analysis_type: plan.analysis_type,
          sql: plan.sql,
        });

        console.log("🛡 running sql guard (replan)...");
        normalized_sql = normalize_sql(plan.sql, plan);
        console.log("🧽 normalized sql (replan):", normalized_sql);

        assert_safe_select(normalized_sql);
      }
    }

    // 4) NEW: Senior analyst narrative layer (+ no-evidence gating)
    const plan_summary = summarize_rows(rows, plan.analysis_type);

    // ✅ NEW: detect "no evidence" to prevent hallucinated narratives/insights
    const zero_guard = detect_no_evidence(rows);

    let narrative = null;

    if (zero_guard.no_evidence) {
      // ✅ Do NOT call the LLM narrative layer. Produce a strict readout.
      narrative =
`Executive take:
- No evidence in the returned result set for the requested pattern (${zero_guard.reason}).
- Interpreting this strictly: the query’s cohort/filters produced zero counts for the pathway being tested.

What changed:
- Not observed (all key metrics are 0).

Primary drivers:
- Not applicable (no conversions observed).

Themes:
- Not observed in this cohort.

Confidence & caveats:
- This conclusion is limited to the SQL cohort/filters used; if unexpected, validate membership_type labels and the “active” definition.`;
    } else {
      try {
        narrative = await analyze_results_with_ai({
          user_question: text,
          analysis_type: plan.analysis_type,
          rows,
          plan_summary,
          notes: {
            chosen_catalog_id: plan.chosen_catalog_id,
            est_bytes: bytes_processed_estimate,
            zero_guard,
          },
        });
      } catch (e) {
        console.warn("⚠️ narrative generation failed; continuing without narrative:", e?.message || e);
        narrative = null;
      }
    }

    // 5) RESPOND
    const table = to_slack_table(rows, 12);

    // ✅ NEW: suppress generic planner insights if no evidence
    const insights = zero_guard.no_evidence
      ? "• _(suppressed: no evidence in result set — prevents generic insights)_"
      : (plan.insights || []).slice(0, 5).map((x) => `• ${x}`).join("\n");

    // Optional: diagnostic followups when no evidence
    const followups = zero_guard.no_evidence
      ? [
          "• Validate membership_type labels used for one-day vs adult annual",
          "• Confirm the definition of “active” (end date vs status flag)",
          "• If you want historic conversions, broaden cohort to include inactive members",
        ].join("\n")
      : (plan.followups || []).slice(0, 4).map((x) => `• ${x}`).join("\n");

    const narrative_block = narrative
      ? `*Senior analyst take*\n${narrative}\n\n`
      : "";

    const msg =
      `${narrative_block}` +
      `*Answer (draft):* ${plan.short_answer}\n\n` +
      `*Rows:* ${rows.length.toLocaleString()}  |  *Est. bytes processed:* ${Number(bytes_processed_estimate || 0).toLocaleString()}\n\n` +
      `${table}\n\n` +
      `*Insights*\n${insights || "• _(none)_"}\n\n` +
      `*Suggested follow-ups*\n${followups || "• _(none)_"}\n`;

    await say({ text: msg, thread_ts });

    // ✅ save memory
    thread_memory.set(thread_ts, {
      last_domain: domain,
      last_catalog_id: plan.chosen_catalog_id,
      last_sql: normalized_sql,
      last_question: text,
    });

    console.log("✅ response sent");
  } catch (err) {
    console.error("❌ app_mention_error:", err);
    await say({
      text: `❌ ${err?.message || String(err)}\n\nTip: try being more specific (metric + timeframe + breakdown).`,
      thread_ts,
    });
  }
});

(async () => {
  await app.start();
  console.log("⚡️ USAT Analyst Bot running (Socket Mode)");
})();

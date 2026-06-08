/**
 * index.js
 * Slack Socket Mode bot entrypoint
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { App } = require("@slack/bolt");

const { plan_query_with_ai } = require("./agent");
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
const thread_memory = new Map(); // key: thread_ts, value: { last_domain, last_catalog_id, last_sql, last_question }

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
 * This just improves table choice. Model still writes SQL.
 */
function route_question_to_domain(user_text) {
  const s = String(user_text || "").toLowerCase();

  const has = (arr) => arr.some((k) => s.includes(k));

  const participation = ["participation", "participants", "participations", "races", "race", "finishers"];
  const events = ["event", "events", "sanction", "sanctioning"];
  const rev = ["rev rec", "revenue recognition", "recognized", "deferred", "allocation"];
  const goals = ["goal", "target", "attainment", "variance", "vs goal"];
  const sales = ["membership", "memberships sold", "sales", "revenue"]; // “revenue” is ambiguous but OK for POC

  if (has(participation)) return "participation";
  if (has(rev)) return "rev_recognition";
  if (has(goals)) return "goals";
  if (has(events)) return "events";
  if (has(sales)) return "membership";

  return "unknown";
}

function normalize_sql(sql, plan) {
  let out = String(sql || "");

  // Normalize CURRENT_DATE -> CURRENT_DATE()
  out = out.replace(/\bCURRENT_DATE\b(?!\s*\()/g, "CURRENT_DATE()");

  const entry = CATALOG.find((t) => t.id === plan?.chosen_catalog_id);
  const date_field = entry?.date_field;
  const date_expr = entry?.date_expr;

  // expand placeholder token "date_expr" into actual expression
  if (date_expr) {
    out = out.replace(/\bdate_expr\b/g, `(${date_expr})`);
  }

  // rewrite EXTRACT from raw field -> date_expr
  if (date_field && date_expr) {
    out = out.replace(
      new RegExp(`EXTRACT\\((YEAR|MONTH|DAY)\\s+FROM\\s+${date_field}\\)`, "gi"),
      `EXTRACT($1 FROM (${date_expr}))`
    );

    // avoid DATE(DATE(...)) double-wrapping
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
    
    // console.log("🧠 planning query...");
    // const plan = await plan_query_with_ai(text, { thread_ts, memory, domain });

    // console.log("🧠 plan result:", {
    //   chosen_catalog_id: plan.chosen_catalog_id,
    //   sql: plan.sql,
    // });

    // // 2) GUARD + NORMALIZE
    // console.log("🛡 running sql guard...");
    // const normalized_sql = normalize_sql(plan.sql, plan);
    // console.log("🧽 normalized sql:", normalized_sql);
    // assert_safe_select(normalized_sql);
    console.log("🧠 planning query...");

    let plan = null;
    let normalized_sql = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      plan = await plan_query_with_ai(text, { thread_ts, memory, domain });

      console.log(`🧠 plan result (attempt ${attempt}):`, {
        chosen_catalog_id: plan.chosen_catalog_id,
        sql: plan.sql,
      });

      // 2) GUARD + NORMALIZE
      console.log("🛡 running sql guard...");
      normalized_sql = normalize_sql(plan.sql, plan);
      console.log("🧽 normalized sql:", normalized_sql);

      try {
        assert_safe_select(normalized_sql);
        break; // ✅ good SQL
      } catch (e) {
        // If it's not a type coercion problem, fail immediately
        if (!is_type_coercion_guard_error(e) || attempt === 2) throw e;

        // ✅ One retry with stronger instruction (without changing your agent signature)
        console.warn("⚠️ guard rejected SQL due to type coercion; retrying plan once...");

        // Update memory so planner can “see” what failed and correct it
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

    // 3) BIGQUERY
    console.log("📊 running bigquery...");
    const { rows, bytes_processed_estimate } = await run_bigquery(normalized_sql);

    console.log("📊 bigquery result:", {
      row_count: rows.length,
      bytes_processed_estimate,
    });

    // 4) RESPOND
    const table = to_slack_table(rows, 12);
    const insights = (plan.insights || []).slice(0, 5).map((x) => `• ${x}`).join("\n");
    const followups = (plan.followups || []).slice(0, 4).map((x) => `• ${x}`).join("\n");

    const msg =
      `*Answer (draft):* ${plan.short_answer}\n\n` +
      `*Rows:* ${rows.length.toLocaleString()}  |  *Est. bytes processed:* ${Number(bytes_processed_estimate || 0).toLocaleString()}\n\n` +
      `${table}\n\n` +
      `*Insights*\n${insights || "• _(none)_"}\n\n` +
      `*Suggested follow-ups*\n${followups || "• _(none)_"}\n`;

    await say({ text: msg, thread_ts });

    // ✅ save memory (use domain we computed, not plan.domain)
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

/**
 * index.js
 * Slack Socket Mode bot entrypoint (ChatGPT-like tool loop)
 *
 * - Uses chatgpt_like_answer() from agent.js (tool-loop)
 * - Supports candidate table picker (pick_source) with numeric replies
 * - Shows source table used (authoritative from sql_guard match)
 * - Shows bytes processed estimate + bounded Slack table
 * - Optional: show SQL when DEBUG_SQL=1
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { App } = require("@slack/bolt");

const { chatgpt_like_answer } = require("./agent");
const { to_slack_table } = require("./slack_format");

const {
  build_dynamic_catalog,
  format_sources_text,
  get_schema_for_table,
} = require("./sources");

console.log("🔧 starting USAT AI Analyst bot (chatgpt_like)...");

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

  const participation = [
    "participation",
    "participants",
    "participations",
    "races",
    "race",
    "finishers",
  ];
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

    // Pull prior thread state early
    const prior = thread_memory.get(thread_ts) || null;

    // ✅ Detect numeric pick reply (for pick_source flow)
    const is_numeric_choice = /^[1-9]$/.test(text);

    // Resolve forced table AND restore the original question
    let forced_table = null;
    let effective_question = text; // default = current message

    if (is_numeric_choice && prior?.last_pick_candidates?.length) {
      const idx = Number(text) - 1;
      forced_table = prior.last_pick_candidates[idx] || null;

      if (!forced_table) {
        await say({
          text: "That number didn’t match any available tables. Please try again.",
          thread_ts,
        });
        return;
      }

      // ✅ CRITICAL FIX: use the ORIGINAL question, not "3"
      if (prior?.last_question) {
        effective_question = prior.last_question;
      } else {
        // fallback: if somehow missing, treat as clarify
        await say({
          text: "I’m missing the original question for that table selection. Please re-ask your question.",
          thread_ts,
        });
        return;
      }

      // ✅ Optional: clear pick candidates so the next random "1" doesn't reuse old options
      thread_memory.set(thread_ts, {
        ...(prior || {}),
        last_pick_candidates: null,
      });
    }

    // ✅ quick handlers FIRST (no model calls)
    // NOTE: only run these when NOT in numeric-pick mode, or you'd block pick flow.
    if (
      !is_numeric_choice &&
      (lower.includes("data sources") ||
        lower.includes("what data sources") ||
        lower.includes("what sources") ||
        lower.includes("data sources available") ||
        lower.includes("what tables") ||
        lower === "sources")
    ) {
      const dyn_catalog = await get_dynamic_catalog_cached();
      const msg =
        "*Available data sources (allowlisted)*\n" +
        format_sources_text(dyn_catalog) +
        "\n\n_Try: `what fields are in membership_reporting.membership_data`_";

      await say({ text: msg, thread_ts });
      return;
    }

    if (!is_numeric_choice && lower.includes("what fields are in")) {
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

    // 1) context
    const dyn_catalog = await get_dynamic_catalog_cached();
    const memory = thread_memory.get(thread_ts) || null;

    // ✅ domain should be based on the effective question
    const domain = route_question_to_domain(effective_question);

    console.log("🧭 domain:", domain, {
      forced_table: forced_table?.fqn || null,
      effective_question,
    });

    // 2) model tool-loop
    const result = await chatgpt_like_answer({
      user_question: effective_question, // ✅ CRITICAL
      domain,
      memory,
      dyn_catalog,
      thread_ts,
      forced_table, // ✅ NEW: lock to user-selected table
    });

    // ✅ CONSOLE LOG SQL
    if (result?.sql) {
      console.log("🧾 SQL USED:\n", result.sql);
    } else {
      console.log("⚠️ No SQL returned from agent");
    }

    // 3) respond
    if (result.type === "clarify") {
      await say({ text: `❓ ${result.question || "Can you clarify?"}`, thread_ts });
      return;
    }

    if (result.type === "pick_source") {
      const lines = (result.candidates || []).map((c, i) => {
        const tags = (c.tags || []).length ? ` _(${c.tags.join(", ")})_` : "";
        const desc = c.description ? ` — ${c.description}` : "";
        return `${i + 1}) \`${c.fqn}\`${tags}${desc}`;
      });

      const msg =
        `❓ ${result.prompt || "Pick the best table to use for this question:"}\n\n` +
        lines.join("\n") +
        `\n\nReply with a number (1-${lines.length}).`;

      // ✅ store candidates and the original question
      thread_memory.set(thread_ts, {
        ...(thread_memory.get(thread_ts) || {}),
        last_question: effective_question,
        last_domain: domain,
        last_pick_candidates: result.candidates || [],
      });

      await say({ text: msg, thread_ts });
      return;
    }

    const rows = result.rows || [];
    const bytes = Number(result.bytes_processed_estimate || 0);

    // 🚨 HARD GUARDRAIL: no rows = no narrative
    if (rows.length === 0) {
      const src_line = result.used_table_fqn
        ? `*Source:* \`${result.used_table_fqn}\`\n`
        : "";

      const msg =
        `${src_line}` +
        `*Rows:* 0  |  *Est. bytes processed:* ${bytes.toLocaleString()}\n\n` +
        `*Answer:* No data returned for January 2026 in the selected table.\n\n` +
        `*What you can try next*\n` +
        `• Try a more precise question\n`

      await say({ text: msg, thread_ts });

      // ✅ still record memory (important for follow-ups)
      thread_memory.set(thread_ts, {
        ...(thread_memory.get(thread_ts) || {}),
        last_domain: domain,
        last_question: effective_question,
        last_source: result.used_table_fqn || result.chosen_source || null,
        last_sql: result.sql || null,
        last_pick_candidates: null,
      });

      console.log("⚠️ no rows returned — response short-circuited");
      return;
    }

    const src_line = result.used_table_fqn ? `*Source:* \`${result.used_table_fqn}\`\n` : "";
    const model_line = result.model ? `*Model:* \`${result.model}\`\n` : "";
    const bytes_line = `*Rows:* ${rows.length.toLocaleString()}  |  *Est. bytes processed:* ${bytes.toLocaleString()}\n`;

    const debug_sql_on = String(process.env.DEBUG_SQL || "").trim() === "1";
    const sql_block =
      debug_sql_on && result.sql ? `\n*SQL (debug):*\n\`\`\`${result.sql}\`\`\`\n` : "";

    const narrative_block = result.narrative
      ? `*Senior analyst take*\n${result.narrative}\n\n`
      : "";

    const insights =
      (result.insights || []).length
        ? (result.insights || []).slice(0, 6).map((x) => `• ${x}`).join("\n")
        : "• _(none)_";

    const followups =
      (result.followups || []).length
        ? (result.followups || []).slice(0, 6).map((x) => `• ${x}`).join("\n")
        : "• _(none)_";

    const table = to_slack_table(rows, Number(process.env.SLACK_MAX_TABLE_ROWS || "12"));

    const msg =
      `${sql_block}` +
      `\n` +
      `*Answer:* ${result.short_answer || "_(no short answer)_"}\n\n` +
      `${narrative_block}` +
      `${table}\n\n` +
      `*Insights*\n${insights}\n\n` +
      `*Suggested follow-ups*\n${followups}\n` +
      `\n---- Details ----\n` +
      `${src_line}` +
      `${model_line}` +
      `${bytes_line}`;

    await say({ text: msg, thread_ts });

    // ✅ save thread memory
    thread_memory.set(thread_ts, {
      ...(thread_memory.get(thread_ts) || {}),
      last_domain: domain,
      last_question: effective_question,
      last_source: result.used_table_fqn || result.chosen_source || null,
      last_sql: result.sql || null,
      // ensure pick candidates don't hang around forever
      last_pick_candidates: null,
    });

    console.log("✅ response sent:", {
      used_table_fqn: result.used_table_fqn,
      row_count: rows.length,
      bytes_processed_estimate: bytes,
    });
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

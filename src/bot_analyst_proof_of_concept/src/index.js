/**
 * index.js
 *
 * usat_ai_bot_analyst - slack socket mode entrypoint
 *
 * commands:
 * - help
 * - ping
 * - sources
 * - bq_ping (or "bq ping")
 * - list_sources
 * - membership_ytd (or "membership ytd")
 */

const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { App } = require("@slack/bolt");
const { bq_ping, bq_list_tables, bq_membership_ytd } = require("./bq");

function normalize_text(raw_text) {
    return String(raw_text || "")
        .replace(/<@[^>]+>\s*/g, "") // strip mention token
        .trim()
        .toLowerCase();
}

function get_supported_commands_text() {
    return [
        "*help* — show command menu",
        "*ping* — slack bot ping",
        "*sources* — what data sources are available",
        "*bq_ping* — run `select 1` in bigquery",
        "*list_sources* — list tables in membership_reporting dataset",
        "*membership_ytd* — membership ytd (purchase_date <= today, same year)",
    ].join("\n");
}

function get_next_steps_text() {
    return (
        "✅ *you’re connected.*\n\n" +
        "supported commands:\n" +
        get_supported_commands_text() +
        "\n\n" +
        "next build steps:\n" +
        "• add `sales_ytd`\n" +
        "• add ai routing (natural language → metric)\n"
    );
}

function parse_command(lower_text) {
    const text = lower_text.replace(/\s+/g, " ").trim();

    if (text === "help") return "help";
    if (text === "ping") return "ping";
    if (text === "sources") return "sources";

    if (text === "bq ping" || text === "bq_ping") return "bq_ping";

    if (text === "list_sources") return "list_sources";

    if (text === "membership_ytd" || text === "membership ytd") return "membership_ytd";

    if (
        text === "next" ||
        text === "next_step" ||
        text === "next steps" ||
        text === "next_steps" ||
        text === "next step" ||
        text.includes("next step") ||
        text.includes("next steps")
    ) {
        return "next_step";
    }

    return "unknown";
}

const app = new App({
    token: process.env.SLACK_BOT_AI_ANALYST_TOKEN,
    appToken: process.env.SLACK_APP_AI_ANALYST_TOKEN,
    socketMode: true,
    logLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
});

app.error((err) => console.error("bolt_error:", err));

app.event("app_mention", async ({ event, say }) => {
    try {
        // Ignore bot messages (including itself)
        if (event.bot_id) return;

        const text_raw = event.text || "";
        const text_clean = String(text_raw || "").replace(/<@[^>]+>\s*/g, "").trim();
        const lower = normalize_text(text_raw);
        const command = parse_command(lower);

        const mention = `<@${event.user}>`;
        const thread_ts = event.thread_ts || event.ts;

        /**
         * COMMAND: help
         * PURPOSE: Show supported commands and usage
         *
         * SLACK:
         *   @usat_ai_bot_analyst help
         */
        if (command === "help") {
            return say({
                text: "here's what i can do right now:\n" + get_supported_commands_text(),
                thread_ts,
            });
        }

        /**
         * COMMAND: ping
         * PURPOSE: Verify Slack bot connectivity
         *
         * SLACK:
         *   @usat_ai_bot_analyst ping
         */
        if (command === "ping") {
            return say({ text: "pong ✅", thread_ts });
        }

        /**
         * COMMAND: sources
         * PURPOSE: Show which systems are connected (Slack, BigQuery)
         *
         * SLACK:
         *   @usat_ai_bot_analyst sources
         */
        if (command === "sources") {
            return say({
                text:
                    "*current sources*\n" +
                    "• slack: ✅\n" +
                    "• bigquery: ✅\n\n" +
                    "try `list_sources` to see available tables.",
                thread_ts,
            });
        }

        /**
         * COMMAND: bq_ping
         * PURPOSE: Verify BigQuery connectivity (SELECT 1)
         *
         * SLACK:
         *   @usat_ai_bot_analyst bq_ping
         *   @usat_ai_bot_analyst bq ping
         */
        if (command === "bq_ping") {
            const ok = await bq_ping();
            return say({
                text: ok
                    ? "✅ bigquery ping ok (select 1)\n\nsay `next_step` to see what to do next."
                    : "❌ bigquery ping failed",
                thread_ts,
            });
        }

        /**
         * COMMAND: list_sources
         * PURPOSE: List tables available in the membership_reporting dataset
         *
         * SLACK:
         *   @usat_ai_bot_analyst list_sources
         */
        if (command === "list_sources") {
            const dataset_id = "membership_reporting";

            try {
                const tables = await bq_list_tables(dataset_id);

                if (!tables.length) {
                    return say({
                        text: `ℹ️ no tables found in \`${dataset_id}\` (or no access).`,
                        thread_ts,
                    });
                }

                const lines = tables.map(
                    (t) => `• \`${t.table_name}\` (${t.table_type})`
                );

                return say({
                    text: `✅ tables in \`${dataset_id}\`:\n` + lines.join("\n"),
                    thread_ts,
                });
            } catch (err) {
                console.error("list_sources_error:", err);
                return say({
                    text: `❌ list_sources failed: \`${err.message}\``,
                    thread_ts,
                });
            }
        }

        /**
         * COMMAND: membership_ytd
         * PURPOSE:
         *   - Calculate year-to-date membership metrics
         *   - Uses purchased_on_adjusted_mp <= today (same year)
         *
         * RETURNS:
         *   - unique_profiles
         *   - total_sales
         *   - scope (ytd vs fallback)
         *   - as_of_date
         *
         * SLACK:
         *   @usat_ai_bot_analyst membership_ytd
         *   @usat_ai_bot_analyst membership ytd
         */
        if (command === "membership_ytd") {
            try {
                const result = await bq_membership_ytd();

                const scope_label =
                    result.metric_scope === "ytd_by_purchase_date"
                        ? "ytd (purchase date ≤ today, same year)"
                        : "total (fallback)";

                let text =
                    `📊 *membership_ytd*\n` +
                    `• table: \`${result.dataset_id}.${result.table_id}\`\n` +
                    `• unique_profiles: *${Number(result.unique_profiles || 0).toLocaleString()}*\n` +
                    `• total_sales: *${Number(result.total_sales || 0).toLocaleString()}*\n` +
                    `• scope: ${scope_label}\n` +
                    `• as_of_date: ${result.as_of_date}`;

                if (result.note) {
                    text += `\n• note: \`${result.note}\``;
                }

                return say({ text, thread_ts });
            } catch (err) {
                console.error("membership_ytd_error:", err);
                return say({
                    text: `❌ membership_ytd failed: \`${err.message}\``,
                    thread_ts,
                });
            }
        }

        /**
         * COMMAND: next_step
         * PURPOSE: Show what features / commands are coming next
         *
         * SLACK:
         *   @usat_ai_bot_analyst next
         *   @usat_ai_bot_analyst next_step
         *   @usat_ai_bot_analyst next steps
         */
        if (command === "next_step") {
            return say({ text: get_next_steps_text(), thread_ts });
        }

        /**
         * FALLBACK
         * PURPOSE: Catch-all for unknown commands
         */
        return say({
            text:
                `👋 hi ${mention} — i heard: *${text_clean || "(empty)"}*\n\n` +
                "try `help` to see supported commands.",
            thread_ts,
        });
    } catch (err) {
        console.error("app_mention_error:", err);
        return say({
            text: "⚠️ something went wrong handling that request.",
            thread_ts: event.thread_ts || event.ts,
        });
    }
});


app.event("app_home_opened", async ({ event, client }) => {
    try {
        await client.views.publish({
            user_id: event.user,
            view: {
                type: "home",
                blocks: [
                    { type: "header", text: { type: "plain_text", text: "USAT AI Analyst", emoji: true } },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text:
                                "*how to use this app*\n" +
                                "• ask questions in channels using `@usat_ai_bot_analyst`\n\n" +
                                "*try:*\n" +
                                "• `@usat_ai_bot_analyst help`\n" +
                                "• `@usat_ai_bot_analyst bq_ping`\n" +
                                "• `@usat_ai_bot_analyst list_sources`\n" +
                                "• `@usat_ai_bot_analyst membership_ytd`",
                        },
                    },
                    { type: "divider" },
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text:
                                "*status*\n" +
                                "• slack: ✅ connected\n" +
                                "• bigquery: ✅ connected\n",
                        },
                    },
                ],
            },
        });
    } catch (err) {
        console.error("app_home_opened_error:", err);
    }
});

(async () => {
    // Bolt will read PORT if set; in socket mode it’s not required, but start() still needs to run.
    await app.start(process.env.PORT || 3000);
    console.log("slack_socket_mode_connected_ok ✅");
})();

"use strict";
// Ops · USAT Apps console registry + catalog — mirrors src/usat_apps/menu.js (the platform's own
// launcher) for the web Operations panel, kept SEPARATE from the fleet console (modules/ops/console.js,
// which mirrors the root menu.js). Two menus -> two consoles, shown as two labeled groups in the UI.
// Reached only behind require_admin. The client sends { id, params, confirm } — argv is assembled from
// this registry and run by console.run() (spawn shell:false, ANSI-strip, line-cap, per-item timeout).
const { require_admin } = require("../../auth/require_auth");
const { run } = require("./console");

const MIN = 60 * 1000;

// web: 'run' (spawn + capture) | 'form' (validated param, then run) | 'link' (open a URL) |
//      'terminal' (greyed — interactive/streaming/long-running; run in a terminal).
// timeout_ms: override the default run timeout for heavy builds (pipeline steps 3i/3j).
const SECTIONS = [
  { label: "Tests", items: [
    { id: 1, action: "usat_apps_test", label: "Run all tests", desc: "Platform (auth, metrics, status) + all module suites — no DB.", cli: "npm run usat_apps_test", web: "run", klass: "test", bin: "npm", argv: ["run", "usat_apps_test"], timeout_ms: 6 * MIN },
    { id: 2, action: "usat_apps_test_pmaps", label: "Participation maps tests", desc: "Just the participation_maps module (agg, unique) — no DB.", cli: "node src/usat_apps/run_tests.js modules/participation_maps", web: "run", klass: "test", bin: "node", argv: ["src/usat_apps/run_tests.js", "modules/participation_maps"], timeout_ms: 6 * MIN },
    { id: 3, action: "usat_apps_e2e", label: "E2E — UI/UX (Playwright)", desc: "Browser suite; builds an isolated dist + server. Long-running.", cli: "npm run usat_apps_e2e", web: "terminal", klass: "na", note: "Browser suite (builds + spins up a server) — run in a terminal: npm run usat_apps_e2e" },
    { id: 4, action: "usat_apps_e2e_ui", label: "E2E — interactive runner", desc: "Playwright --ui (watch/step). Opens a GUI.", cli: "npm run usat_apps_e2e_ui", web: "terminal", klass: "na", note: "Opens the Playwright UI — run in a terminal: npm run usat_apps_e2e_ui" },
  ] },
  { label: "Build", items: [
    { id: 5, action: "usat_apps_build", label: "Build the web app", desc: "npm install + compile React to web/dist (served at :8022).", cli: "npm run usat_apps_build", web: "run", klass: "mutate", bin: "npm", argv: ["run", "usat_apps_build"], timeout_ms: 10 * MIN, confirm: true },
    { id: 6, action: "usat_apps_build_proxy", label: "Build for proxy (root base)", desc: "Build with Vite base / for the :8000 proxy (usat-app root).", cli: "npm run usat_apps_build_proxy", web: "run", klass: "mutate", bin: "npm", argv: ["run", "usat_apps_build_proxy"], timeout_ms: 10 * MIN, confirm: true },
    { id: 7, action: "usat_apps_dev", label: "Dev servers (API / web / proxy)", desc: "Hot-reload dev + built server + proxy — long-running foreground.", cli: "npm run usat_apps_dev_all", web: "terminal", klass: "na", note: "Long-running foreground processes — run from a terminal (menu items 1–7)." },
  ] },
  { label: "Users & access", items: [
    { id: 8, action: "usat_apps_users_list", label: "List users", desc: "Show .env recovery + stored web-app logins.", cli: "node src/usat_apps/admin.js list", web: "run", klass: "read", bin: "node", argv: ["src/usat_apps/admin.js", "list"] },
    { id: 9, action: "usat_apps_panel_access", label: "Show panel access", desc: "Print the default + per-user panel allow-list + catalog.", cli: "node src/usat_apps/admin.js access", web: "run", klass: "read", bin: "node", argv: ["src/usat_apps/admin.js", "access"] },
    { id: 10, action: "usat_apps_users_edit", label: "Add / reset / remove a user", desc: "Create, reset password, or remove a login — interactive prompts.", cli: "node src/usat_apps/admin.js add|passwd|remove", web: "terminal", klass: "na", note: "Prompts for input — run in a terminal: node src/usat_apps/admin.js add (or passwd / remove)." },
  ] },
  { label: "PM2 (production)", items: [
    { id: 11, action: "usat_apps_pm2_start", label: "pm2 start", desc: "Run the server under pm2 (production).", cli: "npm run pm2_start_usat_apps", web: "run", klass: "mutate", bin: "npm", argv: ["run", "pm2_start_usat_apps"], confirm: true },
    { id: 12, action: "usat_apps_pm2_restart", label: "pm2 restart", desc: "Restart the pm2 process.", cli: "npm run restart_usat_apps", web: "run", klass: "mutate", bin: "npm", argv: ["run", "restart_usat_apps"], confirm: true },
    { id: 13, action: "usat_apps_pm2_stop", label: "pm2 stop (danger)", desc: "Stop the pm2 process.", cli: "npm run stop_usat_apps", web: "run", klass: "destruct", bin: "npm", argv: ["run", "stop_usat_apps"], confirm: true },
    { id: 14, action: "usat_apps_pm2_logs", label: "pm2 logs", desc: "Tail the pm2 logs (streams).", cli: "npm run pm2_logs_usat_apps", web: "terminal", klass: "na", note: "Streams forever — use the Logs pane or a terminal: npm run pm2_logs_usat_apps." },
  ] },
  { label: "Participation data pipeline", items: [
    { id: 15, action: "pmaps_reload_region", label: "Reload region_data (from CSV)", desc: "MySQL: drop + recreate region_data from the usat_region_data CSV. Run before step 3i.", cli: "node reload_region_data.js", web: "run", klass: "mutate", bin: "node", argv: ["reload_region_data.js"], timeout_ms: 10 * MIN, confirm: true },
    { id: 16, action: "pmaps_zip_ref", label: "ZIP reference table (step 2b)", desc: "MySQL: rebuild zip_lat_lng_reference from BigQuery public data.", cli: "node src/participation_data/step_2b_load_zip_reference.js", web: "run", klass: "mutate", bin: "node", argv: ["src/participation_data/step_2b_load_zip_reference.js"], timeout_ms: 10 * MIN, confirm: true },
    { id: 17, action: "pmaps_census_pop", label: "Census population (step 2c)", desc: "MySQL: rebuild census_state_population (Census API or BigQuery fallback). Powers penetration.", cli: "node src/participation_data/step_2c_load_census_population.js", web: "run", klass: "mutate", bin: "node", argv: ["src/participation_data/step_2c_load_census_population.js"], timeout_ms: 10 * MIN, confirm: true },
    { id: 18, action: "pmaps_summary_full", label: "Build summary (step 3i — full)", desc: "MySQL: rebuild summary + flows + events, all years. Heavy.", cli: "node src/participation_data/step_3i_create_participation_summary.js", web: "run", klass: "mutate", bin: "node", argv: ["src/participation_data/step_3i_create_participation_summary.js"], timeout_ms: 20 * MIN, confirm: true },
    { id: 19, action: "pmaps_summary_test", label: "Build summary — TEST (2024 & 2025)", desc: "Same as step 3i but TEST mode (2024 & 2025 only) — faster.", cli: "node src/participation_data/step_3i_create_participation_summary.js test", web: "run", klass: "mutate", bin: "node", argv: ["src/participation_data/step_3i_create_participation_summary.js", "test"], timeout_ms: 10 * MIN, confirm: true },
    { id: 20, action: "pmaps_bq_load", label: "Load metrics to BigQuery (step 3j)", desc: "Upload summary / flows / events tables to BigQuery (WRITE_TRUNCATE).", cli: "node src/participation_data/step_3j_load_bq_participation_summary_metrics.js", web: "run", klass: "mutate", bin: "node", argv: ["src/participation_data/step_3j_load_bq_participation_summary_metrics.js"], timeout_ms: 20 * MIN, confirm: true },
    { id: 21, action: "pmaps_build_scope", label: "Show data build scope", desc: "Print the scope recorded by step 3i — TEST vs FULL, year range, built-at.", cli: "node show_build_scope.js", web: "run", klass: "read", bin: "node", argv: ["show_build_scope.js"] },
  ] },
];
const ALL = SECTIONS.reduce(function (a, s) { return a.concat(s.items); }, []);
function by_id(id) { return ALL.find(function (it) { return String(it.id) === String(id); }) || null; }

function public_sections() {
  return SECTIONS.map(function (s) {
    return { label: s.label, items: s.items.map(function (it) {
      return { id: it.id, action: it.action, label: it.label, desc: it.desc, cli: it.cli, web: it.web, klass: it.klass, confirm: !!it.confirm, note: it.note || "", href: it.href || "", params: it.params || [] };
    }) };
  });
}

function mount(app) {
  app.get("/api/ops/console-usat", require_admin, function (req, res) { res.json({ ok: true, sections: public_sections() }); });
  app.post("/api/ops/console-usat/run", require_admin, async function (req, res) {
    const b = req.body || {};
    const item = by_id(b.id);
    if (!item) return res.status(404).json({ ok: false, error: "unknown command id" });
    if (item.web !== "run" && item.web !== "form") return res.status(400).json({ ok: false, error: "not runnable from the web" });
    if (item.confirm && b.confirm !== true) return res.status(400).json({ ok: false, error: "confirmation required" });
    const result = await run(item, b.params || {});
    res.json(Object.assign({ id: item.id, action: item.action }, result));
  });
}

module.exports = { SECTIONS, by_id, run, public_sections, mount };

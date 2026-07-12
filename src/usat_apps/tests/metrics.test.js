"use strict";
// Adapted from src/reporting/tests/metrics.test.js for the usat_apps platform. No real DB and no API
// key required:
//   - metrics_report.build_report:  the `pool` is stubbed so every SQL returns synthetic rows; we
//     assert the report contract (headline counts + every block, INCLUDING the not_found / not_authorized
//     blocks) and that the headline windows carry an is_test exclusion filter.
//   - ask.js:  key-gating (no LLM key => list_models() empty + ask() rejects NO_AI_KEY) and the
//     read-only SELECT guard (assert_safe_select) scoped to the usat_apps_events table.
//   - track.js:  the pure path->panel mapping (panelForPath). Loaded via a data: URL with its one
//     Vite-only reference (import.meta.env) neutralized.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const metrics_report = require("../metrics/metrics_report");
const ask = require("../metrics/ask");

// A pool stub whose .query(sql, params) resolves synthetic rows chosen by inspecting the SQL. Returns
// the mysql2 tuple shape ([rows, fields]) the module destructures. Records every SQL for assertions.
// NOTE: the event-name-specific matchers come first so `GROUP BY panel, actor` (access denials) is not
// captured by the generic `GROUP BY panel` (by_panel) branch.
function makePoolStub() {
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push({ sql: String(sql), params: params || [] });
      const s = String(sql);
      let rows = [];
      if (/event_name='not_found'/.test(s)) {
        rows = [{ view: "/typo", n: 6 }, { view: "/missing", n: 3 }];
      } else if (/event_name='not_authorized'/.test(s)) {
        rows = [{ panel: "admin", actor: "bob", n: 2 }];
      } else if (/event_name='error'/.test(s)) {
        rows = [{ e: "load_failed", n: 2 }];
      } else if (/event_name='report_export' AND view IS NOT NULL GROUP BY view/.test(s)) {
        rows = [{ view: "/reporting/participation-maps", fmt: "csv", n: 4 }, { view: "/reporting/participation-maps", fmt: "xlsx", n: 3 }];
      } else if (/GROUP BY event_name/.test(s)) {
        rows = [
          { event_name: "panel_view", n: 40 },
          { event_name: "page_view", n: 5 },
          { event_name: "filter_run", n: 12 },
          { event_name: "search_run", n: 3 },
          { event_name: "report_export", n: 7 },
          { event_name: "not_found", n: 6 },
          { event_name: "not_authorized", n: 2 },
        ];
      } else if (/COUNT\(DISTINCT session_id\)/.test(s)) {
        rows = [{ sessions: 7 }];
      } else if (/COUNT\(DISTINCT visitor_id\)/.test(s)) {
        rows = [{ uniq: 9, ret_u: 4, actors: 3 }];
      } else if (/GROUP BY view ORDER BY n DESC/.test(s)) {
        rows = [{ view: "choropleth", n: 20 }, { view: "opportunity", n: 15 }];
      } else if (/GROUP BY filter_name/.test(s)) {
        rows = [{ f: "year", n: 8 }, { f: "state", n: 5 }];
      } else if (/GROUP BY actor ORDER BY events DESC/.test(s)) {
        rows = [{ a: "alice", exports: 5, filters: 6, events: 30, last_seen: "2026-07-01 9:00 AM" }];
      } else if (/GROUP BY actor ORDER BY MAX\(created_at_mtn\) DESC/.test(s)) {
        rows = [{ a: "carol", events: 12, exports: 1, last_seen: "2026-07-02 8:00 AM" }];
      } else if (/GROUP BY d ORDER BY d/.test(s)) {
        rows = [
          { d: "2026-06-30", views: 20, filters: 5, exports: 3 },
          { d: "2026-07-01", views: 25, filters: 7, exports: 4 },
        ];
      } else if (/GROUP BY visitor_id/.test(s)) {
        rows = [{ v: "vid-1234567890abcdef", ret: 1, actor: "alice", tz: "America/Denver", viewport: "lg", visits: 6, events: 20, last_seen: "2026-07-02 8:00 AM" }];
      } else if (/GROUP BY panel/.test(s)) {
        rows = [
          { panel: "participation-maps", views: 30, filters: 10, exports: 5, events: 45 },
          { panel: "metrics", views: 10, filters: 2, exports: 2, events: 14 },
        ];
      } else if (/rows_total,\s*SUM\(CASE WHEN is_test=1/.test(s)) {
        rows = [{ rows_total: 200, test_rows: 15, latest: "Jul 2, 2026 8:00 AM" }];
      } else if (/information_schema\.tables/.test(s)) {
        rows = [{ mb: 1.23 }];
      } else {
        rows = [];
      }
      return [rows, []];
    },
  };
  return { pool: pool, seen: seen };
}

// ---- metrics_report.build_report -------------------------------------------------------------------
test("build_report returns the full report contract, incl. the not_found / not_authorized blocks", async () => {
  const { pool } = makePoolStub();
  const report = await metrics_report.build_report(pool, { days: 30 });

  assert.ok(report && typeof report === "object");
  assert.strictEqual(typeof report.title, "string");
  assert.ok(Array.isArray(report.sections), "report has human sections");
  assert.ok(report.data && typeof report.data === "object", "report.data present");

  const d = report.data;
  assert.strictEqual(d.days, 30);
  assert.strictEqual(d.panel_views, 45);           // panel_view(40) + page_view(5)
  assert.strictEqual(d.filters_run, 15);           // filter_run(12) + search_run(3)
  assert.strictEqual(d.exports, 7);                // report_export
  assert.strictEqual(d.unique_users, 9);
  assert.strictEqual(d.repeat_users, 4);
  assert.strictEqual(d.actors, 3);
  assert.strictEqual(d.sessions, 7);

  // The 404/403 additions.
  assert.strictEqual(d.not_found, 6);
  assert.strictEqual(d.not_authorized, 2);
  assert.ok(Array.isArray(d.top_not_found), "top_not_found is an array");
  assert.strictEqual(d.top_not_found[0].path, "/typo");
  assert.strictEqual(d.top_not_found[0].n, 6);
  assert.ok(Array.isArray(d.access_denied), "access_denied is an array");
  assert.strictEqual(d.access_denied[0].panel, "admin");
  assert.strictEqual(d.access_denied[0].actor, "bob");
  assert.strictEqual(d.access_denied[0].n, 2);

  for (const key of ["by_panel", "by_view", "by_day", "top_operators", "recent_active_users", "visitors",
    "errors", "exports_by_view", "top_filters"]) {
    assert.ok(Array.isArray(d[key]), "block " + key + " is an array");
  }
  assert.ok(d.health && typeof d.health === "object", "health block present");
  assert.strictEqual(d.by_panel[0].panel, "participation-maps");
  assert.strictEqual(d.by_panel[0].events, 45);
  assert.strictEqual(d.by_day.length, 2);
  assert.strictEqual(d.by_view[0].view, "choropleth");
  assert.strictEqual(d.top_operators[0].actor, "alice");
  assert.strictEqual(d.recent_active_users[0].actor, "carol");
  assert.strictEqual(d.visitors[0].device, "desktop");   // viewport 'lg' -> 'desktop'
  assert.strictEqual(d.errors[0].type, "load_failed");
  assert.strictEqual(d.health.rows, 200);
  assert.strictEqual(d.health.test_rows, 15);
});

test("headline windows exclude is_test rows and are scoped to app=usat_apps", async () => {
  const { pool, seen } = makePoolStub();
  await metrics_report.build_report(pool, { days: 7 });

  const headline = seen.find((q) => /GROUP BY event_name/.test(q.sql));
  assert.ok(headline, "headline event-count query was issued");
  assert.match(headline.sql, /is_test IS NULL OR is_test\s*=\s*0/i, "headline WHERE excludes is_test=1 rows");
  assert.deepStrictEqual(headline.params, ["usat_apps"]);

  const health = seen.find((q) => /SUM\(CASE WHEN is_test=1/.test(q.sql));
  assert.ok(health, "health query was issued");
  assert.doesNotMatch(health.sql, /is_test IS NULL OR is_test\s*=\s*0/i, "health counts the whole table incl. test rows");
});

test("build_report respects the days window and defaults to 7", async () => {
  const { pool, seen } = makePoolStub();
  await metrics_report.build_report(pool, { days: 90 });
  assert.ok(seen.some((q) => /INTERVAL 90 DAY/.test(q.sql)), "uses the requested 90-day interval");

  const { pool: p2, seen: s2 } = makePoolStub();
  const rep = await metrics_report.build_report(p2, {});
  assert.strictEqual(rep.data.days, 7, "defaults to 7 days");
  assert.ok(s2.some((q) => /INTERVAL 7 DAY/.test(q.sql)));
});

// ---- ask.js — key gating + read-only SELECT guard (scoped to usat_apps_events) ---------------------
function withoutKeys(fn) {
  return async () => {
    const a = process.env.ANTHROPIC_API_KEY, o = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
    try { await fn(); }
    finally {
      if (a !== undefined) process.env.ANTHROPIC_API_KEY = a;
      if (o !== undefined) process.env.OPENAI_API_KEY = o;
    }
  };
}

test("list_models() is empty when no LLM key is configured", withoutKeys(async () => {
  const m = ask.list_models();
  assert.ok(m && Array.isArray(m.models), "returns { models: [] }");
  assert.strictEqual(m.models.length, 0, "no models without a key");
  assert.strictEqual(ask.have_key(), false);
}));

test("ask() rejects with code NO_AI_KEY when no key is configured", withoutKeys(async () => {
  const pool = { query() { throw new Error("DB must not be reached"); } };
  await assert.rejects(
    () => ask.ask(pool, { question: "how many page views?" }),
    (e) => { assert.strictEqual(e.code, "NO_AI_KEY"); return true; }
  );
}));

test("assert_safe_select accepts a plain SELECT over usat_apps_events and enforces a LIMIT", () => {
  const out = ask.assert_safe_select("SELECT event_name, COUNT(*) FROM usat_apps_events GROUP BY event_name");
  assert.match(out, /^SELECT/i);
  assert.match(out, /LIMIT \d+/i, "a LIMIT is appended when absent");
});

test("assert_safe_select rejects non-SELECT, multi-statement, and write queries", () => {
  const bad = [
    "DELETE FROM usat_apps_events",
    "UPDATE usat_apps_events SET is_test=1",
    "INSERT INTO usat_apps_events (event_name) VALUES ('x')",
    "DROP TABLE usat_apps_events",
    "SELECT 1; DROP TABLE usat_apps_events",
    "",
  ];
  for (const sql of bad) {
    assert.throws(() => ask.assert_safe_select(sql), /.*/, "should reject: " + JSON.stringify(sql));
  }
});

test("assert_safe_select rejects reading any table other than usat_apps_events", () => {
  assert.throws(() => ask.assert_safe_select("SELECT * FROM users LIMIT 10"), /usat_apps_events table is allowed/i);
});

test("assert_safe_select caps an over-large LIMIT to MAX_LIMIT", () => {
  const out = ask.assert_safe_select("SELECT * FROM usat_apps_events LIMIT 999999");
  assert.match(out, new RegExp("LIMIT " + ask.MAX_LIMIT + "\\b"));
});

// ---- track.js — pure path->panel mapping (panelForPath) --------------------------------------------
async function loadTrack() {
  const p = path.join(__dirname, "..", "web", "src", "lib", "track.js");
  let src = fs.readFileSync(p, "utf8");
  src = src.replace(/import\.meta\.env\.BASE_URL/g, "(globalThis.__TRACK_BASE_URL__ || '/')");
  const url = "data:text/javascript;base64," + Buffer.from(src).toString("base64");
  return import(url);
}

test("panelForPath maps usat_apps routes to the right panel names", async () => {
  const { panelForPath } = await loadTrack();
  assert.strictEqual(typeof panelForPath, "function");
  assert.strictEqual(panelForPath("/"), "home");                              // default
  assert.strictEqual(panelForPath("/metrics/usat-apps"), "metrics");
  assert.strictEqual(panelForPath("/reporting/participation-maps"), "reporting");
  assert.strictEqual(panelForPath("/ops/overview"), "ops");
  assert.strictEqual(panelForPath("/admin/users"), "admin");
  assert.strictEqual(panelForPath(""), "home");                               // falsy -> default
});

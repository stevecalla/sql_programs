# Architecture rule — module (folded into :8022) vs. dedicated server

The reference for deciding, whenever a new app or service is added, whether it becomes a **module inside
the usat_apps platform (`:8022`)** or gets its **own server process + port**. Written to keep the
architecture from drifting back toward "one server per app."

Related: `PROXY_PLAN.md`, `PROXY_CUTOVER_CHECKLIST.md` (this folder), and the route table in
`utilities/proxy/proxy_routes.js`.

---

## The rule (one sentence)

**Fold it into `:8022` by default. Break it out into its own port ONLY if at least one of these is true:**

| # | Break-out trigger | Why | Example in this repo |
|---|---|---|---|
| A | It can **crash or hang** in a way that would take the platform down | A wedged/loop/leaky workload must not kill the front door for every other module | Event COI (`:8023`) — the Playwright submission loop; a stuck browser can't take `:8022` down |
| B | It is **unauthenticated / internet-facing** | An external, public surface should not share a process with admin code, Salesforce, or member PII | Public chatbot (`:8024`) — the embeddable widget; isolated so a public-side problem can't reach the app |
| C | It has a **heavy or independent workload** (CPU/memory/schedule) that shouldn't share resources or deploy cadence | Independent scaling, independent restart, independent memory ceiling | Headless API/Slack jobs on the `usat-api` host (`/sales`, `/events`, `/slack*`, …) |

If none of A/B/C apply → **fold it in.** Reporting, merge, and email queue were all folded in for exactly
this reason: none of them crash the platform, none are unauthenticated, none are heavy independent workers.

---

## What "fold in" means (the mechanism)

A folded-in app becomes a **module** at `src/usat_apps/modules/<name>/` that contributes **both halves** into
the single `:8022` process:

1. **Front-end** — one React screen/route in the shared platform SPA (declared in the module's `module.js`
   `panels`), served as static files by `:8022` with an SPA fallback. No separate `index.html`, no separate build.
2. **Back-end** — the module's `api.js` `mount(app)` registers its routes onto the shared Express app under a
   single prefix `/api/<module>/*`. These handlers do the data work (Salesforce reads, DB read/writes, AI, etc.).

The module reuses the **shared services layer** (`src/usat_apps/services/` — ai, knowledge, corrections)
rather than carrying its own copy of the "brain." This shared layer is the reason folding in is a real win
(no duplicated / drifting logic) and not just relocation.

Request flow (page and its data both hit the same port):
```
Browser → usat-app.kidderwise.org/<module-path>   → proxy '/' catch-all → :8022 → serves the React app
React app → /api/<module>/…                        → proxy '/' catch-all → :8022 → module handler → SF + MySQL
```

**Proxy consequence:** folded in = **no dedicated proxy prefix.** The URL falls through the `'/'` catch-all in
`utilities/proxy/proxy_routes.js` to `:8022`. When you fold an app in, you *comment out / delete* its old
prefix line (see the retired `/merge`, `/reporting`, `/email-queue` lines). A dedicated server, by contrast,
keeps an explicit prefix above the `'/'` catch-all (e.g. `/api/event-coi` → `:8023`).

---

## What "break out" means (the mechanism)

A dedicated service is its own `server_<name>_<port>.js` at the repo root (port convention: `_<port>` suffix,
e.g. `server_event_coi_8023.js`), started by its own pm2 script, and given an explicit route in
`proxy_routes.js` **above** the `'/'` catch-all so it matches first. It can still `require()` the same shared
services — isolation is about the *process*, not the code.

---

## Current inventory (as of this writing)

| Service | Where | Why |
|---|---|---|
| usat_apps platform | `:8022` (modules) | The default host: email queue, reporting, merge, ops, chatbot admin + public preview |
| Event COI | `:8023` dedicated | Trigger **A** — Playwright loop must not wedge the platform |
| Public chatbot | `:8024` dedicated (optional/inactive) | Trigger **B** — unauthenticated internet-facing widget; route in `proxy_routes.js` is present but commented until go-live |
| Headless API / Slack jobs | `usat-api` host ports | Trigger **C** — independent data jobs + webhook receivers |
| Proxy | `:8000` (`server_proxy_8000.js`) | Path-prefix router; `-i 2` cluster |

---

## Trade-offs we're knowingly accepting

- **Shared fate on `:8022`:** all folded-in modules share one process, so a crash/leak in one can take them
  all down. Managed by pm2 (`max-memory-restart`, auto-restart) and by keeping A/B/C workloads out. **Watch
  signal:** the day a module becomes crashy/heavy, that's the cue to promote it to its own port — same as COI.
- **Deploy coupling:** any module change redeploys all of `:8022`. Usually a feature at this team size (one
  atomic build/restart), but it's a conscious choice.

---

## TL;DR for the next fold-in/break-out decision

Ask only: *can it take the platform down (A), is it public/unauthenticated (B), or is it a heavy independent
worker (C)?* Yes → own port + explicit proxy prefix. No → module under `:8022`, comment out any old prefix.

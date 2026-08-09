# Menu conventions — the shared kit

Every interactive `menu.js` in this repo runs on ONE shared runtime: `utilities/menu/menu_kit.js`. A menu
file is now just its **data** (a `SECTIONS` array) plus one `runMenu(...)` call. The kit owns everything that
used to be hand-copied per menu — and drift there (inconsistent styling, naming, out-of-order numbers) was
the recurring bug this replaces. Enforced by `npm run lint_menus`.

Related: `PROXY_PLAN.md`, `MODULE_VS_DEDICATED_SERVER_RULE.md` (this folder).

---

## The rule (one sentence)

**A menu is data + `runMenu`. Never hand-write item numbers, never re-implement rendering / spawn / toggle /
quit — the kit does all of it, identically, for every menu.**

---

## Authoring a menu (the 90% case — declarative)

```js
const { runMenu } = require('<path>/utilities/menu/menu_kit');

const SECTIONS = [
  { label: 'RUN', color: 'YELLOW', items: [
    { label: 'Dev server', desc: 'nodemon on :8022', bin: 'npm', args: ['run', 'dev'], cli: 'npm run dev' },
    { label: 'Open app',   desc: 'the built UI',      open: 'http://localhost:8022' },
    { label: 'Status',     desc: 'health probe',       status: 8022, statusLabel: 'platform' },
  ]},
];
const ALL = SECTIONS.flatMap((s) => s.items);

if (require.main === module) {
  runMenu({ title: 'My Tool', color: 'CYAN', sections: SECTIONS, cwd: REPO_ROOT,
            prefsFile: path.join(__dirname, '.menu_prefs.json'), back: true });
}
module.exports = { SECTIONS, ALL };
```

### Item schema — set exactly ONE action per item (dispatch precedence, top wins)

| Field | Behavior |
|---|---|
| `run: async (ctx) => {}` | Arbitrary logic — the universal escape hatch. `ctx` = `{ rl, ask, runCmd, hit, openUrl, c, COLORS, cwd }` |
| `bin` + `args` (`argv` also accepted) | Spawn a child. Optional `env`, `cwd`, `confirm` (y/N gate). Also launches sub-menus (the kit closes/reopens readline so the child owns stdin) |
| `open` | Open a URL / file in the OS browser |
| `hit: { method?, port, pathname, body?, hint? }` | HTTP request; prints status + body |
| `status: <port>` (+ `statusLabel`) | Shorthand for `hit` GET `:port/api/status` |
| `note` / `info` | Print-only text (printed raw, so pre-colored help blobs render as-is) |

Display fields on every item: `label` (required), `desc` (optional gray sub-line), `cli` (optional — the
equivalent shell command, shown only when the `[t]` toggle is on).

### `runMenu` options

| Option | Meaning |
|---|---|
| `title` (req) | Header title (accent color, bold) |
| `sections` (req) | The `SECTIONS` array (or an async function returning it, for registry/dynamic menus) |
| `color` | Accent color name (`'CYAN'`) or raw ANSI code. Default CYAN |
| `subtitle` | String, or `() => string` / `async () => string` for a **live** header (e.g. a DB-backed status line). Lines containing color codes print raw; plain lines print gray |
| `cwd` | Default working dir for spawned children |
| `prefsFile` | Path to `.menu_prefs.json` — persists the `[t]` CLI-toggle across launches. Omit for an in-session-only toggle |
| `back` | `true` → footer says "back / quit" and `b`/`back` also exit (use for sub-menus launched from a parent) |
| `onSelect(item, ctx)` | See below — for menus whose items carry an opaque `action` slug |

**Numbering is automatic.** The kit flattens `sections` and assigns `id = position` (1..N in display order).
Insert, remove, or reorder items freely — numbers never drift, and there is nothing to hand-maintain.

---

## Authoring a menu (the 10% case — `onSelect` escape hatch)

Menus with a big hand-written dispatcher (`switch (item.action)` or an `ACTIONS` map) keep that dispatcher
**unchanged** and pass `onSelect`. The kit renders/numbers/toggles/quits; it calls `onSelect(item, ctx)` for
any item that carries only an `action` slug (no declarative field). The dispatcher reaches the kit's readline
+ spawn through `ctx` (`ctx.ask`, `ctx.runCmd`).

```js
async function onSelect(item, ctx) { _ctx = ctx; return handle_action(item.action, ctx.rl); }
runMenu({ ..., onSelect });
```

Menus using this today: `salesforce_duplicates`, `salesforce_email_queue_proof_of_concept`, `event_analysis`
(with a live `subtitle` status header), `race_results_transform` (sections derived from `console_registry`).

---

## The validator — `npm run lint_menus`

Loads every menu in `utilities/menu/lint_menus.js`'s list and asserts: exports `SECTIONS` + `ALL`/`ALL_ITEMS`;
sections have a label + non-empty items; **no item hand-writes an `id`**; every item has a label and exactly
one action field (or an `action` slug); the kit numbers 1..N sequential + unique. Exit 1 on any violation —
wire it into pre-commit / CI. **When you add a new menu, add its path to the `MENUS` array in that file.**

---

## Windows note

The kit does not shell-wrap `node` on Windows (a `cmd.exe` wrapper swallows Ctrl-C, so a spawned server never
gets SIGINT). `npm`/`npx`/`open` still get a shell. This is handled once, in the kit — menus don't think about it.

---

## Converted menus (all on the kit)

`src/usat_apps/menu.js` · `modules/participation_maps` · `modules/event_coi` · `modules/salesforce_merge` ·
`modules/salesforce_email_queue` · `modules/chatbot` · `src/salesforce_duplicates` ·
`src/salesforce_email_queue_proof_of_concept` · `src/event_analysis` · `src/race_results_transform`.

# Race Results Spreadsheet Converter

Turn any race-results spreadsheet (`.xlsx` or `.csv`) into the fixed **USA Triathlon rankings
template** — entirely in your browser, with a human review step before you download.

> **Privacy:** the conversion runs client-side. Race files contain member PII (DOB, email,
> address); with this tool that data never leaves the machine it's opened on, and the example
> data lives outside the repo (see "Data" below), so it never reaches git/GitHub.

## What it does

Drop a file → it auto-maps the columns to the 12-column template and converts → you review the
highlighted cells (values it changed or guessed), fix anything, then download a template-ready
`.xlsx`. The output always has all 12 columns in order:
`Member Number, Last Name, First Name, Gender, DOB, Email, Address, City, State, Zip, Category,
Recorded Time` — even when the source was missing some. Per the template, only **Address** is
optional.

Value rules: Member # kept if numeric, else `1-day`; Gender → M/F/NB; DOB → `mm/dd/yyyy`;
State → 2-letter (foreign flagged); Category → Age Group / Elite / Para / Relay; Recorded Time →
`hh:mm:ss.000` (finish time only, never a split); race statuses (DNS/DNF/DQ…) are preserved.

## Run it

```
# web app — static host on port 8018 (the transform still runs in the browser)
node ../../server_race_results_transform_8018.js        # http://localhost:8018/
#   is_test_ngrok=true also opens a public ngrok URL when NGROK_AUTHTOKEN is set
#   (reads the repo-root .env). Set is_test_ngrok=false for local-only.

# command line
node src/cli.js inspect "<file>.xlsx|.csv"    # show headers + auto-mapping, no write
node src/cli.js convert "<file>"  [-o out]    # write a reformatted .xlsx
node src/cli.js batch   <folder>  [-o dir]    # convert a whole folder
node menu.js                                  # sectioned interactive menu (pauses after each command)

# tests
npm test            # or: node --test tests/*.test.js
```

## The app at a glance

- A light/dark **theme toggle** (top-right). It follows your OS setting until you pick one.
- One **Compare** card with tabs: **Tables · Mapping · Scorecard · Integrity · Field reference ·
  How it works**, plus a summary bar (score %, file name, flagged-value count, skipped rows).
- **Tables** side-by-side / stacked / tabs (switcher, remembered). Each table is searchable and
  sortable, with a frozen header row and a friendly empty-state. **Link tables** (on by default)
  syncs search, sort and vertical scroll across both.
- **Inline remap:** every reformatted column header has a dropdown (in a top header row, so the
  two tables line up) to re-point that field; same controls live in the **Mapping** tab.
- **Highlights:** changed/guessed cells are highlighted; the legend is collapsible, resizable and
  scrollable. Each reason has **Show rows** (filter to just those) and **Approve**; plus
  **Approve all / Unapprove all**. Editing a highlighted cell also clears it.
- **Value mapping:** Category, Gender, State and Member Number list their distinct source values
  (Member Number includes blank-source `1-day` defaults) with per-value reset and bulk set/reset.
- **Download .xlsx** (centered cells, comfortable column widths, frozen header row) and
  **Save mapping** (remembers your column + value choices for files with the same headers).

## Data

All race data and generated files live **outside the repo**, in
`usat/data/race_results_transform/` (resolved cross-platform via `utilities/determineOSPath`,
created automatically on first run):

```
inputs/    source files to convert (place your files here for the CLI / fixture tests)
outputs/   reformatted .xlsx the CLI writes
expected/  golden snapshots for the fixture tests
```

## Architecture

A small **isomorphic core** in `src/` (pure, no-DOM modules) runs identically in the browser, the
CLI (`src/cli.js`), and the tests — so what you test on the command line is exactly what the
browser does. Excel/CSV I/O uses `exceljs` (declared in the repo-root `package.json`). All domain
knowledge lives in `src/schema.js` (column aliases) and `src/normalize.js` (value rules) — to
teach the tool a new file layout, add an alias or tweak a normalizer. See `CLAUDE.md` for the
full module map. Code is **snake_case** (enforced by `tests/lint_snake_case.test.js`).

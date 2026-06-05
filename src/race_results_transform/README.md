# Race Results Spreadsheet Converter

Turn any race-results spreadsheet (`.xlsx` or `.csv`) into the fixed **USA Triathlon rankings
template** — entirely in your browser, with a human review step before you download.

> **Privacy:** the conversion runs client-side. Race files contain member PII (DOB, email,
> address); with this tool that data never leaves the machine it's opened on. The web app writes
> nothing to disk, and the CLI/test data folder lives outside the repo (see "Data"), so race data
> is never committed.

## What it does

Drop a file → it auto-maps the columns to the 12-column template and converts → you review the
highlighted cells (values it changed or guessed), fix anything, then download a template-ready
`.xlsx`. The output always has all 12 columns in order:
`Member Number, Last Name, First Name, Gender, DOB, Email, Address, City, State, Zip, Category,
Recorded Time` — even when the source was missing some. Per the template, only **Address** is
optional.

Value rules: when there's no separate First/Last column but a single full **Name** column, it's
split into First + Last (handling `Last, First` and `First Middle Last`); Member # kept if numeric (text around a number is trimmed, e.g. `USAT-12345` → `12345`), else `1-day`; Gender → M/F/NB/Open; DOB → `mm/dd/yyyy`;
State → 2-letter (foreign flagged); Category → Age Group / Elite / Para / Relay / Open; Recorded Time →
`hh:mm:ss.000` (finish time only, never a split); race statuses (DNS/DNF/DQ…) are preserved.

## Run it

```
# web app — static host on port 8018 (the transform still runs in the browser)
node ../../server_race_results_transform_8018.js        # http://localhost:8018/
#   is_test_ngrok=true also opens a public ngrok URL when NGROK_AUTHTOKEN is set
#   (reads the repo-root .env). Set is_test_ngrok=false for local-only.

# command line
node src/cli.js inspect "<file>.xlsx|.csv"    # show headers + auto-mapping, no write
node src/cli.js convert "<file>"  [-o out]    # write a reformatted .xlsx (one sheet per source sheet)
node src/cli.js batch   <folder>  [-o dir]    # convert a whole folder
node menu.js                                  # sectioned interactive menu (pauses after each command)

# tests
npm test            # or: node --test tests/*.test.js
```

## The app at a glance

- A light/dark **theme toggle** (top-right). It follows your OS setting until you pick one.
- One **Compare** card with tabs: **Tables · Mapping · Scorecard · Integrity · Field reference ·
  How it works**, plus a summary bar (score %, file name, flagged-value count, skipped rows).
- **Multi-sheet workbooks:** if an uploaded `.xlsx` has more than one sheet, a notice and a
  **sheet tab bar** appear; each sheet is converted independently (its own mapping, flags and
  edits). **Download** opens a checklist so you pick which sheets to save — each selected sheet
  downloads as its own `.xlsx` file.
- **Tables** side-by-side / stacked / tabs (switcher, remembered). Each table is searchable and
  sortable (case-insensitive), with a frozen header row and a friendly empty-state. **Link tables** (on by default)
  syncs search, sort, vertical scroll and the "Show rows" filter across both.
- **Split & download by column:** in the **Mapping** tab, pick any column from your *original*
  file (including extras not in the template) and save a **separate `.xlsx` per value** — only
  that value’s rows, full 12-column template. Mapped fields default to grouping by the converted
  value (value-mapping merges apply); switch the **Converted / Original value** toggle to group by
  the raw values and **define your own groups** (give two values the same group name to combine
  them). Extra columns always group by their raw value. For multi-sheet workbooks the **Download**
  button opens a sheet picker (like the top one) so you can run the split across some or all sheets
  at once — each sheet’s groups download as their own files.
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

The **web app writes nothing to disk** — it converts in memory and downloads through the browser,
so it has no data folder. Only the **CLI and fixture tests** use a data directory, resolved by
`utilities/determineOSPath` (the same per-machine location the repo's other tools use) under a
`race_results_transform/` subfolder, created automatically on first use:

```
<determineOSPath()>/race_results_transform/
  inputs/    source files to convert (put your files here for the CLI / fixture tests)
  outputs/   reformatted .xlsx the CLI writes
  expected/  golden snapshots for the fixture tests
```

`determineOSPath()` returns `…/usat/data/` on Linux/Mac; on **Windows** it currently resolves to
the configured uploads path (`C:/ProgramData/MySQL/MySQL Server 8.0/Uploads/data/`). Either way
it's outside the repo, so race data is never committed.

For regression testing **without** that folder, a committed **synthetic** fixture lives in
`examples/sample/` (clearly-fake data — fake names, `@example.com` emails). `tests/sample.test.js`
converts it and checks committed golden snapshots, so `node --test tests/*.test.js` passes on any
clone / CI. `tests/fixtures.test.js` is the optional real-data tier (skips when the data dir is empty).

## Architecture

A small **isomorphic core** in `src/` (pure, no-DOM modules) runs identically in the browser, the
CLI (`src/cli.js`), and the tests — so what you test on the command line is exactly what the
browser does. Excel/CSV I/O uses `exceljs` (declared in the repo-root `package.json`). All domain
knowledge lives in `src/schema.js` (column aliases) and `src/normalize.js` (value rules) — to
teach the tool a new file layout, add an alias or tweak a normalizer. See `CLAUDE.md` for the
full module map. Code is **snake_case** (enforced by `tests/lint_snake_case.test.js`).

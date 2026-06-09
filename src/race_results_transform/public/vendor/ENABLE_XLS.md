# Optional: legacy `.xls` support (SheetJS)

The converter reads **`.xlsx`** (bundled exceljs) and **`.csv`** out of the box. Legacy binary
**`.xls`** files need **SheetJS** (the `xlsx` package), which is intentionally NOT bundled. The
integration is already wired — you just make SheetJS available.

## Recommended: install the npm package (one step)

```
npm install xlsx
```

That's it. The 8018 server serves SheetJS's browser build from `node_modules/xlsx/dist/xlsx.full.min.js`
at `/vendor/xlsx.full.min.js`, and the web app **lazy-loads it** the first time an `.xls` is opened
(from the Salesforce **Files** queue or a manual upload). The Node CLI/engine uses the same package
via `require('xlsx')`. No vendored copy, no `<script>` tag, no code change. `io.sheetjs_available()`
reports whether it's enabled. **Restart the 8018 server after installing.**

## Alternative: vendor a copy (pure-static / Cloudflare Pages deploys with no node_modules)

If the app is served as static files only (no Node server / no `node_modules`), drop SheetJS's
`xlsx.full.min.js` here as **`public/vendor/xlsx.full.min.js`** — the server route falls through to it.

## Until SheetJS is present

`.xls` rows are highlighted/flagged and opening one asks the user to re-save as `.xlsx`.

## Note on dates

`.xls` date/time cells are read with SheetJS `cellDates` (→ JS `Date`, like exceljs). Spot-check
**DOB** and **Recorded Time** on converted `.xls` files — legacy date handling can differ slightly
from `.xlsx`.

# Legacy `.xls` support (SheetJS)

The converter reads **`.xlsx`** (bundled exceljs) and **`.csv`** out of the box. Legacy binary
**`.xls`** files need **SheetJS** (the `xlsx` package).

## Now bundled (works everywhere, incl. production with a locked npm registry)

`public/vendor/xlsx.full.min.js` is **committed** (just like `exceljs.min.js`), so the web app's
`.xls` support works on ANY deploy — Express *or* pure-static — **without `npm install`**. The 8018
server's `/vendor/xlsx.full.min.js` route prefers `node_modules/xlsx/dist/xlsx.full.min.js` when it's
there and otherwise falls through to this committed copy. The app **lazy-loads it** the first time an
`.xls` is opened (Salesforce **Files** queue or a manual upload). `io.sheetjs_available()` reports
whether it's enabled. **Restart the 8018 server after deploying** so the static asset is served.

### Refreshing the bundled copy
To update SheetJS, replace `public/vendor/xlsx.full.min.js` with a newer
`node_modules/xlsx/dist/xlsx.full.min.js` (e.g. `npm install xlsx` on a dev box, then copy it here).

## Node CLI / engine
The CLI uses the same package via `require('xlsx')`, which needs `node_modules/xlsx` (the committed
browser bundle is for the web app only). On a box with a locked registry, `.xls` via the CLI still
needs the package installed; the **web app** works from the bundled copy regardless.

## If SheetJS is somehow unavailable
`.xls` rows are highlighted/flagged and opening one explains how to enable it / to re-save as `.xlsx`.

## Until SheetJS is present

`.xls` rows are highlighted/flagged and opening one asks the user to re-save as `.xlsx`.

## Note on dates

`.xls` date/time cells are read with SheetJS `cellDates` (→ JS `Date`, like exceljs). Spot-check
**DOB** and **Recorded Time** on converted `.xls` files — legacy date handling can differ slightly
from `.xlsx`.

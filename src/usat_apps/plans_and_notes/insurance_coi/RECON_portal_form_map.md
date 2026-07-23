# Insurance COI Automation — CSR24 Portal Recon & Form Map

_Recon captured live (read-only, no submissions) via browser automation. Source of truth for the
Playwright runner selectors in `modules/event_coi/store/`._

## Credentials (.env)

```
INSURANCE_PORTAL_URL=https://portalv03.csr24.com/mvc/1239375044
INSURANCE_PORTAL_USER=USATRIATHLON
INSURANCE_PORTAL_PW=********
```

## Stage 1 — Login

- Navigate to `INSURANCE_PORTAL_URL` (`/mvc/1239375044`).
- Username input: `<input type="text">`, label **"Username"** → `getByLabel('Username')`.
- Password input: `<input type="password">`, label **"Password"** → `getByLabel('Password')`.
- Submit: `<button type="submit">` labelled **"Login"** → `getByRole('button', { name: 'Login' })`.
- On success the app redirects to **`/mvc/Portal/Index`** (portal home). Use this URL change as the
  "logged in" signal.

## Stage 2 — Navigate to the Race Certificate Request form

- From portal home, the tile link **"Race Certificate Request"** → `href="/mvc/Portal/Link/461492185"`.
- That link 302-redirects to the real form:
  **`/mvc/FormGenerator/Display?FormKey=3&Url=%2fmvc%2fPortal%2fLink%2f461492185`**
- Runner can navigate **directly** to `/mvc/Portal/Link/461492185` after login (faster, resilient to
  home-page layout changes); confirm the resulting page shows the form heading.

## Stage 3 — The form

- Heading: **"Race Director & Sanctioned Events Certificate Form"**
- Submit target: `POST https://wv03.csr24.com/API/Insured/1825339659/GeneratedForms/3`
- Hidden fields present: `__RequestVerificationToken`, `FormKey` (leave as-is; Playwright submits the
  real form so these are handled automatically — do NOT post directly).
- Field `name` attributes are stable per `FormKey=3`. **Primary selector = `input[name="…"]`**, with
  `getByLabel` as a readable fallback for uniquely-labelled fields.

### Field map (name → label → data source)

**Event Details** — entered ONCE per batch:

| name | type | label | source |
|------|------|-------|--------|
| `0-0-56` | text | USA Triathlon Sanction ID # | user (once) |
| `0-0-37` | text | Event Name | user (once) |
| `0-0-38` | text | Event Location Name | user (once) |
| `0-0-39` | text | Event Address | user (once) |
| `0-0-41` | text | Event Start Date | user (once) — plain text input, no datepicker; confirm format (assume MM/DD/YYYY) |
| `0-0-58` | text | Event End Date | user (once) |

**Requestor's Contact Information** — entered ONCE:

| name | type | label | source |
|------|------|-------|--------|
| `0-0-59` | text | Your Name | user (once) |
| `0-0-60` | email | Your Email Address | user (once) |
| `0-0-61` | text | Your Phone Number | user (once) |

**Certificate Holder Details** — LOOP, one submission per MASTER row:

| name | type | label | source |
|------|------|-------|--------|
| `0-0-45` | text | Holder Name **\*required** | MASTER `Name` |
| `0-0-46` | text | Holder Address | MASTER `Address Line 1` (+ ` `+`Address Line 2` when present) |
| `0-0-48` | text | City | MASTER `City` |
| `0-0-49` | text | State | MASTER `State` |
| `0-0-50` | text | Zip Code | MASTER `Zip` |
| `0-0-62` | email | Holder Email Address **\*required** | NOT in sheet → default to requestor email (editable column in UI) |

**Coverage — "Does the Holder require any of the following…?"** (checkboxes) — entered ONCE (default set):

| name | label |
|------|-------|
| `0-0-51` | Additional Insured |
| `0-1-51` | Additional Insured - Primary & Non-Contributory |
| `0-2-51` | Waiver of Subrogation |
| `0-3-51` | Notice of Cancellation (60-day, policy language) |
| `0-4-51` | Other (+ `0-4-51-text`) |

**Is a Written Contract in Place?** (radio) — entered ONCE:

| name | options |
|------|---------|
| `0-0-52` | Yes / No |

**Relationship between Event and Certificate Holder** ("check only 1") — entered ONCE:

| name | label |
|------|-------|
| `0-0-53` | Landlord or Owner of Building/Premises rented ≤30 days |
| `0-1-53` | State or Governmental Agency requiring a permit/authorization |
| `0-2-53` | Other (+ `0-2-53-text`) |

**Additional Information** — entered ONCE (optional):

| name | type | label |
|------|------|-------|
| `0-0-55` | text | Additional Information |

**Delivery Method** (radio) — entered ONCE:

| name | options |
|------|---------|
| `0-0-54` | Deliver to Requestor / Deliver to Requestor & Certificate Holder / Other (+ `0-0-54-text`) |

**Actions:**

- Submit: `<button type="submit">Submit</button>`
- Reset: `<button type="reset">Clear Entries</button>`

## Data source — BRECK EPIC_Certificate_Holders_Full.xlsx

- Tab **MASTER**: columns `Name, Address Line 1, Address Line 2, City, State, Zip` (127 rows).
- Tabs `KEY CONTACTS`, `REMOVED` are ignored by default.
- No email column → Holder Email must be supplied (default = requestor email, per-row editable).
- `Address Line 2` is almost always empty; when present, append to Holder Address.

## Open decisions (confirm before/while building)

1. **Holder Email default** — requestor email for all, vs a shared inbox, vs per-row edit. (Working
   default: requestor email, editable column.)
2. **"Entered once" coverage/contract/relationship/delivery values** — the standard selections for
   Breck-Epic-style property-owner holders (SVR/Mountain-Meadows lots). Likely: Relationship =
   *Landlord/Owner*, plus whichever of Additional Insured / Waiver of Subrogation the event requires,
   Written Contract = ?, Delivery = *Deliver to Requestor*. **Needs the user's standard answers.**
3. **Date format** for Event Start/End (plain text field).
4. **Success/confirmation screen** not yet mapped (no submit during recon) — capture the confirmation
   selector on the first supervised live submit so the runner can detect success vs. validation error.

## Build notes

- Runner keeps ONE logged-in browser context and loops holders (re-open the form URL per record, or
  Clear Entries + re-fill). Re-navigating to the form URL per record is the clean reset.
- UI needs a **"fill with test/default values" toggle** (populate every input with a default/test value
  for fast end-to-end testing) built so it can be hidden later.
- Never post to the API endpoint directly — always drive the rendered form so the anti-forgery token
  and FormKey are handled by the page.

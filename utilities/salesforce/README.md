# Shared Salesforce connection (`utilities/salesforce/salesforce_connect.js`)

One connection helper that **every** USAT app uses to reach Salesforce, so authentication is
consistent and there is a single place to change it. This is the piece that carries us through the
Summer 2027 retirement of SOAP `login()`.

## What it does

`connect_salesforce()` returns an authenticated jsforce `Connection`, trying **OAuth** first and
falling back to **SOAP** login, controlled by `SF_AUTH_MODE`:

| `SF_AUTH_MODE` | Behavior |
| --- | --- |
| `auto` (default) | Try **OAuth** (External Client App). If it fails for any reason, fall back to **SOAP** login. |
| `oauth` | OAuth only — no fallback (fails loudly; use to prove the External Client App). |
| `soap` | SOAP login only (the method retiring Summer 2027; `legacy` is accepted as an alias). |

Every connect prints one colored line so the method in use is obvious:

```
✔ [SF AUTH] OAuth · sandbox · org 00Dct000004xL69EAE
⚠ [SF AUTH] OAuth failed (<reason>) — falling back to SOAP
✔ [SF AUTH] SOAP · sandbox · org 00D... · steve.calla@usatriathlon.org.01test
```

## Usage

```js
const { connect_salesforce } = require('<path>/utilities/salesforce/salesforce_connect');

const { conn, mode, org_id } = await connect_salesforce({ is_test });          // read (default)
const { conn }               = await connect_salesforce({ is_test, role: 'write' }); // merge/undelete
const { conn }               = await connect_salesforce({ is_test, version });  // pin an API version
```

- `is_test` → `SF_DEV_*` (sandbox) vs `SF_PROD_*` (production).
- `role: 'write'` only changes the **SOAP fallback** identity (prefers `SF_*_WRITE_*`, else the base
  user). OAuth always uses the single External Client App run-as user, so **no separate write app is
  needed**.
- `mode` in the return is the method that actually connected: `'oauth'` or `'soap'`.

## Environment variables

| Purpose | Sandbox | Production |
| --- | --- | --- |
| Login URL (also derives the OAuth token URL) | `SF_DEV_LOGIN_URL` | `SF_PROD_LOGIN_URL` |
| **OAuth** — External Client App | `SF_DEV_CLIENT_ID` / `SF_DEV_CLIENT_SECRET` | `SF_PROD_CLIENT_ID` / `SF_PROD_CLIENT_SECRET` |
| **SOAP** fallback | `SF_DEV_USERNAME` / `SF_DEV_PASSWORD` / `SF_DEV_SECURITY_TOKEN` | `SF_PROD_*` |
| SOAP fallback, dedicated write user (optional) | `SF_DEV_WRITE_USERNAME` / `_PASSWORD` / `_SECURITY_TOKEN` | `SF_PROD_WRITE_*` |
| Mode override (optional) | `SF_AUTH_MODE` = `auto` \| `oauth` \| `soap` | — |

The External Client App is **USAT_Apps_Integration** (Client Credentials flow, run-as user).
Sandbox is set up; production is set up separately with the admin.

## Apps wired to this helper

| App / module | File | Call |
| --- | --- | --- |
| Duplicate finder | `salesforce_duplicates/src/salesforce.js` | `connect_salesforce({ is_test })` |
| Field discovery | `salesforce_duplicates/discover_account_fields.js` | `connect_salesforce({ is_test })` |
| Merge — read | `usat_apps/.../salesforce_merge/store/salesforce_read.js` | `connect_salesforce({ is_test })` |
| Merge — write (merge/undelete) | `usat_apps/.../salesforce_merge/store/salesforce_write.js` | `connect_salesforce({ is_test, role: 'write' })` |
| Race transform | `race_results_transform/sf/sf_client.js` | `connect_salesforce({ is_test, version })` |
| Email POC | reuses the transform's `sf/` module | (via transform) |

## Smoke tests (merge menu — `node src/usat_apps/modules/salesforce_merge/menu.js`)

| # | Check | CLI |
| --- | --- | --- |
| 22 / 23 | Sandbox / Production · Auto | `check_sf_auth.js [--prod]` |
| 24 / 25 | Sandbox / Production · OAuth only | `check_sf_auth.js [--prod] --oauth` |
| 26 / 27 | Sandbox / Production · SOAP only | `check_sf_auth.js [--prod] --soap` |

Use **OAuth-only** to prove the External Client App; use **SOAP-only** to watch the retiring path and
detect the day it goes offline.

## Retirement timeline

Salesforce retires SOAP `login()` (API 31–64) in **Summer 2027**. Until then `auto` keeps everything
working (OAuth when configured, SOAP otherwise). After production OAuth is proven, drop the SOAP
credentials and the fallback becomes a no-op.

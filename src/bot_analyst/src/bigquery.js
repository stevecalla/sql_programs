const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const { BigQuery } = require("@google-cloud/bigquery");

function clean_project_id(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "") // remove wrapping quotes
    .replace(/,+$/g, ""); // remove trailing commas
}

function get_bigquery_client() {
  const project_id_raw = process.env.USAT_BQ_PROJECT_ID;
  const credentials_raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST;

  if (!project_id_raw) throw new Error("missing USAT_BQ_PROJECT_ID in env");
  if (!credentials_raw) throw new Error("missing GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST in env");

  const project_id = clean_project_id(project_id_raw);

  let credentials;
  try {
    credentials = JSON.parse(credentials_raw);
  } catch {
    throw new Error("invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_USAT_AI_BOT_ANALYST");
  }

  return new BigQuery({ projectId: project_id, credentials });
}

// Create lazily (so env parsing errors show clearly at runtime)
let _bq = null;
function bq() {
  if (!_bq) _bq = get_bigquery_client();
  return _bq;
}

/**
 * Core runner with dry-run, max bytes billed, timeout.
 * Supports query params.
 *
 * opts:
 * - params: object
 * - maximum_bytes_billed: number (optional override)
 * - skip_cost_check: boolean (for internal metadata queries if desired)
 */
async function _run_bigquery_core(sql, opts = {}) {
  const location = process.env.USAT_BQ_LOCATION || "US";
  const timeout_ms = Number(process.env.BQ_TIMEOUT_MS || "30000");

  const default_max_bytes = Number(process.env.BQ_MAX_BYTES_BILLED || "2000000000");
  const maximum_bytes_billed =
    typeof opts.maximum_bytes_billed === "number" ? opts.maximum_bytes_billed : default_max_bytes;

  const params = opts.params || undefined;

  // 1) Dry run (cost estimate + validation)
  const [dry_job] = await bq().createQueryJob({
    query: sql,
    location,
    dryRun: true,
    useLegacySql: false,
    ...(params ? { params } : {}),
  });

  const bytes = Number(dry_job?.metadata?.statistics?.totalBytesProcessed || 0);

  // Optional: skip cost checks for internal schema calls (usually tiny anyway)
  if (!opts.skip_cost_check && bytes > maximum_bytes_billed) {
    throw new Error(
      `Query too expensive. Estimated bytes processed: ${bytes.toLocaleString()} > cap ${maximum_bytes_billed.toLocaleString()}`
    );
  }

  // 2) Real run with maximumBytesBilled + timeout
  const [job] = await bq().createQueryJob({
    query: sql,
    location,
    useLegacySql: false,
    maximumBytesBilled: String(maximum_bytes_billed),
    ...(params ? { params } : {}),
  });

  const [rows] = await job.getQueryResults({ timeoutMs: timeout_ms });
  return { rows, bytes_processed_estimate: bytes };
}

/**
 * User-facing query execution.
 * Use this for model-generated SQL (subject to your sql_guard in index.js).
 *
 * run_bigquery(sql, params?)
 */
async function run_bigquery(sql, params = undefined) {
  return _run_bigquery_core(sql, { params });
}

/**
 * Internal/trusted execution for schema + metadata helpers.
 * - supports params
 * - can optionally bypass cost check (default false; still safe)
 *
 * run_bigquery_internal(sql, params?, opts?)
 */
async function run_bigquery_internal(sql, params = undefined, opts = {}) {
  return _run_bigquery_core(sql, {
    params,
    skip_cost_check: !!opts.skip_cost_check,
    maximum_bytes_billed:
      typeof opts.maximum_bytes_billed === "number" ? opts.maximum_bytes_billed : undefined,
  });
}

module.exports = {
  run_bigquery,
  run_bigquery_internal,
};

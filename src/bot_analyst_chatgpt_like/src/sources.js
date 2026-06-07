/**
 * sources.js
 * dynamic dataset/table + schema discovery (allowlisted datasets only)
 *
 * Supports allowlist entries in USAT_BQ_ALLOWED_DATASETS like:
 *  - membership_reporting
 *  - membership-reporting-447700.membership_reporting
 *  - membership-reporting-447700:membership_reporting
 */

const { run_bigquery } = require("./bigquery");

function get_region_prefix() {
  // Default US multi-region. Override via USAT_BQ_REGION (e.g., region-eu).
  return String(process.env.USAT_BQ_REGION || "region-us").trim();
}

function get_default_project_id() {
  const project_id = String(process.env.USAT_BQ_PROJECT_ID || "").trim();
  if (!project_id) throw new Error("missing USAT_BQ_PROJECT_ID");
  return project_id;
}

/**
 * Parse allowlist into [{ project, dataset }]
 *
 * USAT_BQ_ALLOWED_DATASETS accepts comma-separated:
 *   - dataset_id
 *   - project.dataset
 *   - project:dataset
 */
function parse_allowed_dataset_specs() {
  const default_project = get_default_project_id();

  const raw = String(process.env.USAT_BQ_ALLOWED_DATASETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!raw.length) {
    throw new Error("missing USAT_BQ_ALLOWED_DATASETS (comma-separated dataset ids or project.dataset)");
  }

  const specs = raw.map((item) => {
    // project:dataset
    if (item.includes(":")) {
      const [project, dataset] = item.split(":").map((x) => String(x || "").trim());
      if (!project || !dataset) throw new Error(`invalid allowlist entry: ${item}`);
      return { project, dataset };
    }

    // project.dataset (be careful: dataset ids can include underscores; project ids include dashes)
    if (item.includes(".")) {
      const [project, dataset] = item.split(".").map((x) => String(x || "").trim());
      if (!project || !dataset) throw new Error(`invalid allowlist entry: ${item}`);
      return { project, dataset };
    }

    // dataset only -> default project
    return { project: default_project, dataset: item };
  });

  // de-dupe
  const seen = new Set();
  const out = [];
  for (const s of specs) {
    const key = `${s.project}.${s.dataset}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

async function list_tables_for_dataset(project_id, dataset_id) {
  const region = get_region_prefix();

  const sql = `
    SELECT
      table_name,
      table_type
    FROM \`${project_id}.${region}.INFORMATION_SCHEMA.TABLES\`
    WHERE table_schema = '${dataset_id}'
    ORDER BY table_name
  `;

  const { rows } = await run_bigquery(sql);

  return rows.map((r) => ({
    project: project_id,
    dataset: dataset_id,
    table: r.table_name,
    table_type: r.table_type,
  }));
}

async function get_schema_for_table(project_id, dataset_id, table_id) {
  // Uses dataset-level INFORMATION_SCHEMA (works in BQ across regions)
  const sql = `
    SELECT
      column_name,
      data_type,
      is_nullable
    FROM \`${project_id}.${dataset_id}.INFORMATION_SCHEMA.COLUMNS\`
    WHERE table_name = '${table_id}'
    ORDER BY ordinal_position
  `;

  const { rows } = await run_bigquery(sql);

  return rows.map((r) => ({
    column_name: r.column_name,
    data_type: r.data_type,
    is_nullable: r.is_nullable,
  }));
}

async function build_dynamic_catalog({ include_schema = false } = {}) {
  const allowed_specs = parse_allowed_dataset_specs();

  const entries = [];

  for (const spec of allowed_specs) {
    const { project: project_id, dataset: dataset_id } = spec;

    const tables = await list_tables_for_dataset(project_id, dataset_id);

    for (const t of tables) {
      const entry = {
        id: `${project_id}.${dataset_id}.${t.table}`,
        project: project_id,
        dataset: dataset_id,
        table: t.table,
        table_type: t.table_type,
      };

      if (include_schema) {
        entry.schema = await get_schema_for_table(project_id, dataset_id, t.table);
      }

      entries.push(entry);
    }
  }

  return entries;
}

function format_sources_text(catalog) {
  // Group by "project.dataset" (since you may now have multiple projects)
  const by_pd = new Map();

  for (const e of catalog) {
    const k = `${e.project}.${e.dataset}`;
    if (!by_pd.has(k)) by_pd.set(k, []);
    by_pd.get(k).push(e);
  }

  const lines = [];
  for (const [pd, entries] of by_pd.entries()) {
    lines.push(`*${pd}*`);
    for (const e of entries) {
      lines.push(`• \`${e.table}\` (${e.table_type || "TABLE"})`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

module.exports = {
  build_dynamic_catalog,
  format_sources_text,
  get_schema_for_table,
};

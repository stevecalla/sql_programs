/**
 * sources.js
 * dynamic dataset/table + schema discovery (allowlisted datasets only)
 */

const { run_bigquery } = require("./bigquery");

function parse_allowed_datasets() {
  return String(process.env.USAT_BQ_ALLOWED_DATASETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function get_region_prefix() {
  // Default US multi-region (matches your earlier pattern).
  // If you later want EU, add env like USAT_BQ_REGION=region-eu.
  // return String(process.env.USAT_BQ_REGION || "region-us").trim();
  return String(process.env.USAT_BQ_LOCATION || "region-us").trim();
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
    dataset: dataset_id,
    table: r.table_name,
    table_type: r.table_type,
  }));
}

async function get_schema_for_table(project_id, dataset_id, table_id) {
  // uses dataset-level INFORMATION_SCHEMA (works cross-region)
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
  const project_id = String(process.env.USAT_BQ_PROJECT_ID || "").trim();
  if (!project_id) throw new Error("missing USAT_BQ_PROJECT_ID");

  const allowed_datasets = parse_allowed_datasets();
  if (!allowed_datasets.length) {
    throw new Error("missing USAT_BQ_ALLOWED_DATASETS (comma-separated dataset ids)");
  }

  const entries = [];

  for (const dataset_id of allowed_datasets) {
    const tables = await list_tables_for_dataset(project_id, dataset_id);

    for (const t of tables) {
      const entry = {
        id: `${dataset_id}.${t.table}`,
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
  const by_dataset = new Map();

  for (const e of catalog) {
    if (!by_dataset.has(e.dataset)) by_dataset.set(e.dataset, []);
    by_dataset.get(e.dataset).push(e);
  }

  const lines = [];
  for (const [dataset_id, entries] of by_dataset.entries()) {
    lines.push(`*${dataset_id}*`);
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

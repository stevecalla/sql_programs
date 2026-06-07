const { run_bigquery_internal } = require("./bigquery");

const _schema_cache = new Map(); // key -> { loaded_at, schema }

function cache_key(project_id, dataset_id, table_id) {
  return `${project_id}.${dataset_id}.${table_id}`;
}

function get_schema_cache_ttl_ms() {
  return Number(process.env.AGENT_CATALOG_CACHE_MS || String(30 * 60 * 1000));
}

function assert_safe_ident(name, value) {
  const ok = /^[a-zA-Z0-9_]+$/.test(String(value || ""));
  if (!ok) throw new Error(`invalid ${name}: ${value}`);
}

async function get_table_schema(project_id, dataset_id, table_id) {
  assert_safe_ident("dataset_id", dataset_id);
  assert_safe_ident("table_id", table_id);

  const key = cache_key(project_id, dataset_id, table_id);

  const cached = _schema_cache.get(key);
  if (cached && (Date.now() - cached.loaded_at) < get_schema_cache_ttl_ms()) {
    return cached.schema;
  }

  const sql = `
    SELECT
      column_name,
      data_type,
      is_nullable
    FROM \`${project_id}.${dataset_id}.INFORMATION_SCHEMA.COLUMNS\`
    WHERE table_name = @table_id
    ORDER BY ordinal_position
  `;

  const { rows } = await run_bigquery_internal(sql, { table_id });

  const schema = (rows || []).map((r) => ({
    column_name: r.column_name,
    data_type: r.data_type,
    is_nullable: r.is_nullable,
  }));

  _schema_cache.set(key, { loaded_at: Date.now(), schema });
  return schema;
}

/**
 * For string date fields: detect whether SAFE_CAST to DATE works or TIMESTAMP works.
 * Returns: { date_expr, notes }
 */
async function infer_date_expr(project_id, dataset_id, table_id, date_field) {
  if (!date_field) return { date_expr: null, notes: "no date_field provided" };

  assert_safe_ident("dataset_id", dataset_id);
  assert_safe_ident("table_id", table_id);

  // Always backtick the field name
  const df = `\`${date_field}\``;

  const sql = `
    SELECT
      COUNT(*) AS total_samples,
      COUNTIF(${df} IS NULL) AS null_raw,
      COUNTIF(SAFE_CAST(${df} AS DATE) IS NULL) AS null_cast_date,
      COUNTIF(SAFE_CAST(${df} AS TIMESTAMP) IS NULL) AS null_cast_ts
    FROM (
      SELECT ${df}
      FROM \`${project_id}.${dataset_id}.${table_id}\`
      WHERE ${df} IS NOT NULL
      LIMIT 200
    )
  `;

  const { rows } = await run_bigquery_internal(sql);

  const r = rows?.[0] || {};
  const total_samples = Number(r.total_samples || 0);
  const null_cast_date = Number(r.null_cast_date || 0);
  const null_cast_ts = Number(r.null_cast_ts || 0);

  let date_expr = null;

  if (total_samples > 0 && null_cast_date / total_samples < 0.1) {
    date_expr = `SAFE_CAST(${df} AS DATE)`;
  } else if (total_samples > 0 && null_cast_ts / total_samples < 0.1) {
    date_expr = `DATE(SAFE_CAST(${df} AS TIMESTAMP))`;
  }

  return {
    date_expr,
    notes: `samples=${total_samples} null_cast_date=${null_cast_date} null_cast_ts=${null_cast_ts}`,
  };
}

function schema_to_text(schema_rows, max_cols = 80) {
  if (!schema_rows?.length) return "(no schema found)";

  const sliced = schema_rows.slice(0, max_cols);
  const lines = sliced.map((c) => `- ${c.column_name} (${c.data_type})`);
  const more =
    schema_rows.length > max_cols
      ? `\n... plus ${schema_rows.length - max_cols} more columns`
      : "";
  return lines.join("\n") + more;
}

module.exports = {
  get_table_schema,
  infer_date_expr,
  schema_to_text,
};

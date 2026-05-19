// Per-build roster snapshot for the event_analysis pipeline. Each row is one
// event (one match record) from a single build, tagged with the build timestamp.
// Accumulates across builds — a tiered retention routine (utilities/
// prune_roster_table.js) keeps the total bounded.
//
// Mirrors what's in dashboard.html's `ROSTER` constant and the xlsx
// step_4_event_detail tab, just normalized for SQL: per-year columns named
// `_baseline` / `_analysis` instead of `_25` / `_26` so the schema doesn't
// bake in specific years.

const identity_fields = `
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
`;

const build_context_fields = `
  -- WHICH build this row came from
  build_at DATETIME NOT NULL,
  baseline_year SMALLINT UNSIGNED NOT NULL,
  analysis_year SMALLINT UNSIGNED NOT NULL,
`;

const classification_fields = `
  -- Cross-year classification (one value per row)
  seg ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NOT NULL,
  -- conf is widened to 50 to fit 'Override (was Tried to Return)' (30 chars)
  -- with future headroom for new override-source labels.
  conf VARCHAR(50) NOT NULL,
  type VARCHAR(20) NOT NULL,
  override_id INT UNSIGNED NULL,
`;

const baseline_side_fields = `
  -- Baseline-year side (NULL when this row is New / single-sided)
  sid_baseline VARCHAR(64) NULL,
  name_baseline VARCHAR(255) NULL,
  month_baseline VARCHAR(3) NULL,
  date_baseline DATE NULL,
  day_baseline VARCHAR(3) NULL,
  -- status holds source-table values like 'REGISTRATION_OPEN' / 'COMPLETED'
  -- which can exceed 20 chars; 64 gives plenty of headroom.
  status_baseline VARCHAR(64) NULL,
`;

const analysis_side_fields = `
  -- Analysis-year side (NULL when this row is Lost / single-sided)
  sid_analysis VARCHAR(64) NULL,
  name_analysis VARCHAR(255) NULL,
  month_analysis VARCHAR(3) NULL,
  date_analysis DATE NULL,
  day_analysis VARCHAR(3) NULL,
  status_analysis VARCHAR(64) NULL,
`;

const future_proofing_fields = `
  -- Forward compat: bump schema_version on column additions; park
  -- experimental fields in extras_json until they earn a column.
  schema_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
  extras_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
`;

const indexes_and_constraints = `
  PRIMARY KEY (id),
  INDEX idx_build_at (build_at),
  INDEX idx_year_pair_build (baseline_year, analysis_year, build_at),
  INDEX idx_seg_build (seg, build_at)
`;

async function query_create_event_analysis_roster_table(table_name) {

  const query = `
    CREATE TABLE IF NOT EXISTS \`${table_name}\` (
      ${identity_fields}
      ${build_context_fields}
      ${classification_fields}
      ${baseline_side_fields}
      ${analysis_side_fields}
      ${future_proofing_fields}
      ${indexes_and_constraints}
    ) ENGINE = InnoDB
      DEFAULT CHARSET = utf8mb4
      COLLATE = utf8mb4_unicode_ci
      COMMENT = 'Per-build event roster snapshot for event_analysis. Append-only historical record.';
  `;

  return query;
}

module.exports = {
  query_create_event_analysis_roster_table,
};

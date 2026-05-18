// Manual matching/segment overrides for the event_analysis pipeline.
// Replaces the legacy data/overrides.json file. Unlike most tables in this
// folder, this one is NOT rebuilt from upstream — analyst input persists
// across builds — so we use CREATE TABLE IF NOT EXISTS (never DROP).

const identity_fields = `
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
`;

const payload_fields = `
  -- WHAT the override is and which event(s) it targets
  override_type ENUM('force_match', 'force_no_match', 'force_segment') NOT NULL,
  baseline_year SMALLINT UNSIGNED NULL,
  analysis_year SMALLINT UNSIGNED NULL,
  sid_baseline VARCHAR(64) NULL,
  sid_analysis VARCHAR(64) NULL,
  segment ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NULL,
  -- Per-side segment assignment for force_no_match unlink (Step 10).
  -- When force_no_match carries both sid_baseline AND sid_analysis,
  -- segment_baseline controls where the baseline event lands (default Lost),
  -- segment_analysis controls where the analysis event lands (default New).
  segment_baseline ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NULL,
  segment_analysis ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NULL,
  note TEXT NULL,
`;

const lifecycle_fields = `
  -- LIFECYCLE flags
  active TINYINT(1) NOT NULL DEFAULT 1,
  approved TINYINT(1) NOT NULL DEFAULT 0,
  approval_state ENUM('approved', 'stale', 'revoked') NULL,
  approved_by VARCHAR(128) NULL,
  approved_at DATETIME NULL,
  -- Snapshots of the targeted events at approval time. Used by step-6 stale
  -- detection: at build time we recompute these from the current event state
  -- and compare; a mismatch flips approval_state to 'stale'.
  -- Format: \`{name}|{month}|{type}|{status}\` (pipe-delimited, human-readable
  -- for debugging — short enough that a hash isn't worth the indirection).
  event_signature_baseline VARCHAR(255) NULL,
  event_signature_analysis VARCHAR(255) NULL,
`;

const audit_fields = `
  -- AUDIT trail
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`;

const indexes_and_constraints = `
  PRIMARY KEY (id),
  INDEX idx_sid_baseline (sid_baseline),
  INDEX idx_sid_analysis (sid_analysis),
  INDEX idx_type_active (override_type, active),
  INDEX idx_approved (approved),
  INDEX idx_year_pair (baseline_year, analysis_year, active),
  CONSTRAINT chk_match_requires_pair CHECK (
    override_type <> 'force_match' OR (sid_baseline IS NOT NULL AND sid_analysis IS NOT NULL)
  ),
  CONSTRAINT chk_segment_requires_value CHECK (
    override_type <> 'force_segment' OR segment IS NOT NULL
  )
`;

async function query_create_event_analysis_overrides_table(table_name) {

  const query = `
    CREATE TABLE IF NOT EXISTS \`${table_name}\` (
      ${identity_fields}
      ${payload_fields}
      ${lifecycle_fields}
      ${audit_fields}
      ${indexes_and_constraints}
    ) ENGINE = InnoDB
      DEFAULT CHARSET = utf8mb4
      COLLATE = utf8mb4_unicode_ci
      COMMENT = 'Manual matching/segment overrides for event_analysis. Replaces data/overrides.json.';
  `;

  return query;
}

module.exports = {
  query_create_event_analysis_overrides_table,
};

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
  sid_25 VARCHAR(64) NULL,
  sid_26 VARCHAR(64) NULL,
  segment ENUM('Retained', 'Shifted', 'Lost', 'New', 'Recovered', 'Tried to Return') NULL,
  note TEXT NULL,
`;

const lifecycle_fields = `
  -- LIFECYCLE flags
  active TINYINT(1) NOT NULL DEFAULT 1,
  approved TINYINT(1) NOT NULL DEFAULT 0,
  approval_state ENUM('approved', 'stale', 'revoked') NULL,
  approved_by VARCHAR(128) NULL,
  approved_at DATETIME NULL,
`;

const audit_fields = `
  -- AUDIT trail
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`;

const indexes_and_constraints = `
  PRIMARY KEY (id),
  INDEX idx_sid_25 (sid_25),
  INDEX idx_sid_26 (sid_26),
  INDEX idx_type_active (override_type, active),
  INDEX idx_approved (approved),
  CONSTRAINT chk_match_requires_pair CHECK (
    override_type <> 'force_match' OR (sid_25 IS NOT NULL AND sid_26 IS NOT NULL)
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

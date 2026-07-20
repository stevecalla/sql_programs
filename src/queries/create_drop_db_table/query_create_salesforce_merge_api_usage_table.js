// query_create_salesforce_merge_api_usage_table.js
// Passive Salesforce API-usage snapshots for the Merge tool (Phase 2). Append-only. Records the org's
// DailyApiRequests used/max (read from the Sforce-Limit-Info header via jsforce conn.limitInfo) at panel
// refreshes (op=probe) and at merge/restore/recreate run boundaries (op-tagged + run_id), so we can chart
// an intraday trend and attribute consumption to each activity / run. No member PII.
// CREATE TABLE IF NOT EXISTS (append-only — never drop/recreate).

const fields = `
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- CREATED AT DATES (repo convention)
  created_at_utc DATETIME,
  created_at_mtn DATETIME,

  env VARCHAR(16),               -- Sandbox | Production (which org the snapshot is for)
  org_id VARCHAR(24),            -- Salesforce organization id
  op VARCHAR(24),                -- probe | merge | restore | recreate | build | read (what generated it)
  run_id VARCHAR(64),            -- links a snapshot to a merge_run (per-run attribution); null for probes
  actor VARCHAR(64),             -- staff username

  api_used INT,                  -- DailyApiRequests used at snapshot time
  api_max INT,                   -- DailyApiRequests daily maximum
  apex_used INT,                 -- DailyAsyncApexExecutions used (merges trigger async Apex rollups)
  apex_max INT,                  -- DailyAsyncApexExecutions daily maximum
  bulk_used INT,                 -- DailyBulkApiBatches used (the Get-Duplicates full pull uses Bulk API)
  bulk_max INT,                  -- DailyBulkApiBatches daily maximum
  source VARCHAR(12),            -- web

  INDEX idx_created_at_mtn (created_at_mtn),
  INDEX idx_env (env),
  INDEX idx_op (op),
  INDEX idx_run_id (run_id)
`;

async function main(table_name) {
  return `
    CREATE TABLE IF NOT EXISTS ${table_name} (
      ${fields}
    );
  `;
}

module.exports = { query_create_salesforce_merge_api_usage_table: main };

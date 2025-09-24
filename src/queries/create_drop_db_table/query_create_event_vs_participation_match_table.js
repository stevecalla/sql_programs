async function query_create_event_vs_participation_match_table(table_name = 'sanction_vs_participation_staging') {
  const query = `
    CREATE TABLE IF NOT EXISTS \`${table_name}\` (
      row_num                 BIGINT UNSIGNED NOT NULL DEFAULT 0,
      s_id_sanctioning_short  VARCHAR(6),
      s_id_sanctioning_events TEXT,
      s_name_events           VARCHAR(255),
      s_starts_events         DATE,
      s_month_label           INT,
      s_state_code_events     VARCHAR(10),
      p_id_sanctioning_events INT,
      p_month_label           TEXT,
      p_start_date_races      TEXT,
      reported_flag           VARCHAR(14) NOT NULL,
      count_s_id_sanctioning_events INT,
      row_count               BIGINT NOT NULL DEFAULT 0,
      -- s_created_at_mtn     VARCHAR(10),
      created_at_mtn          DATETIME,
      created_at_utc          DATETIME,

      -- helpful indexes
      KEY idx_s_id_sanctioning_short (s_id_sanctioning_short),
      KEY idx_s_month_label          (s_month_label),
      KEY idx_s_state_code_events    (s_state_code_events),
      KEY idx_s_starts_events        (s_starts_events),
      KEY idx_reported_flag          (reported_flag)
    )
    ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_0900_ai_ci;
  `;
  return query;
}

module.exports = {
    query_create_event_vs_participation_match_table,
}
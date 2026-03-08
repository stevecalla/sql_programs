// query_trifind_custom_search_extract_data.js
//
// Purpose:
// Extract batched Trifind custom search enriched data from MySQL
// for downstream BigQuery loading.
//
// Notes:
// - Uses DATE_FORMAT for MySQL DATE / DATETIME fields so exported values
//   are consistently shaped for BigQuery ingestion.
// - Keeps text / URL fields as-is.
// - Returns rows ordered by id for stable batch paging.
//
// Usage:
// const q = await query_trifind_custom_search_extract_data(1000, 0);
// const [rows] = await pool.query(q);

async function main(batch_size = 10, offset = 0) {
  return `
    -- QUERY TO EXTRACT TRIFIND CUSTOM SEARCH ENRICHED DATA (batched)
    SELECT DISTINCT
      -- PRIMARY KEY
      id,

      -- LISTING-LEVEL
      seq,

      title,
      url,
      DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,

      event_year,
      event_month,

      city,
      state,
      location,

      race_type,
      is_canceled,
      is_duplicate_listing,

      -- DETAIL-LEVEL
      register_now_url,
      visit_race_website_url,

      usat_link,
      usat_link_text,
      usat_event_id_number,
      is_usat_sanctioned,

      previous_results_count,

      -- USAT MATCH / ENRICHMENT FIELDS
      usat_match_name,
      usat_match_state,
      DATE_FORMAT(usat_match_date, '%Y-%m-%d') AS usat_match_date,
      usat_match_month,
      usat_match_year,
      usat_event_id_internal,
      usat_sanction_id_internal,
      usat_status_internal,
      usat_event_type_internal,
      usat_race_type_internal,
      match_method,
      match_score_internal,
      matched_by_flag,
      matched_by_score,
      matched_usat_sanctioned,
      sanction_discrepancy_flag,
      reason_for_sanction,
      score_bin_internal,

      -- CREATED AT DATES
      DATE_FORMAT(created_at_mtn, '%Y-%m-%d %H:%i:%s') AS created_at_mtn,
      DATE_FORMAT(created_at_utc, '%Y-%m-%d %H:%i:%s') AS created_at_utc

    FROM all_trifind_data_raw
    WHERE 1 = 1
    ORDER BY id ASC
    LIMIT ${batch_size} OFFSET ${offset}
  ;
  `;
}

module.exports = {
  query_trifind_custom_search_extract_data: main,
};
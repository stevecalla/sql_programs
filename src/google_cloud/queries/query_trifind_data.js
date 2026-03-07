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
      usat_sanction_number,
      is_usat_sanctioned,

      previous_results_count,

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
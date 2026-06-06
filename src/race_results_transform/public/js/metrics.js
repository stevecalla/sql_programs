/* App-specific analytics init for race_results_transform. Thin wrapper over the
 * shared UsageMetrics client (served at /analytics/metrics_client.js). Loads it,
 * sets the app id + the app's field allow-list, then fires page_view. The server
 * whitelist is the authoritative guard; this list just mirrors it. */
(function () {
  'use strict';
  function init() {
    if (!window.UsageMetrics) return;        // client failed to load — stay silent
    window.UsageMetrics.init({
      app: 'race_results_transform',
      endpoint: '/api/event',
      allowList: [
        'file_name', 'file_name_hash', 'file_type', 'sheet_count', 'row_count', 'col_count',
        'size_bytes', 'cols_matched', 'cols_unmatched', 'scorecard_band', 'scorecard_pct',
        'flag_count', 'target_key', 'download_mode', 'file_out_count', 'selected_count',
        'split_basis', 'app_version', 'engine', 'error_type'
      ]
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

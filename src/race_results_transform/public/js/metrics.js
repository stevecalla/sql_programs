/* App-specific analytics init for race_results_transform. Thin wrapper over the
 * shared UsageMetrics client (served at /analytics/metrics_client.js). Loads it,
 * sets the app id + the app's field allow-list, then fires page_view. The server
 * whitelist is the authoritative guard; this list just mirrors it. */
(function () {
  'use strict';
  // Deliberate test-run flag: open the app with ?metrics_test=1 and EVERY event (page_view included)
  // is stamped is_test=1, so the run can be deleted later via `metrics:purge-test` without touching
  // real data. Sticks for the tab session (sessionStorage) so reloads keep tagging; not persisted
  // permanently, so a normal new tab is untagged.
  function test_mode() {
    try {
      var on = /[?&]metrics_test=1\b/.test(location.search) || sessionStorage.getItem('metrics_test') === '1';
      if (on) sessionStorage.setItem('metrics_test', '1');
      return on;
    } catch (e) { return /[?&]metrics_test=1\b/.test(location.search); }
  }
  function init() {
    if (!window.UsageMetrics) return;        // client failed to load — stay silent
    window.UsageMetrics.init({
      app: 'race_results_transform',
      endpoint: '/api/event',
      baseProps: test_mode() ? { is_test: 1 } : {},
      allowList: [
        'file_name', 'file_name_hash', 'file_type', 'sheet_count', 'row_count', 'col_count',
        'size_bytes', 'cols_matched', 'cols_unmatched', 'scorecard_band', 'scorecard_pct',
        'flag_count', 'target_key', 'download_mode', 'file_out_count', 'selected_count',
        'split_basis', 'app_version', 'engine', 'error_type', 'is_demo', 'is_test', 'source'
      ]
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

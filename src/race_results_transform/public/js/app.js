/* app.js — browser UI for race_results_transform.
   All transform logic comes from window.RRT.* (same engine as CLI + tests).
   Excel/CSV I/O via vendored window.ExcelJS + RRT.io. Nothing is uploaded. */
(function () {
  'use strict';
  var RRT = window.RRT || {};
  var io = RRT.io, parse = RRT.parse, match = RRT.match, transform = RRT.transform,
      reconcile = RRT.reconcile, mapper = RRT.mapping, schema = RRT.schema,
      normalize = RRT.normalize, display = RRT.display, sort = RRT.sort, split = RRT.split, view = RRT.view_logic;

  var ENUM_BUCKETS = { category: ['Age Group', 'Elite', 'Para', 'Relay', 'Open'], gender: ['M', 'F', 'NB', 'Open'] };
  // Split group-naming helpers — set either to false to disable that feature (see CLAUDE.md).
  var SPLIT_FEATURES = { group_picker: true, remember_grouping: true };
  var PREF_KEY = 'rrt_ui_v1';
  var DEFAULT_COLLAPSED = { scorecard: true, mapping: true, integrity: true };
  // Download: CSV is the default format (XLSX optional). The filename builder follows the USAT
  // convention "Sanction ID - Race Type - Race Distance - Race Name.csv".
  var RACE_TYPES = ['Aquathlon', 'Aquabike', 'Duathlon', 'Triathlon', 'Triathlon off-road'];
  var RACE_DISTANCES = ['Super Sprint', 'Short', 'Intermediate', 'Long', 'Ultra'];

  var FLAG_LABELS = {
    'member-default': 'Member # was blank → set to 1-day',
    'member-nonnumeric': 'No numeric member # (e.g. “Valid”) → set to 1-day',
    'member-trimmed': 'Stripped text from member # — kept the number',
    'gender-missing': 'Gender was blank',
    'gender-unknown': 'Unrecognized gender value',
    'dob-missing': 'Date of birth was blank',
    'dob-unparsed': 'Could not read the date of birth',
    'state-missing': 'State was blank',
    'state-review': 'Not a US 2-letter state — confirm (e.g. foreign)',
    'category-default': 'Category was blank → assumed Age Group',
    'category-assumed': 'Division name assumed to be Age Group — confirm',
    'time-missing': 'Finish time was blank',
    'time-unparsed': 'Could not read the finish time',
    'time-status': 'Race status (DNS/DNF/DQ…) kept as-is'
  };
  function flag_label(code) { return FLAG_LABELS[code] || code; }

  var S = {
    file_name: 'results', ir: null, parsed: null, mapping: null, value_overrides: {},
    result: null, report: null, work_rows: null, store: null, sig: null,
    orig_table: null, conv_table: null, vm_expanded: {}, approved: {}, excluded: {}, flag_info: null, link_tables: false,
    sheets: null, active: null, first_render: true, split_col: null, split_basis: null, split_manual: {}, split_loaded_key: null,
    dl_format: 'csv', dl_fields: { id: '', type: '', distance: '', name: '' },  // download format + filename builder
    dl_excel_safe: false,   // CSV only: wrap DOB/Recorded Time as Excel text so Excel keeps the format on open
    is_demo: false,  // true while viewing the built-in "Try me" sample (fake data) — stamps is_demo on its events
    source: null,    // where the active file came from: null/'upload' | 'salesforce' | 'folder' (try_me derives from is_demo)
    // Salesforce intake / queue
    sf_files: null, sf_selected: {}, sf_sort: { key: 'date', dir: 'desc' }, sf_cancel: false, sf_authed: false,
    sf_source: 'upload',   // 'upload' (Race Results Doc files) | 'email' (Rankings email-queue attachments)
    sf_dir: null, sf_folder: '', sf_sig: null, queue: null, queue_sort: { key: null, dir: 'asc' }, active_queue_id: null,
    // Files queue is source-agnostic: 'salesforce' (downloaded) or 'folder' (local folder pick)
    queue_source: 'salesforce', queue_dir: null, queue_folder: '', queue_sig: null,
    // local-folder intake
    folder_files: null, folder_selected: {}, folder_dir: null, folder_name: ''
  };

  // The committed synthetic fixture served by the app (no PII). Used by both Try-me paths:
  // "Load sample data" fetches + parses it in-browser; "Download sample file" saves it to upload.
  var DEMO_URL = '/sample/sample_race_results_FAKE.xlsx';
  var DEMO_NAME = 'sample_race_results_FAKE.xlsx';
  // A real upload counts as a demo when its filename is the known fake fixture (so "upload it
  // yourself" is also tracked as Try-me activity). Matches the _FAKE fixtures.
  function is_demo_filename(name) { return /_FAKE\.(xlsx|xls|csv)$/i.test(name || ''); }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  function prefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (e) { return {}; } }
  function save_prefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  function get_pref(path) { var p = prefs(); return path.split('.').reduce(function (o, k) { return (o && o[k] !== undefined) ? o[k] : undefined; }, p); }

  function cell_text(v) { return display.cell_text(v); }

  // =====================================================================
  // TableView — searchable, sortable grid; optional inline column-remap
  // dropdowns in the header; optional "only flagged" filter + edit callback.
  // =====================================================================
  function TableView(container, opts) {
    opts = opts || {};
    var T = {
      el: container, editable: !!opts.editable, get_flag: opts.get_flag || null,
      flagged_rows: null, show_flag_filter: !!opts.show_flag_filter,
      col_menu: !!opts.col_menu, top_header: !!opts.top_header, source_headers: opts.source_headers || [],
      current_source: opts.current_source || null, on_remap: opts.on_remap || null, on_edit: opts.on_edit || null,
      on_search: opts.on_search || null, on_sort: opts.on_sort || null, on_filter: opts.on_filter || null,
      deletable: !!opts.deletable, on_delete: opts.on_delete || null, on_render: opts.on_render || null, excluded: null,
      headers: [], data: [], order: [], query: '', sort_col: null, sort_dir: 1,
      cap: opts.cap || 500, show_all: false, filter_set: null, filter_label: '', search_index: []
    };
    function excluded_count() { var n = 0; if (T.excluded) for (var k in T.excluded) if (T.excluded[k]) n++; return n; }

    function compare(a, b, c) {
      // Comparator lives in the isomorphic core (src/sort.js) so it's unit-tested.
      return sort.compare_text(cell_text(T.data[a][c]), cell_text(T.data[b][c])) * T.sort_dir;
    }
    T.apply_sort = function () {
      T.order = T.data.map(function (_, i) { return i; });
      if (T.sort_col != null) T.order.sort(function (a, b) { return compare(a, b, T.sort_col); });
    };
    T.set_data = function (headers, data) { T.headers = headers; T.data = data; T.sort_col = null; T.filter_set = null; T.filter_label = ''; T.search_index = view.build_search_index(data, cell_text); T.apply_sort(); mount(); render_body(); };
    // Export honours the on-screen sort but skips user-deleted rows (NOT the search filter).
    T.export_rows = function () { return T.order.filter(function (i) { return !(T.excluded && T.excluded[i]); }).map(function (i) { return T.data[i]; }); };
    T.set_excluded = function (set) { T.excluded = set || null; render_body(); };
    T.visible_keys = function () { return visible_indices(); };   // current visible row indices (for external "delete shown")
    T.set_query = function (q) { T.query = q; var sb = T.el.querySelector('.tv-search'); if (sb) sb.value = q; render_body(); };
    T.set_order = function (order) { T.order = order.slice(); T.sort_col = null; render_body(); };
    function apply_filter(set, label) {
      T.filter_set = set || null; T.filter_label = label || '';
      var chk = T.el.querySelector('.tv-flagchk'); if (chk) chk.checked = !!(T.filter_set && T.filter_set === T.flagged_rows);
      render_body();
    }
    T.set_filter = function (set, label) { apply_filter(set, label); if (T.on_filter) T.on_filter(set, label); };
    T.set_filter_quiet = function (set, label) { apply_filter(set, label); };

    function visible_indices() { return view.visible_indices(T.order, T.query, T.search_index, T.filter_set, T.excluded); }

    function name_th(h, c) { return '<th data-c="' + c + '">' + esc(h) + '<span class="ind"></span></th>'; }
    function ctrl_th(h, c) {
      if (!T.col_menu) return '<th class="hctl-c"></th>';
      var cur = T.current_source ? T.current_source(c) : null;
      var opt_html = '<option value="">(blank)</option>' + T.source_headers.map(function (sh) {
        return '<option value="' + esc(sh) + '"' + (sh === cur ? ' selected' : '') + '>' + esc(sh) + '</option>';
      }).join('');
      return '<th class="hctl-c"><select class="hmap" data-c="' + c + '" title="Source column for ' + esc(h) + '" aria-label="Source column for ' + esc(h) + '">' + opt_html + '</select></th>';
    }

    function mount() {
      var tools = '<div class="tv-filter hidden"></div><div class="tv-toolbar">' +
        '<input class="tv-search" type="search" placeholder="Search rows…" aria-label="Search table rows" value="' + esc(T.query) + '">' +
        '<button class="btn sm tv-reset"' + (T.sort_col == null ? ' disabled' : '') + '>Reset order</button>' +
        (T.data.length > T.cap ? '<button class="btn sm tv-all"></button>' : '') +
        (T.show_flag_filter ? '<label class="tv-flagonly"><input type="checkbox" class="tv-flagchk"' + (T.filter_set === T.flagged_rows ? ' checked' : '') + '> Only rows to review</label>' : '') +
        '<span class="tv-count"></span></div>';
      var head = '<div class="grid-scroll"><table class="rt"><thead>';
      if (T.top_header) { head += '<tr class="hctl"><th class="rownum"></th>'; T.headers.forEach(function (h, c) { head += ctrl_th(h, c); }); head += '</tr>'; }
      head += '<tr class="tnames"><th class="rownum">#</th>';
      T.headers.forEach(function (h, c) { head += name_th(h, c); });
      head += '</tr></thead><tbody></tbody></table></div>';
      T.el.innerHTML = tools + head;

      var search = T.el.querySelector('.tv-search'); var search_timer;
      search.addEventListener('input', function () { T.query = search.value; clearTimeout(search_timer); search_timer = setTimeout(function () { render_body(); if (T.on_search) T.on_search(T.query); }, 90); });
      T.el.querySelector('.tv-reset').addEventListener('click', function () { T.sort_col = null; T.apply_sort(); mount(); render_body(); });
      var all = T.el.querySelector('.tv-all');
      if (all) all.addEventListener('click', function () { T.show_all = !T.show_all; render_body(); });
      var chk = T.el.querySelector('.tv-flagchk');
      if (chk) chk.addEventListener('change', function () { T.set_filter(chk.checked ? T.flagged_rows : null, 'rows to review'); });
      T.el.querySelector('thead').addEventListener('click', function (e) {
        if (e.target.closest('select')) return;          // remap dropdown, not a sort
        var th = e.target.closest('th[data-c]'); if (!th) return;
        var c = +th.dataset.c;
        if (T.sort_col === c) T.sort_dir = -T.sort_dir; else { T.sort_col = c; T.sort_dir = 1; }
        T.apply_sort(); T.el.querySelector('.tv-reset').disabled = false; render_body(); if (T.on_sort) T.on_sort(T.order);
      });
      if (T.col_menu && T.on_remap) {
        T.el.querySelectorAll('select.hmap').forEach(function (sel) {
          sel.addEventListener('change', function (e) { e.stopPropagation(); T.on_remap(+sel.dataset.c, sel.value); });
          sel.addEventListener('click', function (e) { e.stopPropagation(); });
        });
      }
      if (T.editable) {
        T.el.querySelector('tbody').addEventListener('input', function (e) {
          var td = e.target.closest('td[data-i]'); if (!td) return;
          T.data[+td.dataset.i][+td.dataset.c] = td.textContent;
          T.search_index[+td.dataset.i] = view.row_text(T.data[+td.dataset.i], cell_text);
          if (T.on_edit) T.on_edit(+td.dataset.i, +td.dataset.c, td);
        });
      }
      if (T.deletable) {
        T.el.querySelector('tbody').addEventListener('click', function (e) {
          var b = e.target.closest('.tv-del'); if (!b) return;   // per-row ✕ in the row-number cell
          if (T.on_delete) T.on_delete([+b.dataset.i]);
        });
      }
    }

    function render_body() {
      var vis = visible_indices();
      var limit = view.page_limit(vis.length, T.cap, T.show_all), html = '';
      if (vis.length === 0) {
        html = '<tr><td class="tv-empty" colspan="' + (T.headers.length + 1) + '">No rows match the current search or filter. <button class="btn sm tv-clear-search">Show all rows</button></td></tr>';
      } else {
        for (var k = 0; k < limit; k++) {
          var i = vis[k];
          var rn = T.deletable ? ((i + 1) + ' <button type="button" class="tv-del" data-i="' + i + '" title="Delete this row" aria-label="Delete row ' + (i + 1) + '">✕</button>') : (i + 1);
          html += '<tr><td class="rownum">' + rn + '</td>';
          for (var c = 0; c < T.headers.length; c++) {
            var flag = T.get_flag ? T.get_flag(i, c) : null;
            var attrs = T.editable ? ' contenteditable="true" data-i="' + i + '" data-c="' + c + '"' : '';
            html += '<td' + (flag ? ' class="flag" data-tip="' + esc(flag) + '"' : '') + attrs + '>' + esc(cell_text(T.data[i][c])) + '</td>';
          }
          html += '</tr>';
        }
      }
      T.el.querySelector('tbody').innerHTML = html;
      var cse = T.el.querySelector('.tv-clear-search'); if (cse) cse.addEventListener('click', function () { T.query = ''; var sb = T.el.querySelector('.tv-search'); if (sb) sb.value = ''; T.filter_set = null; render_body(); if (T.on_search) T.on_search(''); });
      T.el.querySelectorAll('thead th[data-c] .ind').forEach(function (sp) {
        var c = +sp.parentNode.dataset.c; sp.textContent = T.sort_col === c ? (T.sort_dir > 0 ? '▲' : '▼') : '';
      });
      var hidden = vis.length - limit;
      T.el.querySelector('.tv-count').textContent = vis.length + ' row' + (vis.length === 1 ? '' : 's') + (hidden > 0 ? ' (' + limit + ' shown)' : '');
      if (T.deletable && T.on_render) T.on_render();   // refresh the external delete/restore controls (pane-head)
      var fb = T.el.querySelector('.tv-filter');
      if (fb) {
        if (T.filter_set) { fb.classList.remove('hidden'); fb.innerHTML = 'Showing only: <b>' + esc(T.filter_label) + '</b> <button class="tv-clear" title="Clear filter — show all rows">\u2715</button>'; fb.querySelector('.tv-clear').addEventListener('click', function () { T.set_filter(null); }); }
        else { fb.classList.add('hidden'); fb.innerHTML = ''; }
      }
      var all = T.el.querySelector('.tv-all');
      if (all) all.textContent = T.show_all ? ('Show first ' + T.cap) : ('Show all ' + T.data.length);
    }
    T.render_body = render_body;
    return T;
  }

  // ---------- file intake ----------
  function wire_dropzone() {
    var dz = $('uploadCard'), input = $('fileInput');
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files[0]) handle_file(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) handle_file(f); });
  }

  // "Try me" split-button: a dropdown with two paths — load the sample instantly, or download
  // the sample file to upload yourself. Clicks stopPropagation so the dropzone doesn't also open
  // the file picker. The button lives in the upload card, which hides once a workbook is loaded.
  function wire_try_me() {
    var btn = $('tryMeBtn'), menu = $('tryMeMenu'), load = $('tryMeLoad'), get = $('tryMeGet');
    if (!btn || !menu) return;
    function close_menu() { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
    function toggle_menu(e) { e.stopPropagation(); menu.classList.toggle('hidden'); btn.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true'); }
    btn.addEventListener('click', toggle_menu);
    btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle_menu(e); } });
    if (load) load.addEventListener('click', function (e) { e.stopPropagation(); close_menu(); load_demo(); });
    if (get) get.addEventListener('click', function (e) { e.stopPropagation(); close_menu(); track('try_me_download', {}); });
    document.addEventListener('click', close_menu);
  }

  // ---- usage analytics (fire-and-forget; counts/enums + filename only) -------
  function um() { return (typeof window !== 'undefined') && window.UsageMetrics; }
  function track(name, props) {
    try {
      var m = um();
      if (m) { props = props || {}; if (S.is_demo) props.is_demo = 1; props.source = S.source || (S.is_demo ? 'try_me' : 'upload'); m.track(name, props); }
      // a download of an active queue file (Salesforce OR local folder) advances its status to Downloaded
      if ((name === 'download' || name === 'split_download_used') && S.active_queue_id) {
        var it = (S.queue || []).filter(function (q) { return q.id === S.active_queue_id; })[0];
        if (it) sf_set_stage(it.name, SF_STAGE.DOWNLOADED);
      }
    } catch (e) { /* never break the app */ }
  }
  function map_match_counts() {
    var matched = 0, total = (schema.TEMPLATE_SCHEMA ? schema.TEMPLATE_SCHEMA.length : 12);
    try { Object.keys(S.mapping || {}).forEach(function (k) { if (S.mapping[k] && S.mapping[k].source) matched++; }); } catch (e) { /* pre-map */ }
    return { cols_matched: matched, cols_unmatched: Math.max(0, total - matched) };
  }
  function conversion_props() {
    var sc = (S.report && S.report.scorecard) || {};
    var mc = map_match_counts();
    return {
      sheet_count: (S.sheets || []).length,
      row_count: (S.result && S.result.row_count) || 0,
      col_count: (S.result && S.result.headers) ? S.result.headers.length : 12,
      cols_matched: mc.cols_matched, cols_unmatched: mc.cols_unmatched,
      scorecard_band: sc.band || null, scorecard_pct: (sc.pct != null ? sc.pct : null),
      flag_count: (S.result && S.result.flags) ? S.result.flags.length : 0
    };
  }

  // Turn the cryptic JSZip "end of central directory" error into a clear message. exceljs reads only
  // .xlsx (a zip); a legacy .xls (old binary Excel) or any non-xlsx file fails this way.
  function unreadable_message(name, err) {
    var msg = (err && err.message) || String(err || '');
    // The .xls reader (SheetJS) couldn't be loaded — distinct from a bad file.
    if (/XLS_UNSUPPORTED/i.test(msg)) {
      return 'Couldn’t load the .xls reader. Install it with “npm install xlsx” and restart the server (it ' +
             'serves /vendor/xlsx.full.min.js), then reload — or open the file in Excel and “Save As” → .xlsx / .csv.';
    }
    // A real .xls that SheetJS tried but failed on — show the actual error so it's diagnosable.
    if (/\.xls$/i.test(name || '')) {
      return 'Couldn’t read this .xls file: ' + (msg || 'unknown error') + '. Try opening it in Excel and ' +
             '“Save As” → .xlsx (or .csv).';
    }
    if (/central directory|not a zip|corrupted zip/i.test(msg)) {
      return 'This file isn’t a readable .xlsx (it may be a different format saved with an .xlsx name). ' +
             'Open it in Excel and “Save As” → .xlsx (or .csv).';
    }
    return 'Could not read file: ' + msg;
  }

  // Legacy .xls support is optional + lazy: SheetJS (vendor/xlsx.full.min.js) is loaded only the first
  // time an .xls is opened. If the file isn't vendored, the read rejects and the user gets the
  // "re-save as .xlsx" message. Drop xlsx.full.min.js into public/vendor/ to enable — no other change.
  var sheetjs_loading = null;
  var sheetjs_probing = false;
  var xls_ok = null;   // null = unknown, true = SheetJS available (.xls reads), false = not available
  // Probe SheetJS availability once (only worth doing when an .xls is in the list). On settle, if a
  // list is showing, re-render so the row highlight + Type tag + warning reflect reality.
  function sf_probe_xls() {
    if (xls_ok !== null || sheetjs_probing) return;
    sheetjs_probing = true;
    load_sheetjs().then(function () { xls_ok = true; }, function () { xls_ok = false; })
      .then(function () { if (S.sf_files) { sf_sort_and_render(); sf_list_status(); } });
  }
  // The post-list status line (selection note + a .xls warning only when SheetJS can't read them).
  function sf_list_status() {
    if (!S.sf_files) return;
    var lim = sf_limit();
    var base = S.sf_files.length > lim
      ? ('Showing all ' + S.sf_files.length + ' — the newest ' + lim + ' are selected (raise “Max files”, up to ' + SF_MAX_FILES + ').')
      : 'Pick a folder and click Download.';
    var xls_n = S.sf_files.filter(function (f) { return sf_file_ext(f) === 'xls'; }).length;
    var warn = (xls_n && xls_ok === false)
      ? ('  ⚠ ' + xls_n + ' legacy .xls file(s) (highlighted) must be re-saved as .xlsx in Excel before converting.')
      : '';
    sf_set_status(base + warn);
  }
  function load_sheetjs() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetjs_loading) return sheetjs_loading;
    sheetjs_loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('XLS_UNSUPPORTED')); };
      s.onerror = function () { sheetjs_loading = null; reject(new Error('XLS_UNSUPPORTED')); };
      document.head.appendChild(s);
    });
    return sheetjs_loading;
  }
  // Binary spreadsheet -> IR[] : .xlsx via exceljs, .xls via SheetJS (if available).
  function read_spreadsheet(name, array_buffer) {
    if (/\.xls$/i.test(name || '')) return load_sheetjs().then(function () { return io.xls_to_irs(array_buffer); });
    return io.read_to_irs(array_buffer);
  }

  function handle_file(file) {
    S.source = null;                            // a manual drop/picker upload (source derives to 'upload')
    S.active_sanction = '';                     // sanction is only known from Salesforce — blank it for uploads
    S.dl_fields = Object.assign({}, S.dl_fields, { id: '' });   // so the download builder's Sanction ID isn't a stale SF value
    S.is_demo = is_demo_filename(file.name);   // a re-uploaded sample counts as Try-me activity
    S.file_name = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
    S.file_display = file.name;
    var is_csv = /\.csv$/i.test(file.name);
    var m = um(); if (m) m.new_upload();
    track('file_uploaded', { file_name: file.name, file_type: is_csv ? 'csv' : 'xlsx', size_bytes: file.size || null });
    var reader = new FileReader();
    reader.onload = function () {
      var p = is_csv ? Promise.resolve([io.csv_to_ir(reader.result)]) : read_spreadsheet(file.name, reader.result);
      p.then(function (irs) { on_workbook(irs); }).catch(function (e) { track('error', { error_type: 'unreadable_file' }); alert(unreadable_message(file.name, e)); });
    };
    if (is_csv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  // "Try me — Load sample data": fetch the served fake fixture, parse it in-browser, and run it
  // through the same pipeline as a real upload. is_demo stamps the resulting events.
  function load_demo() {
    S.is_demo = true;
    S.file_name = DEMO_NAME.replace(/\.(xlsx|xls|csv)$/i, '');
    S.file_display = DEMO_NAME;
    var m = um(); if (m) m.new_upload();
    fetch(DEMO_URL)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) {
        track('file_uploaded', { file_name: DEMO_NAME, file_type: 'xlsx', size_bytes: buf.byteLength || null });
        return io.read_to_irs(buf);
      })
      .then(function (irs) { on_workbook(irs); })
      .catch(function (e) { S.is_demo = false; track('error', { error_type: 'demo_load_failed' }); alert('Could not load the sample file: ' + e.message); });
  }

  // ===== Salesforce intake (optional; feeds the SAME pipeline as a manual upload) ===========
  // Bytes come from the server (/api/sf/*, mx_session-gated). The browser saves them to the folder
  // you pick and works each file as a queue. Statuses persist in localStorage by folder + filename.
  var SF_STAGE = { PENDING: 0, UPLOADED: 1, CONVERTED: 2, DOWNLOADED: 3 };
  var SF_DEFAULT_FILES = 50;   // auto-select the newest 50 by default
  var SF_MAX_FILES = 150;      // hard ceiling — the "Max files" override clamps to this
  function sf_limit() {
    var v = parseInt(($('sfLimit') && $('sfLimit').value) || '', 10);
    if (!v || v < 1) v = SF_DEFAULT_FILES;
    return Math.min(v, SF_MAX_FILES);
  }
  function sf_select_newest() {   // auto-select: newest N by modified date
    var pool = (S.sf_files || []).slice();
    // Email queue: only auto-check rows whose case is NOT closed (regardless of the status filter).
    // So "All statuses" lists open + closed but pre-selects just the open ones; "Not open" pre-selects none.
    if (S.sf_source === 'email') pool = pool.filter(function (f) { return !f.is_closed; });
    var by_date = pool.sort(function (a, b) { return sort.compare_text(b.modified_utc || b.last_modified_date_utc || '', a.modified_utc || a.last_modified_date_utc || ''); });
    S.sf_selected = {}; by_date.slice(0, sf_limit()).forEach(function (f) { S.sf_selected[f.content_version_id] = true; });
  }

  function sf_set_status(msg, is_err) {
    var el = $('sfStatus'); if (!el) return;
    el.textContent = msg || ''; el.classList.toggle('err', !!is_err);
  }
  // Switch between the Upload Queue (Race Results Doc files) and the Email Queue (Rankings attachments).
  function sf_set_source(src) {
    if (src !== 'email' && src !== 'upload') src = 'upload';
    if (S.sf_source === src) return;
    S.sf_source = src;
    S.sf_sort = { key: (src === 'email') ? 'modified' : 'date', dir: 'desc' };
    var seg = $('sfSourceSeg');
    if (seg) seg.querySelectorAll('[data-src]').forEach(function (b) { b.classList.toggle('active', b.dataset.src === src); });
    document.querySelectorAll('.sf-upload-only').forEach(function (el) { el.classList.toggle('hidden', src === 'email'); });
    document.querySelectorAll('.sf-email-only').forEach(function (el) { el.classList.toggle('hidden', src !== 'email'); });
    var sub = $('sfCardSub'); if (sub) sub.textContent = (src === 'email')
      ? 'pull race-results attachments from OPEN Rankings cases (Email-to-Case) — same convert/review/download flow'
      : 'download race-results files for a date and work them as a queue — the convert/review/download flow is unchanged';
    sf_reset();   // clear the current list/selection when switching sources
  }
  // From/To date fields → the server's mode/date/start/end contract. "Any date" = no filter;
  // From==To = a single day; otherwise a range (capped at 14 days).
  function sf_query_params() {
    var field = $('sfField').value;
    var p;
    if ($('sfAnyDate') && $('sfAnyDate').checked) p = { mode: 'all', field: field };
    else {
      var a = $('sfFrom').value, b = $('sfTo').value;
      p = (a && b && a === b) ? { mode: 'specific', field: field, date: a } : { mode: 'range', field: field, start: a, end: b };
    }
    if (S.sf_source === 'email') {
      // email queue status maps to Case IsClosed (no Broaden — that's an Upload-Queue search lever)
      p.status = ($('sfEmailStatus') && $('sfEmailStatus').value) || 'not_closed';
    } else if ($('sfBroaden') && $('sfBroaden').checked) {
      // Broaden = OR the wider terms server-side (same as CLI --search); off = the precise default term.
      p.search = 'Race Results Doc,Race Results,Race,Results';
    }
    return p;
  }
  var SF_MAX_RANGE_DAYS = 14;
  var SF_MIN_DATE = '2025-01-01';   // earliest selectable date (floor) — change here if needed
  function sf_today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function sf_yesterday() { return sf_ymd_add(sf_today(), -1); }
  function sf_ymd_add(ymd, days) {
    var d = new Date(Date.parse(ymd + 'T00:00:00Z') + days * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function sf_days_between(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function sf_clamp_date(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  // Date window: "From" can be ANY day in SF_MIN_DATE..today (so the user can reach early 2025);
  // "To" is then held to From..From+14 days, never past today. From is the anchor you slide to
  // position the window; To fine-tunes the end within the 14-day span.
  function sf_apply_range_limits() {
    var a = $('sfFrom'), b = $('sfTo'); if (!a || !b) return;
    var today = sf_today();
    // From roams the full allowed window
    a.min = SF_MIN_DATE; a.max = today;
    if (a.value) a.value = sf_clamp_date(a.value, SF_MIN_DATE, today);
    // To is bounded by From and the 14-day cap (and never beyond today)
    var lo = a.value || SF_MIN_DATE;
    var hi = sf_ymd_add(lo, SF_MAX_RANGE_DAYS); if (hi > today) hi = today;
    b.min = lo; b.max = hi;
    if (b.value) b.value = sf_clamp_date(b.value, lo, hi);
    else b.value = hi;
  }
  function sf_toggle_anydate() {
    var on = $('sfAnyDate') && $('sfAnyDate').checked;
    if ($('sfFrom')) $('sfFrom').disabled = on;
    if ($('sfTo')) $('sfTo').disabled = on;
  }
  function sf_range_ok() {
    if ($('sfAnyDate') && $('sfAnyDate').checked) return true;
    var a = $('sfFrom').value, b = $('sfTo').value, today = sf_today();
    if (!a || !b) { sf_set_status('Pick a From and To date (or tick “Any date”).', true); return false; }
    if (a < SF_MIN_DATE || b < SF_MIN_DATE) { sf_set_status('Dates must be on or after ' + SF_MIN_DATE + '.', true); return false; }
    if (a > today || b > today) { sf_set_status('Dates can’t be in the future.', true); return false; }
    if (b < a) { sf_set_status('“To” must be on or after “From”.', true); return false; }
    if (sf_days_between(a, b) > SF_MAX_RANGE_DAYS) { sf_set_status('The date range can be at most ' + SF_MAX_RANGE_DAYS + ' days.', true); return false; }
    return true;
  }
  function sf_fetch_json(url, opts) {
    opts = opts || {}; opts.credentials = 'same-origin';
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { var e = new Error('sign in required'); e.needs_login = true; throw e; }
      // read as text first so a non-JSON body (e.g. a plain-text 503 / an HTML error page) gives a
      // clean message instead of "Unexpected token 'D', \"Dashboard …\"".
      return r.text().then(function (t) {
        var j;
        try { j = t ? JSON.parse(t) : {}; }
        catch (pe) {
          throw new Error(r.status === 503
            ? 'Salesforce/metrics login isn’t configured on the server (set RACE_RESULTS_CONVERTER_METRICS_USER / _PASS in .env and restart).'
            : 'Server returned a non-JSON response (HTTP ' + r.status + ') — is it running the latest code?');
        }
        if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }
  function sf_list() {
    if (!sf_range_ok()) return;
    var p = sf_query_params();
    var qs = Object.keys(p).filter(function (k) { return p[k]; }).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    var endpoint = (S.sf_source === 'email') ? '/api/sf/email-files' : '/api/sf/files';
    sf_set_status(S.sf_source === 'email' ? 'Searching the email queue…' : 'Searching Salesforce…');
    sf_fetch_json(endpoint + '?' + qs).then(function (j) {
      S.sf_files = j.files || [];
      if (!S.sf_files.length) {
        $('sfTable').querySelector('tbody').innerHTML = '';
        hide('sfTableWrap'); hide('sfDownloadBar'); hide('sfProgress');
        var c = $('sfCount'); c.classList.remove('hidden'); c.innerHTML = '<b>No files found</b> for this date filter — try a different date or “Latest”.';
        sf_set_status('');
        return;
      }
      sf_set_authed(true);   // listing succeeded → session is valid
      // default sort newest-first, then auto-select the newest sf_limit() files
      S.sf_sort = { key: (S.sf_source === 'email') ? 'modified' : 'date', dir: 'desc' }; sf_sort_files();   // newest-modified first
      sf_select_newest();
      sf_sort_and_render();
      // if any legacy .xls is present, find out whether SheetJS can read it; the message/highlight
      // only warns when it genuinely can't
      if (S.sf_files.some(function (f) { return sf_file_ext(f) === 'xls'; })) sf_probe_xls();
      sf_list_status();
    }).catch(function (e) {
      if (e.needs_login) { sf_set_authed(false); sf_set_status('Sign in to use the Salesforce feature.'); sf_show_login(); }
      else sf_set_status('Could not list files: ' + e.message, true);
    });
  }
  function sf_show_login() {
    var box = $('sfLogin'); if (!box) return;
    box.classList.remove('hidden');
    var u = $('sfLoginUser'); if (u) u.focus();
  }
  // one button toggles between Sign in (show the login form) and Sign out (end the session)
  function sf_set_authed(v) {
    S.sf_authed = !!v;
    var b = $('sfLogoutBtn'); if (!b) return;
    b.textContent = v ? 'Sign out' : 'Sign in';
    b.setAttribute('aria-pressed', v ? 'true' : 'false');
    b.setAttribute('title', v ? 'Sign out (also ends the metrics dashboard session)' : 'Sign in to use the Salesforce feature');
  }
  function sf_toggle_auth() { if (S.sf_authed) sf_logout(); else sf_show_login(); }
  function sf_logout() {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { sf_reset(); sf_set_authed(false); sf_set_status('Signed out. Sign in again to use Salesforce.'); })
      .catch(function () { sf_set_status('Sign-out failed — try again.', true); });
  }
  function sf_login() {
    var u = $('sfLoginUser').value, pw = $('sfLoginPass').value;
    var msg = $('sfLoginMsg'); if (msg) { msg.textContent = 'Signing in…'; msg.classList.remove('err'); }
    fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status)); return j; }); })
      .then(function () {
        $('sfLogin').classList.add('hidden'); $('sfLoginPass').value = ''; if (msg) msg.textContent = '';
        sf_set_authed(true);
        sf_list();   // retry the action that needed auth — stays on this page
      })
      .catch(function (e) { if (msg) { msg.textContent = e.message; msg.classList.add('err'); } });
  }
  function sf_file_ext(f) {
    var name = (f && (f.target_name || f.name)) || '';
    var e = (f && f.file_extension) || (name.indexOf('.') >= 0 ? name.split('.').pop() : '');
    return String(e || '').toLowerCase();
  }
  function sf_type_cell(ext) {
    if (ext === 'xls' && xls_ok === false) return '<span class="sf-type xls" title="Legacy .xls — open it in Excel and Save As .xlsx (or .csv) to convert it here">xls ⚠</span>';
    return '<span class="sf-type">' + esc(ext || '?') + '</span>';
  }
  // Files-found table columns by source. val() = plain text (sort/search), cell() = HTML (display).
  function sf_columns() {
    if (S.sf_source === 'email') return [
      { key: 'opened', label: 'Opened (MT)', val: function (f) { return f.opened_utc || ''; }, cell: function (f) { return esc(f.opened_mtn || ''); } },
      { key: 'modified', label: 'Modified', val: function (f) { return f.modified_utc || ''; }, cell: function (f) { return esc(f.modified_mtn || ''); } },
      { key: 'status', label: 'Status', val: function (f) { return f.status || ''; }, cell: function (f) { return esc(f.status || '—'); } },
      { key: 'subject', label: 'Subject', val: function (f) { return f.subject || ''; }, cell: function (f) { return '<span class="sf-subj" title="' + esc(f.subject) + '">' + esc(f.subject || '—') + '</span>'; } },
      { key: 'sender', label: 'Sender', val: function (f) { return f.sender || ''; }, cell: function (f) { return esc(f.sender || '—'); } },
      { key: 'sanction', label: 'Sanction', val: function (f) { return f.sanction_id || ''; }, cell: function (f) { return esc(f.sanction_id || '—'); } },
      { key: 'program', label: 'Program', val: function (f) { return f.program_name || ''; }, cell: function (f) { return esc(f.program_name || '—'); } },
      { key: 'file', label: 'File name', val: function (f) { return f.target_name || ''; }, cell: function (f) { return '<span title="' + esc(f.target_name) + '">' + esc(f.target_name) + '</span>'; } },
      { key: 'type', label: 'Type', val: function (f) { return sf_file_ext(f); }, cell: function (f) { return sf_type_cell(sf_file_ext(f)); } }
    ];
    return [
      { key: 'date', label: 'Date (MT)', val: function (f) { return f.last_modified_date_utc || ''; }, cell: function (f) { return esc(f.modified_mtn_full || ''); } },
      { key: 'program', label: 'Program', val: function (f) { return f.program_name || ''; }, cell: function (f) { return esc(f.program_name || '—'); } },
      { key: 'sanction', label: 'Sanction', val: function (f) { return f.sanction_id || ''; }, cell: function (f) { return esc(f.sanction_id || '—'); } },
      { key: 'owner', label: 'Owner', val: function (f) { return f.owner_name || ''; }, cell: function (f) { return esc(f.owner_name || '—'); } },
      { key: 'file', label: 'File name', val: function (f) { return f.target_name || ''; }, cell: function (f) { return '<span title="' + esc(f.target_name) + '">' + esc(f.target_name) + '</span>'; } },
      { key: 'type', label: 'Type', val: function (f) { return sf_file_ext(f); }, cell: function (f) { return sf_type_cell(sf_file_ext(f)); } }
    ];
  }
  function sf_cmp_val(f, key) { var c = sf_columns().filter(function (x) { return x.key === key; })[0]; return c ? c.val(f) : (f.target_name || ''); }
  // Shared with the queue: toggle a {key,dir} sort state on header click (re-click flips direction).
  function sf_toggle_sort(state, key, default_dir) {
    if (state && state.key === key) return { key: key, dir: state.dir === 'asc' ? 'desc' : 'asc' };
    return { key: key, dir: default_dir || 'asc' };
  }
  function sf_sort_files() {
    if (!S.sf_files) return;
    var k = S.sf_sort.key, dir = (S.sf_sort.dir === 'asc') ? 1 : -1;
    S.sf_files.sort(function (a, b) { return sort.compare_text(sf_cmp_val(a, k), sf_cmp_val(b, k)) * dir; });  // reuse src/sort.js
  }
  function sf_set_header_arrows() {
    $('sfTable').querySelectorAll('th.sf-sort').forEach(function (th) {
      var a = th.querySelector('.sf-arrow');
      if (a) a.textContent = (th.dataset.sort === S.sf_sort.key) ? (S.sf_sort.dir === 'asc' ? '▲' : '▼') : '';
    });
  }
  function sf_selected_files() { return (S.sf_files || []).filter(function (f) { return S.sf_selected[f.content_version_id]; }); }
  function sf_visible() {   // rows matching the search box (searches every visible column's text)
    var q = (($('sfSearch') && $('sfSearch').value) || '').toLowerCase().trim();
    var all = S.sf_files || [];
    if (!q) return all;
    var cols = sf_columns();
    return all.filter(function (f) {
      return cols.map(function (c) { return String(c.val(f) || ''); }).join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sf_update_count() {
    var total = (S.sf_files || []).length, sel = sf_selected_files().length, vis = sf_visible().length, lim = sf_limit();
    var el = $('sfCount'); if (!el) return;
    el.classList.toggle('hidden', total === 0);
    var over = sel > lim ? (' <span class="sf-over">— max ' + lim + ' per download</span>') : '';
    var showing = (vis < total) ? (' · showing <b>' + vis + '</b>') : '';
    var more = (total > sel) ? (' <span class="sf-more">— ' + (total - sel) + ' more available (raise “Max files” to include)</span>') : '';
    // Highlight the Max-files field itself when more files exist than the current cap AND the cap can still go up.
    var li = $('sfLimit'); if (li) li.classList.toggle('sf-limit-hot', total > lim && lim < SF_MAX_FILES);
    el.innerHTML = '<b>' + total + '</b> file(s) found' + showing + ' · <b>' + sel + '</b> selected' + over + more;
  }
  function sf_render() {
    var cols = sf_columns(), vis = sf_visible();
    // header (rebuilt per source so Upload Queue / Email Queue show their own columns)
    $('sfTable').querySelector('thead').innerHTML =
      '<tr><th><input type="checkbox" id="sfCheckAll" aria-label="Select all files" checked></th>' +
      cols.map(function (c) { return '<th class="sf-sort" data-sort="' + c.key + '">' + esc(c.label) + ' <span class="sf-arrow"></span></th>'; }).join('') + '</tr>';
    $('sfTable').querySelector('tbody').innerHTML = vis.map(function (f) {
      var checked = S.sf_selected[f.content_version_id] ? ' checked' : '';
      var ext = sf_file_ext(f);
      var rowcls = [];
      if (ext === 'xls' && xls_ok === false) rowcls.push('sf-xls-row');
      // missing program/sanction is the norm for the email queue, so only flag it for the upload queue
      if (S.sf_source !== 'email' && (!f.program_name || !f.sanction_id)) rowcls.push('sf-missing-meta');
      return '<tr' + (rowcls.length ? ' class="' + rowcls.join(' ') + '"' : '') + '><td><input type="checkbox" class="sf-pick" data-id="' + esc(f.content_version_id) + '" aria-label="Select file"' + checked + '></td>' +
        cols.map(function (c) { return '<td>' + c.cell(f) + '</td>'; }).join('') + '</tr>';
    }).join('');
    $('sfCheckAll').checked = vis.length > 0 && vis.every(function (f) { return S.sf_selected[f.content_version_id]; });
    sf_set_header_arrows();
    show('sfTableWrap'); show('sfDownloadBar'); if ($('sfSearchWrap')) show('sfSearchWrap');
    sf_update_count(); sf_update_dl_enabled();
  }
  function sf_sort_and_render() { sf_sort_files(); sf_render(); }
  function sf_update_dl_enabled() {
    var sel = sf_selected_files().length, lim = sf_limit();
    var ready = sel > 0 && sel <= lim && (S.sf_dir || $('sfFolderPath').value);
    $('sfDownloadBtn').disabled = !ready;
  }
  function sf_apply_limit() {   // clamp the "Max files" field and re-select the newest N
    if ($('sfLimit')) { var lim = sf_limit(); if (String(lim) !== $('sfLimit').value) $('sfLimit').value = lim; }
    if (S.sf_files && S.sf_files.length) { sf_select_newest(); sf_render(); }
  }
  function sf_delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function sf_progress(done, total) {
    var wrap = $('sfProgress'), bar = $('sfProgressBar'), lbl = $('sfProgressLabel'); if (!wrap || !bar) return;
    wrap.classList.remove('hidden');
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    bar.style.width = pct + '%';
    if (lbl) lbl.textContent = (total > 0 && done >= total) ? ('Downloaded ' + total + ' file(s) ✓') : ('Downloading ' + done + ' of ' + total + ' … ' + pct + '%');
    if (total > 0 && done >= total) setTimeout(function () { wrap.classList.add('hidden'); bar.style.width = '0'; }, 1200);
  }
  function sf_reset() {
    // clears the search/list/selection but KEEPS the chosen folder (persists until another is picked)
    S.sf_files = null; S.sf_selected = {};
    $('sfTable').querySelector('tbody').innerHTML = '';
    if ($('sfSearch')) $('sfSearch').value = '';
    hide('sfTableWrap'); hide('sfDownloadBar'); hide('sfProgress'); hide('sfLogin'); if ($('sfSearchWrap')) hide('sfSearchWrap');
    $('sfCount').classList.add('hidden');
    sf_set_status('');
  }
  // --- persist the chosen folder across sessions -----------------------------------------------
  // Fallback path string -> localStorage; Chrome directory handle -> IndexedDB (handles aren't
  // JSON-serializable). Restored on load; write permission is re-confirmed on the first download.
  function sf_idb(cb) {
    try {
      var open = window.indexedDB.open('rrt_sf', 1);
      open.onupgradeneeded = function () { try { open.result.createObjectStore('kv'); } catch (e) { /* exists */ } };
      open.onsuccess = function () { cb(open.result); };
      open.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function sf_idb_set(key, val) {
    sf_idb(function (db) { if (!db) return; try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = function () { db.close(); }; } catch (e) { /* ignore */ } });
  }
  function sf_idb_get(key) {
    return new Promise(function (resolve) {
      sf_idb(function (db) {
        if (!db) return resolve(null);
        try { var req = db.transaction('kv', 'readonly').objectStore('kv').get(key); req.onsuccess = function () { db.close(); resolve(req.result || null); }; req.onerror = function () { db.close(); resolve(null); }; }
        catch (e) { resolve(null); }
      });
    });
  }
  function sf_ensure_permission(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve(true);
    return handle.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return true;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (p2) { return p2 === 'granted'; });
    }).catch(function () { return false; });
  }
  function sf_set_folder_name(name) { if ($('sfFolderName')) $('sfFolderName').textContent = name ? ('Folder: ' + name) : ''; }
  function sf_restore_folder() {
    if (window.showDirectoryPicker) {
      sf_idb_get('sf_dir').then(function (handle) {
        if (!handle) return;
        S.sf_dir = handle; S.sf_sig = 'dir:' + (handle.name || 'folder');
        sf_set_folder_name(handle.name || '(selected)'); sf_update_dl_enabled();
      });
    } else {
      try { var saved = window.localStorage.getItem('rrt_sf_folder'); if (saved && $('sfFolderPath')) { $('sfFolderPath').value = saved; S.sf_folder = saved; S.sf_sig = 'path:' + saved; show('sfFolderPath'); sf_set_folder_name(saved); sf_update_dl_enabled(); } } catch (e) { /* ignore */ }
    }
  }
  function sf_choose_folder() {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
        S.sf_dir = handle; S.sf_folder = ''; S.sf_sig = 'dir:' + (handle.name || 'folder');
        sf_set_folder_name(handle.name || '(selected)'); sf_idb_set('sf_dir', handle); sf_update_dl_enabled();   // remember until another is picked
      }).catch(function () { /* user cancelled */ });
    } else {
      show('sfFolderPath'); $('sfFolderPath').focus();
      sf_set_status('This browser has no folder picker — type a folder path on this computer instead.');
    }
  }
  function sf_status_key() { return 'rrt_sf_status::' + (S.queue_sig || S.sf_sig || 'default'); }
  function sf_load_statuses() { try { return JSON.parse(window.localStorage.getItem(sf_status_key()) || '{}'); } catch (e) { return {}; } }
  function sf_save_statuses(map) { try { window.localStorage.setItem(sf_status_key(), JSON.stringify(map)); } catch (e) { /* private mode */ } }
  function sf_set_stage(name, level) {
    var map = sf_load_statuses(); if ((map[name] || 0) < level) { map[name] = level; sf_save_statuses(map); }
    var it = (S.queue || []).filter(function (q) { return q.name === name; })[0];
    if (it && (it.level || 0) < level) it.level = level;
    render_queue();
  }
  async function sf_dir_has(name) { try { await S.sf_dir.getFileHandle(name); return true; } catch (e) { return false; } }
  async function sf_write_to_dir(name, bytes) {
    var fh = await S.sf_dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable(); await w.write(bytes); await w.close();
  }
  function sf_get_bytes(f) {
    return fetch('/api/sf/file/' + encodeURIComponent(f.content_version_id) + '?name=' + encodeURIComponent(f.target_name), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
  }
  function sf_download_finish(saved, picks) {   // partial-aware finish (cancel or success)
    $('sfDownloadBtn').disabled = false;
    if (S.sf_cancel) {
      sf_progress(1, 1);
      sf_set_status('Download cancelled — ' + saved.length + ' of ' + picks.length + ' downloaded.', true);
      if (saved.length) sf_build_queue(saved); else sf_update_dl_enabled();
      return;
    }
    sf_build_queue(saved);
    sf_set_status('Saved ' + saved.filter(function (s) { return !s.skipped; }).length + ' file(s) to ' + (S.sf_dir ? (S.sf_dir.name || 'the folder') : $('sfFolderPath').value) + '.');
  }
  function sf_download_selected() {
    var picks = sf_selected_files();
    if (!picks.length) return;
    if (picks.length > SF_MAX_FILES) { sf_set_status('Select ' + SF_MAX_FILES + ' or fewer files to download.', true); return; }
    var strategy = $('sfStrategy').value;
    S.sf_cancel = false;
    $('sfDownloadBtn').disabled = true; sf_set_status('Downloading ' + picks.length + ' file(s)…'); sf_progress(0, picks.length);
    if (S.sf_dir) {
      (async function () {
        try {
          var ok = await sf_ensure_permission(S.sf_dir);   // re-confirm write access to the remembered folder
          if (!ok) { sf_set_status('Folder permission was not granted — choose a folder.', true); $('sfDownloadBtn').disabled = false; sf_progress(1, 1); return; }
          var t0 = Date.now(), step = Math.min(500, Math.ceil(2000 / picks.length));   // pace the bar to ~2s
          if (strategy === 'wipe_all') {
            var names = []; for await (var entry of S.sf_dir.values()) { if (entry.kind === 'file' && /\.(xlsx|xls|csv)$/i.test(entry.name)) names.push(entry.name); }
            for (var n = 0; n < names.length; n++) await S.sf_dir.removeEntry(names[n]);
          }
          var saved = [];
          for (var k = 0; k < picks.length; k++) {
            if (S.sf_cancel) break;
            var f = picks[k];
            if (strategy === 'add_new' && await sf_dir_has(f.target_name)) {
              // already in the folder: don't re-write it, but still load its bytes so it's openable
              var fh_existing = await S.sf_dir.getFileHandle(f.target_name);
              var existing_bytes = await (await fh_existing.getFile()).arrayBuffer();
              saved.push({ name: f.target_name, id: f.content_version_id, bytes: existing_bytes, f: f, skipped: true });
              sf_progress(k + 1, picks.length); await sf_delay(step); continue;
            }
            var buf = await sf_get_bytes(f); await sf_write_to_dir(f.target_name, buf);
            saved.push({ name: f.target_name, id: f.content_version_id, bytes: buf, f: f });
            sf_progress(k + 1, picks.length); await sf_delay(step);
          }
          if (!S.sf_cancel) { var rem = 2000 - (Date.now() - t0); if (rem > 0) await sf_delay(rem); }
          sf_download_finish(saved, picks);
        } catch (e) { sf_set_status('Download failed: ' + e.message, true); $('sfDownloadBtn').disabled = false; sf_progress(1, 1); }
      })();
    } else {
      var folder = $('sfFolderPath').value; S.sf_sig = 'path:' + folder;
      var t0 = Date.now(), step = Math.min(500, Math.ceil(2000 / picks.length));  // ~2s paced progress
      sf_fetch_json('/api/sf/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: folder, strategy: strategy, items: picks.map(function (f) { return { id: f.content_version_id, name: f.target_name }; }) }) })
        .then(function () {
          var out = [];
          return picks.reduce(function (chain, f, i) {
            return chain.then(function () { if (S.sf_cancel) return; return sf_get_bytes(f).then(function (b) { out.push({ name: f.target_name, id: f.content_version_id, bytes: b, f: f }); sf_progress(i + 1, picks.length); return sf_delay(step); }); });
          }, Promise.resolve()).then(function () { return out; });
        })
        .then(function (saved) {
          if (S.sf_cancel) { sf_download_finish(saved, picks); return; }
          var rem = 2000 - (Date.now() - t0);
          return (rem > 0 ? sf_delay(rem) : Promise.resolve()).then(function () { sf_download_finish(saved, picks); });
        })
        .catch(function (e) { sf_set_status('Download failed: ' + e.message, true); $('sfDownloadBtn').disabled = false; sf_progress(1, 1); });
    }
  }
  // Source-agnostic queue builder. items: [{ id, name, bytes, program?, owner?, meta? }].
  // opts: { source: 'salesforce'|'folder', dir, folder, sig } — dir/folder/sig power Reload + status memory.
  function build_queue(items, opts) {
    opts = opts || {};
    S.queue_source = opts.source || 'salesforce';
    S.queue_dir = opts.dir || null;
    S.queue_folder = opts.folder || '';
    S.queue_sig = opts.sig || S.sf_sig || ('queue:' + S.queue_source);
    var statuses = sf_load_statuses();
    S.queue = items.map(function (it) {
      return { id: it.id, name: it.name, bytes: it.bytes || null, source: S.queue_source,
        program: it.program || '', owner: it.owner || '', sanction: it.sanction || '', meta: it.meta || '', level: statuses[it.name] || 0 };
    });
    hide('uploadCard'); hide('introCard'); hide('sfCard'); if ($('folderCard')) hide('folderCard'); show('clearBtn');
    show('compareCard'); show('filesTab'); set_compare_view('files'); render_queue();
    $('compareCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Salesforce wrapper: map downloaded files into the generic queue.
  function sf_build_queue(saved) {
    build_queue(saved.map(function (s) { return { id: s.id, name: s.name, bytes: s.bytes || null, program: s.f.program_name, owner: s.f.owner_name, sanction: s.f.sanction_id }; }),
      { source: 'salesforce', dir: S.sf_dir, folder: S.sf_folder || ($('sfFolderPath') && $('sfFolderPath').value) || '', sig: S.sf_sig });
  }
  function sf_stage_html(label, on) { return '<span class="sf-q-stage' + (on ? ' done' : '') + '"><span class="dot"></span>' + label + '</span>'; }
  function queue_cmp_val(it, key) {
    if (key === 'program') return it.program || '';
    if (key === 'owner') return it.owner || '';
    if (key === 'meta') return it.meta || '';
    if (key === 'status') return it.level || 0;
    return it.name || '';
  }
  function queue_sorted_indexes() {
    var q = S.queue || [];
    var order = q.map(function (it, i) { return i; });
    var s = S.queue_sort;
    if (s && s.key) {
      var dir = (s.dir === 'asc') ? 1 : -1;
      order.sort(function (ia, ib) {
        var c = sort.compare_text(queue_cmp_val(q[ia], s.key), queue_cmp_val(q[ib], s.key));  // reuse src/sort.js
        return c !== 0 ? c * dir : (ia - ib);
      });
    }
    return order;
  }
  function render_queue() {
    var box = $('sfQueue'); if (!box) return;
    var q = S.queue || [];
    if (!q.length) { box.innerHTML = '<p class="dim">No files yet.</p>'; return; }
    var s = S.queue_sort || {};
    function head(key, label) {
      var arrow = (s.key === key) ? (s.dir === 'asc' ? '▲' : '▼') : '';
      return '<th class="sf-sort" data-qsort="' + key + '">' + label + ' <span class="sf-arrow">' + arrow + '</span></th>';
    }
    var can_reload = sf_can_reload();
    var is_folder = S.queue_source === 'folder';   // local-folder queue: Program/Owner don't apply
    var body = queue_sorted_indexes().map(function (idx, di) {
      var it = q[idx];
      var active = (S.active_queue_id === it.id) ? ' active' : '';
      var dis = it.bytes ? '' : ' sf-q-disabled';
      var title = it.bytes ? '' : ' title="Re-download to open (file bytes are not kept after a page refresh)"';
      var reload = can_reload
        ? '<button type="button" class="sf-q-reload" data-i="' + idx + '" title="Reload this file from the folder — picks up edits you made in Excel (clears Downloaded)">↻</button>'
        : '';
      var file_cell = '<td class="sf-q-file" title="' + esc(it.name) + '">' + esc(it.name) + (sf_file_ext(it) === 'xls' ? ' <span class="sf-xls-tag" title="Legacy .xls — re-save as .xlsx">xls</span>' : '') + '</td>';
      var lead = is_folder
        ? file_cell + '<td>' + esc(it.meta || '') + '</td>'
        : '<td>' + esc(it.program || 'No program') + '</td><td>' + esc(it.owner || 'No owner') + '</td>' + file_cell;
      return '<tr class="sf-q-trow' + active + dis + '" data-i="' + idx + '" role="button" tabindex="0"' + title + '>' +
        '<td class="sf-rn">' + (di + 1) + '</td>' + lead +
        '<td><span class="sf-q-stages">' + sf_stage_html('Uploaded', it.level >= 1) + sf_stage_html('Converted', it.level >= 2) + sf_stage_html('Downloaded', it.level >= 3) + '</span></td>' +
        '<td class="sf-q-act">' + reload + '</td></tr>';
    }).join('');
    var heads = is_folder
      ? head('file', 'File name') + head('meta', 'Modified')
      : head('program', 'Program') + head('owner', 'Owner') + head('file', 'File name');
    box.innerHTML = '<div class="sf-table-wrap sf-q-wrap"><table class="sf-table sf-q-table"><thead><tr>' +
      '<th class="sf-rn">#</th>' + heads + head('status', 'Status') + '<th class="sf-q-act" aria-label="Reload"></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function queue_sort_by(key) {
    S.queue_sort = sf_toggle_sort(S.queue_sort, key, key === 'status' ? 'desc' : 'asc');
    render_queue();
  }
  function open_queue_row(target) {
    if (!target || !target.closest) return;
    var rl = target.closest('.sf-q-reload');
    if (rl) { sf_reload_file(+rl.dataset.i); return; }   // reload button: don't open
    var th = target.closest('th.sf-sort');
    if (th) { queue_sort_by(th.dataset.qsort); return; }
    var row = target.closest('.sf-q-trow');
    if (!row || row.classList.contains('sf-q-disabled')) return;
    open_queue_file(+row.dataset.i);
  }
  function open_queue_file(idx) {
    var it = (S.queue || [])[idx]; if (!it || !it.bytes) return;
    S.source = it.source || S.queue_source || 'salesforce'; S.is_demo = false; S.active_queue_id = it.id;
    S.active_sanction = it.sanction || '';                                                // surfaced as a summary-bar readout
    // The Sanction ID is only known for Salesforce files. Set it from the file when present; for a
    // folder file (no sanction) blank it so a previous SF file's id can't carry over into this download.
    S.dl_fields = Object.assign({}, S.dl_fields, { id: it.sanction || '' });
    S.file_name = it.name.replace(/\.(xlsx|xls|csv)$/i, ''); S.file_display = it.name;
    var m = um(); if (m) m.new_upload();
    if ((it.level || 0) < SF_STAGE.UPLOADED) track('file_uploaded', { file_name: it.name, file_type: /\.csv$/i.test(it.name) ? 'csv' : 'xlsx', size_bytes: it.bytes.byteLength || null });
    sf_set_stage(it.name, SF_STAGE.UPLOADED);
    var is_csv = /\.csv$/i.test(it.name);
    var p = is_csv ? Promise.resolve([io.csv_to_ir(new TextDecoder().decode(it.bytes))]) : read_spreadsheet(it.name, it.bytes);
    p.then(function (irs) { on_workbook(irs); sf_set_stage(it.name, SF_STAGE.CONVERTED); })
     .catch(function (e) { track('error', { error_type: 'unreadable_file' }); alert(unreadable_message(it.name, e)); });
  }
  // Is the queue's source folder available to re-read from? A directory handle (Chrome/Edge, either
  // source) or — for the Salesforce server-folder fallback only — a folder path.
  function sf_can_reload() {
    return !!(S.queue_dir || (S.queue_source === 'salesforce' && (S.queue_folder || ($('sfFolderPath') && $('sfFolderPath').value))));
  }
  // Re-read a queue file's CURRENT bytes from disk (picks up edits made in Excel), then re-run the
  // pipeline. Resets that row's status — Converted re-runs and Downloaded clears (the prior download
  // is now stale). Works via the folder handle (Chrome/Edge) or the SF server-folder fallback endpoint.
  function sf_reload_file(idx) {
    var it = (S.queue || [])[idx]; if (!it) return;
    var fresh;
    if (S.queue_dir) {
      fresh = (async function () {
        var ok = await sf_ensure_permission(S.queue_dir);
        if (!ok) throw new Error('folder permission not granted');
        var fh = await S.queue_dir.getFileHandle(it.name);
        return (await fh.getFile()).arrayBuffer();
      })();
    } else {
      var folder = S.queue_folder || ($('sfFolderPath') && $('sfFolderPath').value) || '';
      fresh = fetch('/api/sf/folder-file?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(it.name), { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
    }
    fresh.then(function (buf) {
      it.bytes = buf;
      // drop the row back to Uploaded so Converted re-runs + Downloaded clears (sf_set_stage only
      // raises, so lower it directly here). Staying at Uploaded avoids re-firing file_uploaded.
      var map = sf_load_statuses(); map[it.name] = SF_STAGE.UPLOADED; sf_save_statuses(map); it.level = SF_STAGE.UPLOADED;
      open_queue_file(idx);   // re-runs pipeline -> Converted (Downloaded cleared)
    }).catch(function (e) { alert('Could not reload "' + it.name + '" from disk: ' + e.message); });
  }
  function wire_sf() {
    if (!$('sfCard')) return;
    // Reflect the real session state on the Sign in/out button after a refresh (mx_session is httpOnly,
    // so we ask the server instead of reading the cookie).
    fetch('/api/auth-status', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { sf_set_authed(!!(j && j.authed)); }).catch(function () {});
    // default span = yesterday → today; bounded to SF_MIN_DATE..today, max 14-day span
    if ($('sfFrom') && !$('sfFrom').value) { $('sfFrom').value = sf_yesterday(); $('sfTo').value = sf_today(); }
    sf_apply_range_limits();
    // bind both change + input: 'change' fires on commit/blur, 'input' clamps immediately as a
    // valid date is entered (and is what WebKit reliably emits when a date is set programmatically)
    ['change', 'input'].forEach(function (ev) {
      if ($('sfFrom')) $('sfFrom').addEventListener(ev, sf_apply_range_limits);
      if ($('sfTo')) $('sfTo').addEventListener(ev, sf_apply_range_limits);
    });
    if ($('sfAnyDate')) $('sfAnyDate').addEventListener('change', sf_toggle_anydate);
    if ($('sfListBtn')) $('sfListBtn').addEventListener('click', sf_list);
    if ($('sfResetBtn')) $('sfResetBtn').addEventListener('click', sf_reset);
    if ($('sfSourceSeg')) $('sfSourceSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-src]'); if (b) sf_set_source(b.dataset.src); });
    if ($('sfEmailStatus')) $('sfEmailStatus').addEventListener('change', function () { if (S.sf_files) sf_list(); });
    if ($('sfLoginBtn')) $('sfLoginBtn').addEventListener('click', sf_login);
    if ($('sfLoginPass')) $('sfLoginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') sf_login(); });
    if ($('sfLoginShow')) $('sfLoginShow').addEventListener('click', function () {
      var p = $('sfLoginPass'), b = $('sfLoginShow'), reveal = p.type === 'password';
      p.type = reveal ? 'text' : 'password'; b.textContent = reveal ? 'hide' : 'show'; b.setAttribute('aria-pressed', reveal ? 'true' : 'false'); p.focus();
    });
    if ($('sfCancelBtn')) $('sfCancelBtn').addEventListener('click', function () { S.sf_cancel = true; sf_set_status('Cancelling…'); });
    if ($('sfLogoutBtn')) $('sfLogoutBtn').addEventListener('click', sf_toggle_auth);
    if ($('sfChooseFolder')) $('sfChooseFolder').addEventListener('click', sf_choose_folder);
    if ($('sfDownloadBtn')) $('sfDownloadBtn').addEventListener('click', sf_download_selected);
    if ($('sfFolderPath')) $('sfFolderPath').addEventListener('input', function () { S.sf_folder = $('sfFolderPath').value; try { window.localStorage.setItem('rrt_sf_folder', S.sf_folder); } catch (e) { /* ignore */ } sf_update_dl_enabled(); });
    if ($('sfSearch')) $('sfSearch').addEventListener('input', sf_render);
    if ($('sfLimit')) $('sfLimit').addEventListener('change', sf_apply_limit);
    var table = $('sfTable');
    if (table) {
      table.addEventListener('change', function (e) {
        var vis = sf_visible();
        if (e.target.id === 'sfCheckAll') {
          var on = e.target.checked;
          vis.forEach(function (f) { if (on) S.sf_selected[f.content_version_id] = true; else delete S.sf_selected[f.content_version_id]; });
          table.querySelectorAll('.sf-pick').forEach(function (c) { c.checked = on; });
        } else if (e.target.classList.contains('sf-pick')) {
          var id = e.target.dataset.id;
          if (e.target.checked) S.sf_selected[id] = true; else delete S.sf_selected[id];
          $('sfCheckAll').checked = vis.length > 0 && vis.every(function (f) { return S.sf_selected[f.content_version_id]; });
        }
        sf_update_count(); sf_update_dl_enabled();
      });
      var thead = table.querySelector('thead');
      if (thead) thead.addEventListener('click', function (e) {
        var th = e.target.closest('th.sf-sort'); if (!th) return;
        var key = th.dataset.sort;
        S.sf_sort = sf_toggle_sort(S.sf_sort, key, key === 'date' ? 'desc' : 'asc');
        sf_sort_and_render();
      });
    }
    var queue = $('sfQueue');
    if (queue) {
      queue.addEventListener('click', function (e) { open_queue_row(e.target); });
      queue.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open_queue_row(e.target); } });
    }
    sf_restore_folder();   // bring back the last-used folder
  }

  // ---------- local-folder intake: pick a folder -> choose files -> the Files queue ----------
  function folder_is_spreadsheet(name) { return /\.(xlsx|xls|csv)$/i.test(name || ''); }
  function folder_ext(f) { var n = (f && f.name) || ''; return n.indexOf('.') >= 0 ? n.split('.').pop().toLowerCase() : ''; }
  function folder_fmt_modified(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }
  function folder_set_status(msg, err) { var el = $('folderStatus'); if (!el) return; el.textContent = msg || ''; el.classList.toggle('err', !!err); }
  function folder_set_files(files, dir, name) {
    S.folder_files = files; S.folder_dir = dir || null; S.folder_name = name || '';
    S.folder_selected = {}; files.forEach(function (f) { S.folder_selected[f.name] = true; });
    if ($('folderName')) $('folderName').textContent = name ? ('Folder: ' + name) : '';
    if (!files.length) {
      folder_set_status('No spreadsheet files (.xlsx / .xls / .csv) in that folder.', true);
      hide('folderTableWrap'); hide('folderSearchWrap'); hide('folderLoadBar'); $('folderCount').classList.add('hidden');
      return;
    }
    folder_set_status(''); folder_render();
  }
  // Chrome/Edge: showDirectoryPicker → dir handle (enables Reload). Else: a webkitdirectory input.
  function folder_choose() {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker({ mode: 'read' }).then(async function (dir) {
        var name = dir.name || 'folder';
        folder_set_status('Reading “' + name + '” …');
        var out = [], total = 0, subdirs = 0;
        for await (var entry of dir.values()) {
          total++;
          if (entry.kind === 'directory') { subdirs++; continue; }   // top-level files only
          if (!folder_is_spreadsheet(entry.name)) continue;
          // list the file from its name+handle; read getFile() metadata best-effort so a OneDrive/
          // cloud "files on demand" placeholder (where getFile can fail/lag) is still listed and loadable.
          var item = { name: entry.name, handle: entry };
          try { var f = await entry.getFile(); item.size = f.size; item.modified = f.lastModified; } catch (e) { /* keep it anyway */ }
          out.push(item);
        }
        out.sort(function (a, b) { return sort.compare_text(a.name, b.name); });   // reuse src/sort.js
        folder_set_files(out, dir, name);
        if (!out.length) {
          var bits = [];
          if (subdirs) bits.push(subdirs + ' subfolder(s) — this reads top-level files only');
          if (total - subdirs) bits.push((total - subdirs) + ' non-spreadsheet file(s)');
          folder_set_status('No .xlsx / .xls / .csv files at the top level of “' + name + '”' + (bits.length ? ' (found ' + bits.join(', ') + ')' : '') + '.', true);
        }
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;   // user cancelled the picker
        folder_set_status('Could not read that folder: ' + ((e && e.message) || e), true);
      });
    } else {
      $('folderInput').click();
    }
  }
  // Fallback: a <input webkitdirectory> File list. Keep TOP-LEVEL files only (rel = "folder/file").
  function folder_from_input(file_list) {
    var files = [], top = null;
    Array.prototype.slice.call(file_list || []).forEach(function (f) {
      var rel = f.webkitRelativePath || f.name, parts = rel.split('/');
      if (parts.length > 1) top = parts[0];
      if (parts.length > 2) return;                 // a subfolder file — skip (top-level only)
      if (!folder_is_spreadsheet(f.name)) return;
      files.push({ name: f.name, file: f, size: f.size, modified: f.lastModified });
    });
    files.sort(function (a, b) { return sort.compare_text(a.name, b.name); });
    folder_set_files(files, null, top || '(folder)');   // no dir handle in the fallback → no Reload
  }
  function folder_visible() {
    var q = (($('folderSearch') && $('folderSearch').value) || '').toLowerCase().trim();
    var all = S.folder_files || [];
    if (!q) return all;
    return all.filter(function (f) { return (f.name + ' ' + folder_ext(f)).toLowerCase().indexOf(q) >= 0; });
  }
  function folder_selected_files() { return (S.folder_files || []).filter(function (f) { return S.folder_selected[f.name]; }); }
  function folder_update_count() {
    var total = (S.folder_files || []).length, sel = folder_selected_files().length, vis = folder_visible().length;
    var el = $('folderCount'); if (!el) return;
    el.classList.toggle('hidden', total === 0);
    var showing = (vis < total) ? (' · showing <b>' + vis + '</b>') : '';
    el.innerHTML = '<b>' + total + '</b> file(s) found' + showing + ' · <b>' + sel + '</b> selected';
    var btn = $('folderLoadBtn'); if (btn) { btn.disabled = !sel; btn.textContent = sel ? ('Load ' + sel + ' file' + (sel > 1 ? 's' : '')) : 'Load files'; }
  }
  function folder_render() {
    var vis = folder_visible();
    $('folderTable').querySelector('tbody').innerHTML = vis.map(function (f) {
      var checked = S.folder_selected[f.name] ? ' checked' : '';
      return '<tr><td><input type="checkbox" class="folder-pick" data-name="' + esc(f.name) + '" aria-label="Select file"' + checked + '></td>' +
        '<td title="' + esc(f.name) + '">' + esc(f.name) + '</td>' +
        '<td>' + esc(folder_ext(f) || '?') + '</td>' +
        '<td class="dim">' + esc(folder_fmt_modified(f.modified)) + '</td></tr>';
    }).join('');
    $('folderCheckAll').checked = vis.length > 0 && vis.every(function (f) { return S.folder_selected[f.name]; });
    show('folderTableWrap'); show('folderSearchWrap'); show('folderLoadBar');
    folder_update_count();
  }
  function folder_read_bytes(f) {
    if (f.handle) return f.handle.getFile().then(function (file) { return file.arrayBuffer(); });
    if (f.file) return f.file.arrayBuffer();
    return Promise.reject(new Error('no file source'));
  }
  function folder_load() {
    var picks = folder_selected_files();
    if (!picks.length) return;
    folder_set_status('Loading ' + picks.length + ' file(s)…');
    Promise.all(picks.map(function (f) {
      return folder_read_bytes(f).then(function (buf) { return { id: f.name, name: f.name, bytes: buf, meta: folder_fmt_modified(f.modified) }; });
    })).then(function (items) {
      build_queue(items, { source: 'folder', dir: S.folder_dir, folder: S.folder_name, sig: 'folder:' + (S.folder_name || 'default') });
    }).catch(function (e) { folder_set_status('Could not read files: ' + e.message, true); });
  }
  function folder_reset() {
    S.folder_files = null; S.folder_selected = {};
    if ($('folderTable')) $('folderTable').querySelector('tbody').innerHTML = '';
    if ($('folderSearch')) $('folderSearch').value = '';
    hide('folderTableWrap'); hide('folderSearchWrap'); hide('folderLoadBar'); if ($('folderCount')) $('folderCount').classList.add('hidden');
    folder_set_status('');
  }
  function wire_folder() {
    if (!$('folderCard')) return;
    if ($('folderChooseBtn')) $('folderChooseBtn').addEventListener('click', folder_choose);
    if ($('folderInput')) $('folderInput').addEventListener('change', function () { folder_from_input($('folderInput').files); });
    if ($('folderResetBtn')) $('folderResetBtn').addEventListener('click', folder_reset);
    if ($('folderSearch')) $('folderSearch').addEventListener('input', folder_render);
    if ($('folderLoadBtn')) $('folderLoadBtn').addEventListener('click', folder_load);
    if ($('folderCheckAll')) $('folderCheckAll').addEventListener('change', function () {
      var on = $('folderCheckAll').checked; folder_visible().forEach(function (f) { S.folder_selected[f.name] = on; }); folder_render();
    });
    if ($('folderTable')) $('folderTable').addEventListener('change', function (e) {
      var cb = e.target.closest && e.target.closest('.folder-pick'); if (!cb) return;
      S.folder_selected[cb.dataset.name] = cb.checked; folder_update_count();
    });
  }

  // Build a per-sheet state bundle (one per worksheet / the single CSV).
  function make_bundle(ir) {
    var parsed = parse.detect_table(ir, { score_header: match.score_headers });
    var sig = mapper.header_signature(parsed.headers);
    var b = { name: ir.sheet_name, ir: ir, parsed: parsed, sig: sig,
      value_overrides: {}, vm_expanded: {}, approved: {}, excluded: {}, computed: false,
      mapping: null, used_profile: false, result: null, report: null, work_rows: null };
    var prof = S.store.get(sig);
    if (prof && prof.mapping) {
      b.mapping = mapper.text_to_mapping(prof.mapping, parsed.headers);
      b.value_overrides = prof.value_overrides || {}; b.used_profile = true;
    } else { b.mapping = match.auto_map(parsed.headers).mapping; }
    return b;
  }

  function on_workbook(irs) {
    S.sheets = irs.map(make_bundle);
    S.active = null; S.first_render = true;
    render_sheet_bar();
    hide('uploadCard'); hide('introCard'); hide('sfCard'); if ($('folderCard')) hide('folderCard'); show('clearBtn');
    if (S.is_demo) show('demoBadge'); else hide('demoBadge');
    activate_sheet(0);
    track('conversion_completed', conversion_props());
    $('summaryBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Compute a bundle's converted output without disturbing the active S.* view.
  function compute_bundle(b) {
    if (b.computed) return;
    var res = transform.run(b.parsed, b.mapping, { value_overrides: b.value_overrides });
    b.result = res;
    b.report = reconcile.build(b.parsed, b.mapping, res);
    b.work_rows = res.rows.map(function (r) { return r.slice(); });
    b.computed = true;
  }

  // Persist the live S.* working fields back into the active bundle.
  function save_active() {
    if (S.active == null || !S.sheets || !S.sheets[S.active]) return;
    var b = S.sheets[S.active];
    b.mapping = S.mapping; b.value_overrides = S.value_overrides; b.vm_expanded = S.vm_expanded;
    b.approved = S.approved; b.excluded = S.excluded; b.result = S.result; b.report = S.report; b.work_rows = S.work_rows;
    b.computed = true;
  }

  function activate_sheet(i) {
    if (i === S.active) return;
    save_active();
    var b = S.sheets && S.sheets[i]; if (!b) return;
    S.active = i;
    S.ir = b.ir; S.parsed = b.parsed; S.sig = b.sig; S.mapping = b.mapping;
    S.value_overrides = b.value_overrides; S.vm_expanded = b.vm_expanded; S.approved = b.approved; S.excluded = b.excluded || {};
    show_profile_bar(b.used_profile);
    if (!b.computed) { compute(); b.result = S.result; b.report = S.report; b.work_rows = S.work_rows; b.computed = true; }
    else { S.result = b.result; S.report = b.report; S.work_rows = b.work_rows; S.flag_info = build_flag_info(); }
    render_all(S.first_render);
    S.first_render = false;
    update_sheet_bar();
  }

  function render_sheet_bar() {
    var bar = $('sheetBar'); if (!bar) return;
    if (!S.sheets || S.sheets.length < 2) { hide('sheetBar'); bar.innerHTML = ''; return; }
    var tabs = S.sheets.map(function (b, i) {
      return '<button class="sheet-tab" data-i="' + i + '" title="' + esc(b.name) + '">' +
        esc(b.name) + ' <span class="dim">(' + b.parsed.data_rows.length + ')</span></button>';
    }).join('');
    bar.innerHTML = '<div class="sheet-note">\uD83D\uDCD1 This workbook has <b>' + S.sheets.length +
      '</b> sheets — each is converted separately and saved as its own sheet when you download.</div>' +
      '<div class="sheet-tabs">' + tabs + '</div>';
    show('sheetBar');
    bar.querySelectorAll('.sheet-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { activate_sheet(+btn.dataset.i); });
    });
    update_sheet_bar();
  }
  function update_sheet_bar() {
    var bar = $('sheetBar'); if (!bar) return;
    bar.querySelectorAll('.sheet-tab').forEach(function (btn) { btn.classList.toggle('active', +btn.dataset.i === S.active); });
  }

  function clear_all() {
    track('start_over', {});
    S.is_demo = false;
    S.source = null;
    S.active_sanction = '';
    S.dl_fields = Object.assign({}, S.dl_fields, { id: '' });   // sanction is SF-only; don't carry it past Start over
    S.ir = S.parsed = S.mapping = S.result = S.report = S.work_rows = null;
    S.value_overrides = {}; S.vm_expanded = {}; S.approved = {}; S.excluded = {}; S.orig_table = S.conv_table = null;
    S.sheets = null; S.active = null; S.first_render = true;
    S.queue = null; S.queue_sort = { key: null, dir: 'asc' }; S.active_queue_id = null;
    S.queue_source = 'salesforce'; S.queue_dir = null; S.queue_folder = ''; S.queue_sig = null;
    if ($('sfTable')) sf_reset();   // clear the SF list/status/count/search (keeps the remembered folder)
    if ($('folderTable')) folder_reset();   // clear the local-folder list (keeps the remembered folder)
    $('fileInput').value = '';
    ['summaryBar', 'compareCard', 'profileBar', 'clearBtn', 'flagLegend', 'sheetBar', 'demoBadge', 'filesTab'].forEach(hide);
    show('uploadCard'); show('introCard'); show('sfCard'); if ($('folderCard')) show('folderCard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function show_profile_bar(loaded) {
    var bar = $('profileBar');
    if (!loaded) { hide('profileBar'); bar.innerHTML = ''; return; }
    show('profileBar');
    bar.innerHTML = '<span>✓ Applied a saved mapping for this file layout.</span><button class="btn ghost sm" id="forget_profile">Forget &amp; auto-match</button>';
    $('forget_profile').addEventListener('click', function () {
      S.store.remove(S.sig); S.mapping = match.auto_map(S.parsed.headers).mapping;
      S.value_overrides = {}; show_profile_bar(false); recompute(false);
    });
  }

  // ---------- flag bookkeeping + approve ----------
  function build_flag_info() {
    var key_index = {}; schema.TEMPLATE_SCHEMA.forEach(function (c, i) { key_index[c.key] = i; });
    var cell = {}, rows = {}, codes = {}, code_rows = {}, total = 0;
    S.result.flags.forEach(function (f) {
      if (S.approved[f.row + '|' + f.key]) return;
      cell[f.row + ',' + key_index[f.key]] = flag_label(f.code);
      rows[f.row] = true; codes[f.code] = (codes[f.code] || 0) + 1; total++;
      (code_rows[f.code] = code_rows[f.code] || {})[f.row] = true;
    });
    return {
      get: function (i, c) { return cell[i + ',' + c] || null; },
      rows: rows, codes: codes, code_rows: code_rows, total: total, row_count: Object.keys(rows).length
    };
  }
  function refresh_flags() {
    S.flag_info = build_flag_info();
    S.conv_table.get_flag = S.flag_info.get; S.conv_table.flagged_rows = S.flag_info.rows;
    S.conv_table.render_body(); render_legend(); render_summary();
  }
  function approve_by_code(code) { S.result.flags.forEach(function (f) { if (f.code === code) S.approved[f.row + '|' + f.key] = true; }); refresh_flags(); }
  function approve_all() { S.result.flags.forEach(function (f) { S.approved[f.row + '|' + f.key] = true; }); refresh_flags(); }
  function unapprove_all() { S.approved = {}; refresh_flags(); }

  var _lr;
  function on_conv_edit(i, c, td) {
    var key = i + '|' + schema.TEMPLATE_SCHEMA[c].key;
    if (!S.approved[key] && S.flag_info.get(i, c)) {
      S.approved[key] = true;
      td.classList.remove('flag'); td.removeAttribute('title'); td.classList.add('approved');
      clearTimeout(_lr);
      _lr = setTimeout(function () {
        S.flag_info = build_flag_info();
        S.conv_table.get_flag = S.flag_info.get; S.conv_table.flagged_rows = S.flag_info.rows;
        render_legend(); render_summary();
      }, 350);
    }
  }

  // ---------- recompute ----------
  function compute() {
    S.result = transform.run(S.parsed, S.mapping, { value_overrides: S.value_overrides });
    S.report = reconcile.build(S.parsed, S.mapping, S.result);
    S.work_rows = S.result.rows.map(function (r) { return r.slice(); });
    S.flag_info = build_flag_info();
  }
  function render_all(first_time) {
    render_summary(); render_compare(first_time); render_scorecard(); render_mapping(); render_integrity();
    ['summaryBar', 'compareCard'].forEach(show);
    if (first_time) apply_collapse_defaults();
  }
  function recompute(first_time) { compute(); render_all(first_time); }

  function render_summary() {
    var sc = S.report.scorecard, rep = S.report, n = function (x) { return x.toLocaleString(); };
    var skip = rep.rows.skipped.length, flagged = S.flag_info ? S.flag_info.total : rep.flag_count;
    var nex = 0; if (S.excluded) for (var ek in S.excluded) if (S.excluded[ek]) nex++;   // user-deleted rows
    var kept_out = Math.max(0, rep.rows.out - nex);   // rows actually written to the download
    $('summaryBar').innerHTML =
      '<span class="score-badge ' + sc.band + '">' + sc.pct + '%</span>' +
      '<span class="verdict">' + esc(sc.verdict) + '</span>' +
      '<span class="chips">' +
        '<span class="chip filechip" title="Uploaded file">📄 ' + esc(S.file_display || S.file_name) + '</span>' +
        ((S.source === 'salesforce' && S.active_sanction) ? '<span class="chip sanctionchip" title="Salesforce Sanctioning ID (Program.cfg_Id__c) — leads the download filename">🏷 Sanction <b>' + esc(S.active_sanction) + '</b></span>' : '') +
        '<span class="chip" title="Athlete rows written to the converted file"><b>' + n(kept_out) + '</b> rows</span>' +
        (nex > 0 ? '<span class="chip chip-del" title="Rows you deleted — left out of the download. Restore them from the original table."><b>' + n(nex) + '</b> deleted</span>' : '') +
        '<span class="chip" title="Highlighted cells still needing a look — approve or edit them to clear"><b>' + n(flagged) + '</b> flagged values</span>' +
        (skip
          ? '<button class="chip chip-btn" id="skip_chip" title="Section-header & blank rows excluded — click to view"><b>' + n(skip) + '</b> rows skipped ›</button>'
          : '<span class="chip">no rows skipped</span>') +
      '</span>';
    if (skip) $('skip_chip').addEventListener('click', reveal_skipped);
  }
  function reveal_skipped() {
    set_compare_view('integrity');
    var p = prefs(); p.compare_view = 'integrity'; save_prefs(p);
    var det = $('integrityBody').querySelector('.skip-details'); if (det) det.open = true;
    $('compareCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- row delete (original table) — soft-exclude, reversible, in-session ----------
  // Deleted rows are hidden from BOTH tables and left out of the download, but the transform still
  // runs on the full data (indices stay stable, so edits/overrides/approvals keep working). Restore
  // brings them all back. Stored per-sheet in S.excluded (mirrored into the active bundle).
  function delete_orig_rows(indices) {
    if (!indices || !indices.length) return;
    if (indices.length > 1 && !window.confirm('Delete ' + indices.length + ' row(s) from the converted output? You can Restore them.')) return;
    indices.forEach(function (i) { S.excluded[i] = true; });
    apply_excluded();
  }
  function restore_orig_rows() { Object.keys(S.excluded).forEach(function (k) { delete S.excluded[k]; }); apply_excluded(); }
  function excluded_n() { var n = 0; for (var k in S.excluded) if (S.excluded[k]) n++; return n; }
  // Delete/Restore live in the ORIGINAL pane-head (next to "Original file") — NOT in the table toolbar —
  // so both table toolbars keep the same height and the two grids stay aligned side by side.
  function render_orig_del() {
    var el = $('origDelCtl'); if (!el || !S.orig_table) return;
    var shown = S.orig_table.visible_keys().length, nex = excluded_n();
    el.innerHTML =
      '<button type="button" class="btn sm orig-del-btn" id="origDelShown"' + (shown ? '' : ' disabled') +
        ' title="Delete the rows currently shown (search first to delete a subset). Removed from the converted output and the download — Restore brings them back.">🗑 Delete ' + shown + '</button>' +
      (nex > 0 ? '<button type="button" class="btn sm orig-restore-btn" id="origRestore" title="Bring back the rows you deleted">↩ Restore ' + nex + '</button>' : '');
    var ds = $('origDelShown'); if (ds) ds.addEventListener('click', function () { delete_orig_rows(S.orig_table.visible_keys()); });
    var rs = $('origRestore'); if (rs) rs.addEventListener('click', restore_orig_rows);
  }
  function apply_excluded() {
    if (S.conv_table) S.conv_table.set_excluded(S.excluded);
    if (S.orig_table) S.orig_table.set_excluded(S.excluded);   // triggers render -> on_render -> render_orig_del
    render_summary();
  }

  // ---------- compare ----------
  function grid_scroll_pos(id) { var c = $(id), e = c && c.querySelector('.grid-scroll'); return e ? { l: e.scrollLeft, t: e.scrollTop } : null; }
  function grid_scroll_set(id, pos) { if (!pos) return; var c = $(id), e = c && c.querySelector('.grid-scroll'); if (e) { e.scrollLeft = pos.l; e.scrollTop = pos.t; } }
  function render_compare(first_time) {
    var keep_orig = grid_scroll_pos('originalGrid'), keep_conv = grid_scroll_pos('resultGrid');
    var orig_rows = S.parsed.data_rows.map(function (d) { return d.cells; });
    if (!S.orig_table) S.orig_table = TableView($('originalGrid'), { top_header: true,
      deletable: true, on_delete: delete_orig_rows, on_render: render_orig_del });
    S.orig_table.set_data(S.parsed.headers, orig_rows);
    S.orig_table.set_excluded(S.excluded);   // hide user-deleted rows (search → delete a subset, reversible)
    $('originalMeta').textContent = S.parsed.data_rows.length + ' rows · ' + S.parsed.headers.length + ' cols';

    if (!S.conv_table) {
      S.conv_table = TableView($('resultGrid'), {
        editable: true, show_flag_filter: true, col_menu: true, top_header: true,
        current_source: function (c) { var m = S.mapping[schema.TEMPLATE_SCHEMA[c].key]; return m && m.source; },
        on_remap: function (c, val) { mapper.set_mapping(S.mapping, schema.TEMPLATE_SCHEMA[c].key, val, S.parsed.headers); track('manual_remap', { target_key: schema.TEMPLATE_SCHEMA[c].key }); recompute(false); },
        on_edit: on_conv_edit
      });
    }
    S.conv_table.source_headers = S.parsed.headers;
    S.conv_table.get_flag = S.flag_info.get; S.conv_table.flagged_rows = S.flag_info.rows;
    S.conv_table.set_data(S.result.headers, S.work_rows);
    S.conv_table.set_excluded(S.excluded);   // converted side mirrors the deletions so the two tables stay aligned
    $('resultMeta').textContent = S.result.row_count + ' rows · 12 cols';

    S.orig_table.on_search = function (q) { if (S.link_tables) S.conv_table.set_query(q); };
    S.conv_table.on_search = function (q) { if (S.link_tables) S.orig_table.set_query(q); };
    S.orig_table.on_sort = function (o) { if (S.link_tables) S.conv_table.set_order(o); };
    S.conv_table.on_sort = function (o) { if (S.link_tables) S.orig_table.set_order(o); };
    S.orig_table.on_filter = function (set, label) { if (S.link_tables) S.conv_table.set_filter_quiet(set, label); };
    S.conv_table.on_filter = function (set, label) { if (S.link_tables) S.orig_table.set_filter_quiet(set, label); };
    render_legend();
    sync_scroll();
    grid_scroll_set('originalGrid', keep_orig); grid_scroll_set('resultGrid', keep_conv);
    if (first_time) apply_layout(get_pref('layout') || 'side', get_pref('tab') || 'original');
  }

  function render_legend() {
    var fi = S.flag_info, leg = $('flagLegend');
    var codes = Object.keys(fi.codes);
    var had_flags = S.result.flags.length > 0;
    if (!codes.length) {
      leg.className = 'flag-legend allclear';
      leg.innerHTML = '<span class="lead">✓ All values reviewed — nothing left flagged. Ready to download.</span>' +
        (had_flags ? '<button class="btn sm" id="approve_toggle">↩ Unapprove all</button>' : '');
      show('flagLegend');
      if (had_flags) $('approve_toggle').addEventListener('click', unapprove_all);
      return;
    }
    leg.className = 'flag-legend';
    codes.sort(function (a, b) { return fi.codes[b] - fi.codes[a]; });
    var items = codes.map(function (cd) {
      return '<li><span class="swatch"></span><span class="leg-txt"><b>' + fi.codes[cd] + '</b> · ' + esc(flag_label(cd)) + '</span>' +
        '<button class="btn sm show-code" data-code="' + esc(cd) + '" title="Show only the rows with this highlight">🔍 Show rows</button>' +
        '<button class="btn sm ok" data-code="' + esc(cd) + '">✓ Approve ' + fi.codes[cd] + '</button></li>';
    }).join('');
    var approved_some = fi.total < S.result.flags.length;
    leg.innerHTML =
      '<div class="leg-head"><button class="leg-collapse" title="Collapse / expand highlights" aria-label="Collapse highlights">▾</button><span class="lead">Highlighted (yellow) cells are values the tool changed or guessed — hover one to see why. ' +
      '<b>' + fi.total + '</b> value' + (fi.total === 1 ? '' : 's') + ' in <b>' + fi.row_count + '</b> row' + (fi.row_count === 1 ? '' : 's') + ' to review.</span>' +
      '<div class="leg-actions"><button class="btn sm primary" id="approve_all">✓ Approve all</button>' +
      (approved_some ? '<button class="btn sm" id="approve_toggle">↩ Unapprove all</button>' : '') + '</div></div>' +
      '<p class="dim leg-hint">Click a green <b>✓ Approve</b> button to accept all of that kind — or edit a highlighted cell to accept just that one. Both drop the count toward zero.</p>' +
      '<ul>' + items + '</ul>';
    show('flagLegend');
    $('approve_all').addEventListener('click', approve_all);
    if (approved_some) $('approve_toggle').addEventListener('click', unapprove_all);
    leg.querySelectorAll('.ok').forEach(function (b) { b.addEventListener('click', function () { approve_by_code(b.dataset.code); }); });
    leg.querySelectorAll('.show-code').forEach(function (b) { b.addEventListener('click', function () { filter_by_code(b.dataset.code); }); });
    if (get_pref('legend_collapsed')) leg.classList.add('legend-collapsed');
    var lc = leg.querySelector('.leg-collapse');
    function lc_label() { if (lc) lc.innerHTML = leg.classList.contains('legend-collapsed') ? '▸ Show flagged values' : '▾ Hide'; }
    lc_label();
    if (lc) lc.addEventListener('click', function () { leg.classList.toggle('legend-collapsed'); var pp = prefs(); pp.legend_collapsed = leg.classList.contains('legend-collapsed'); save_prefs(pp); lc_label(); });
  }

  function filter_by_code(code) {
    if (!S.flag_info.code_rows || !S.flag_info.code_rows[code] || !S.conv_table) return;
    set_compare_view('tables');
    var p = prefs(); p.compare_view = 'tables'; save_prefs(p);
    S.conv_table.set_filter(S.flag_info.code_rows[code], flag_label(code));
    $('compareCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function sync_scroll() {
    var o = $('originalGrid').querySelector('.grid-scroll'), cc = $('resultGrid').querySelector('.grid-scroll');
    if (!o || !cc) return;
    var lock = false;
    function mk(a, b) { return function () { if (lock) return; if (!$('compareGrid').classList.contains('layout-side')) return; lock = true; b.scrollTop = a.scrollTop; lock = false; }; }
    o.addEventListener('scroll', mk(o, cc)); cc.addEventListener('scroll', mk(cc, o));
  }

  // ---------- layout ----------
  function apply_layout(layout, tab) {
    var grid = $('compareGrid'); grid.className = 'compare-grid layout-' + layout;
    $('layoutSwitch').querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.layout === layout); });
    var tabbar = $('tabbar');
    if (layout === 'tabs') {
      tabbar.classList.remove('hidden');
      tabbar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.pane === tab); });
      $('paneOriginal').classList.toggle('tab-hidden', tab !== 'original');
      $('paneConverted').classList.toggle('tab-hidden', tab !== 'converted');
    } else {
      tabbar.classList.add('hidden');
      $('paneOriginal').classList.remove('tab-hidden'); $('paneConverted').classList.remove('tab-hidden');
    }
  }
  function wire_layout() {
    $('layoutSwitch').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-layout]'); if (!b) return;
      var p = prefs(); p.layout = b.dataset.layout; save_prefs(p); apply_layout(p.layout, p.tab || 'original');
    });
    $('tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pane]'); if (!b) return;
      var p = prefs(); p.tab = b.dataset.pane; save_prefs(p); apply_layout('tabs', p.tab);
    });
  }

  function render_scorecard() {
    var sc = S.report.scorecard, html = '<div class="col-list">';
    sc.per_column.forEach(function (p) {
      var from = p.mapped_from ? 'from ' + esc(p.mapped_from) : 'no source';
      var counts = p.filled + '/' + p.total + (p.flagged ? ' · ' + p.flagged + ' flagged' : '');
      html += '<div class="col-stat"><span class="pill ' + p.status + '">' + p.status + '</span><span><span class="cs-name">' + esc(p.target) + '</span><br><span class="cs-from">' + from + ' · ' + counts + '</span></span></div>';
    });
    $('scorecard').innerHTML = html + '</div>';
  }

  function render_mapping() {
    var headers = S.parsed.headers, html = '';
    schema.TEMPLATE_SCHEMA.forEach(function (col) {
      var m = S.mapping[col.key], opts = '<option value="">(leave blank)</option>';
      headers.forEach(function (h) { opts += '<option value="' + esc(h) + '"' + (m.source === h ? ' selected' : '') + '>' + esc(h) + '</option>'; });
      var conf = m.source ? m.confidence : 'none';
      html += '<div class="map-row"><span class="tgt">' + esc(col.target) + '</span><select data-key="' + col.key + '" aria-label="Source column for ' + esc(col.target) + '">' + opts + '</select><span class="conf ' + conf + '">' + conf + '</span></div>';
    });
    document.querySelectorAll('.rrt-colmap').forEach(function (box) {
      box.innerHTML = html;
      box.querySelectorAll('select').forEach(function (sel) {
        sel.addEventListener('change', function () { mapper.set_mapping(S.mapping, sel.dataset.key, sel.value, S.parsed.headers); recompute(false); });
      });
    });
    render_value_map();
    render_split();
  }

  function render_value_map() {
    var dist = S.result.distinct, fields = ['member_number', 'category', 'gender', 'state'], html = '';
    fields.forEach(function (key) {
      var d = dist[key]; if (!d) return;
      var col = schema.by_key(key);
      var all = Object.keys(d).map(function (k) { return { src_key: k, info: d[k] }; });
      var entries = (key === 'member_number')
        ? all.filter(function (e) { return e.info.flag; })
        : all.filter(function (e) { return e.info.sample !== ''; });
      if (!entries.length) return;
      entries.sort(function (a, b) { return (a.info.flag ? 0 : 1) - (b.info.flag ? 0 : 1) || b.info.count - a.info.count; });
      var ov = S.value_overrides[key] || {}, cap = 10, expanded = !!S.vm_expanded[key];
      var list = expanded ? entries : entries.slice(0, cap);
      html += '<div class="vm-field" data-key="' + key + '"><div class="vm-fhead"><h4>' + esc(col.target) + '</h4>' + vm_bulk(key) + '</div>';
      list.forEach(function (e) { var has_ov = Object.prototype.hasOwnProperty.call(ov, e.src_key); var cur = has_ov ? ov[e.src_key] : e.info.bucket; html += vm_item(key, e, cur, has_ov); });
      if (entries.length > cap) html += '<span class="vm-toggle" data-key="' + key + '">' + (expanded ? 'Show less' : 'Show ' + (entries.length - cap) + ' more…') + '</span>';
      html += '</div>';
    });
    var content = html || '<span class="dim">No enumerated fields mapped.</span>';
    document.querySelectorAll('.rrt-valmap').forEach(function (box) { box.innerHTML = content; wire_value_map(box); });
  }

  function vm_bulk(key) {
    var b = '<div class="vm-bulk">';
    if (ENUM_BUCKETS[key]) {
      b += '<select class="vm-setall" data-key="' + key + '" title="Set every value in this field at once" aria-label="Set all values for this field">' +
        '<option value="">Set all to…</option>' +
        ENUM_BUCKETS[key].map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</select>';
    } else if (key === 'member_number') {
      b += '<button class="btn sm vm-setall-btn" data-key="' + key + '" data-val="1-day" title="Set every listed value to 1-day">Set all → 1-day</button>';
    }
    b += '<button class="btn sm vm-reset-all" data-key="' + key + '" title="Revert every value in this field to the tool\'s auto choice">↺ Reset all</button></div>';
    return b;
  }

  function vm_item(key, e, cur, has_ov) {
    var src_cls = e.info.flag ? 'src flagged' : 'src', control;
    if (ENUM_BUCKETS[key]) {
      var opts = ENUM_BUCKETS[key].map(function (b) { return '<option value="' + esc(b) + '"' + (b === cur ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('');
      control = '<select data-key="' + key + '" data-src="' + esc(e.src_key) + '" aria-label="Mapped value for ' + esc(e.src_key) + '">' + opts + '</select>';
    } else {
      var ml = key === 'state' ? ' maxlength="2"' : '';
      control = '<input data-key="' + key + '" data-src="' + esc(e.src_key) + '" aria-label="Mapped value for ' + esc(e.src_key) + '"' + ml + ' value="' + esc(cur) + '">';
    }
    var reset = has_ov ? '<button class="vm-reset" data-key="' + key + '" data-src="' + esc(e.src_key) + '" title="Reset to the original / auto value">↺</button>' : '';
    var label = e.info.sample === '' ? '(blank)' : e.info.sample;
    return '<div class="vm-item"><span class="' + src_cls + '" title="' + esc(label) + '">' + esc(label) + '</span><span class="vm-count dim">×' + e.info.count + '</span>' + control + reset + '</div>';
  }

  function wire_value_map(box) {
    box.querySelectorAll('select[data-src],input[data-src]').forEach(function (ctrl) {
      ctrl.addEventListener('change', function () {
        var key = ctrl.dataset.key, src = ctrl.dataset.src;
        S.value_overrides[key] = S.value_overrides[key] || {}; S.value_overrides[key][src] = ctrl.value; recompute(false);
      });
    });
    box.querySelectorAll('.vm-toggle').forEach(function (el) {
      el.addEventListener('click', function () { var k = el.dataset.key; S.vm_expanded[k] = !S.vm_expanded[k]; render_value_map(); });
    });
    box.querySelectorAll('.vm-reset').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.key; if (S.value_overrides[k]) { delete S.value_overrides[k][b.dataset.src]; } recompute(false);
      });
    });
    box.querySelectorAll('.vm-reset-all').forEach(function (b) {
      b.addEventListener('click', function () { delete S.value_overrides[b.dataset.key]; recompute(false); });
    });
    box.querySelectorAll('.vm-setall').forEach(function (sel) {
      sel.addEventListener('change', function () { if (sel.value) bulk_set(sel.dataset.key, sel.value); });
    });
    box.querySelectorAll('.vm-setall-btn').forEach(function (b) {
      b.addEventListener('click', function () { bulk_set(b.dataset.key, b.dataset.val); });
    });
  }

  function bulk_set(key, val) {
    var d = S.result.distinct[key] || {};
    S.value_overrides[key] = S.value_overrides[key] || {};
    Object.keys(d).forEach(function (src_key) { if (d[src_key].sample !== '') S.value_overrides[key][src_key] = val; });
    recompute(false);
  }

  function render_reference() {
    var rows = schema.TEMPLATE_SCHEMA.map(function (c, i) {
      var req = c.required ? '<span class="rf-req">required</span>' : '<span class="rf-opt">optional</span>';
      return '<tr><td class="dim">' + (i + 1) + '</td><td class="rf-col">' + esc(c.target) + '</td><td>' + req + '</td><td>' + esc(c.note || '') + '</td></tr>';
    }).join('');
    $('fieldReference').innerHTML =
      '<table class="rf-table"><thead><tr><th>#</th><th>Column</th><th>Required</th><th>Format / definition</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="rf-foot dim">This is the exact output column order. In the reformatted table, any value the tool changed or guessed is highlighted — hover it for the reason.</p>';
  }

  function render_integrity() {
    var rep = S.report, sc = rep.scorecard;
    var headline = sc.band === 'green'
      ? '100% of athlete rows carried over; every source column is mapped, derived, or intentionally dropped.'
      : (sc.band === 'amber' ? 'All rows carried over and every column accounted for — review the flagged values before uploading.' : 'Attention needed: ' + esc(sc.verdict));
    var html = '<div class="banner ' + sc.band + '">' + headline + '</div>';
    var sk = rep.rows.skipped;
    html += '<div class="intg-block"><h4>Row reconciliation</h4><div class="kv"><b>' + rep.rows.in + '</b> athlete rows in → <b>' + rep.rows.out + '</b> out';
    if (sk.length) {
      var divs = sk.filter(function (s) { return s.reason === 'section-divider'; }).length;
      var blanks = sk.length - divs;
      html += ' · <b>' + sk.length + '</b> non-athlete rows skipped</div>';
      html += '<p class="skip-note dim">Skipped rows aren\'t athletes — they\'re section/division headers (a label on its own line, like “Alpha Sprint”) or blank separator rows, so they\'re left out of the converted file. ' +
        divs + ' section header' + (divs === 1 ? '' : 's') + ', ' + blanks + ' blank.</p>';
      html += '<details class="skip-details"><summary>Show the ' + sk.length + ' skipped rows</summary><div class="skip-list">';
      sk.forEach(function (r) {
        var label = r.reason === 'section-divider' ? 'section header' : 'blank';
        html += '<div class="skip-row"><span class="skip-rownum">Row ' + (r.index + 1) + '</span><span class="skip-reason ' + r.reason + '">' + label + '</span><span class="skip-prev">' + esc(r.preview || '') + '</span></div>';
      });
      html += '</div></details>';
    } else { html += ' · no rows skipped</div>'; }
    html += '</div>';
    html += '<div class="intg-block"><h4>Column ledger</h4><div class="ledger">';
    rep.ledger.forEach(function (l) {
      var label = l.disposition === 'mapped' ? '→ ' + esc(l.target) : (l.disposition === 'dropped-split' ? 'split time' : 'not in template');
      html += '<span class="tag ' + l.disposition + '">' + esc(l.header) + '<span class="d">' + label + '</span></span>';
    });
    html += '</div></div>';
    var pres = rep.preservation.filter(function (x) { return x.mapped; });
    if (pres.length) {
      var bad = pres.filter(function (x) { return !x.ok; });
      html += '<div class="intg-block"><h4>Value preservation</h4>' +
        (bad.length ? '<div class="banner amber">' + bad.map(function (b) { return esc(b.target) + ': ' + b.missing + ' missing'; }).join('; ') + '</div>' : '<div class="banner green">Name, Email and Zip values are fully preserved.</div>') + '</div>';
    }
    html += '<div class="intg-block"><h4>Transformation summary</h4>';
    S.result.schema.forEach(function (col) {
      var st = S.result.stats[col.key]; if (st.filled === 0 && st.blank === 0) return;
      var bits = []; if (st.filled) bits.push(st.filled + ' filled'); if (st.flagged) bits.push(st.flagged + ' flagged'); if (st.blank) bits.push(st.blank + ' blank');
      html += '<div class="summary-line"><b>' + esc(col.target) + ':</b> ' + bits.join(' · ') + '</div>';
    });
    $('integrityBody').innerHTML = html + '</div>';
  }

  // ---------- split & download by column ----------
  function field_for(bundle, header) {
    var f = null;
    schema.TEMPLATE_SCHEMA.forEach(function (c) { if (bundle.mapping[c.key] && bundle.mapping[c.key].source === header) f = c; });
    return f;
  }
  // Per-output-row grouping key for a chosen SOURCE column in a given sheet bundle.
  // Converted basis uses the mapped template field's value; otherwise the raw cell.
  function split_keys_for(bundle, header, basis) {
    var hi = bundle.parsed.headers.indexOf(header);
    if (hi < 0) return null; // this sheet has no such column
    if (basis === 'converted') {
      var field = field_for(bundle, header);
      if (field) { compute_bundle(bundle); var ci = schema.TEMPLATE_SCHEMA.indexOf(field); return bundle.work_rows.map(function (r) { return display.cell_text(r[ci]); }); }
    }
    return bundle.parsed.data_rows.map(function (dr) { return display.cell_text(dr.cells[hi]); });
  }
  function manual_name(raw) {
    var v = Object.prototype.hasOwnProperty.call(S.split_manual, raw) ? S.split_manual[raw] : raw;
    v = (v == null ? '' : String(v)).trim();
    return v || raw;
  }

  function split_item(i, value, count) {
    var label = value === '' ? '(blank)' : value;
    return '<label class="split-item"><input type="checkbox" class="s-on" value="' + i + '" checked>' +
      '<span class="s-name">' + esc(label) + '</span><span class="s-count">' + count + ' rows</span></label>';
  }
  function split_manual_item(i, g) {
    var label = g.value === '' ? '(blank)' : g.value;
    var ov = Object.prototype.hasOwnProperty.call(S.split_manual, g.value) ? (S.split_manual[g.value] || '') : '';
    return '<div class="split-item"><input type="checkbox" class="s-on" value="' + i + '" checked aria-label="Include ' + esc(label) + ' in the download">' +
      '<span class="s-name" title="' + esc(label) + '">' + esc(label) + ' <span class="s-count">×' + g.count + '</span></span>' +
      '<span class="m-arrow">→</span>' +
      '<input class="m-grp"' + (SPLIT_FEATURES.group_picker ? ' list="split-groups"' : '') + ' data-raw="' + esc(g.value) + '" value="' + esc(ov) + '" placeholder="' + esc(label) + '" title="Leave blank for its own file; type/pick a group name to combine values" aria-label="group name for ' + esc(label) + '"></div>';
  }

  function split_store_key() { return (S.sig || '') + '|' + (S.split_col || ''); }
  function load_saved_groups() {
    if (!SPLIT_FEATURES.remember_grouping) return null;
    var all = get_pref('split_groups') || {};
    return all[split_store_key()] || null;
  }
  function save_groups() {
    if (!SPLIT_FEATURES.remember_grouping) return;
    var pp = prefs(); pp.split_groups = pp.split_groups || {};
    var key = split_store_key();
    if (Object.keys(S.split_manual).length) pp.split_groups[key] = S.split_manual; else delete pp.split_groups[key];
    save_prefs(pp);
  }
  function forget_saved_groups() {
    var pp = prefs(); if (pp.split_groups) { delete pp.split_groups[split_store_key()]; save_prefs(pp); }
  }
  function autosave_on() { return get_pref('split_autosave') !== false; }   // default ON
  function persistent_preset_status(box) {
    var el = box.querySelector('.split-preset-status'); if (!el) return;
    el.textContent = load_saved_groups() ? '\u00b7 preset saved \u2713' : '';
  }
  function flash_preset_status(box, msg) {
    var el = box.querySelector('.split-preset-status'); if (!el) return;
    el.textContent = '\u00b7 ' + msg; clearTimeout(el.status_timer);
    el.status_timer = setTimeout(function () { persistent_preset_status(box); }, 1600);
  }
  function refresh_group_datalist(box) {
    var dl = box.querySelector('#split-groups'); if (!dl) return;
    var names = {};
    Object.keys(S.split_manual).forEach(function (raw) { var n = (S.split_manual[raw] || '').trim(); if (n) names[n] = true; });
    dl.innerHTML = Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }
  function render_split() {
    var box = document.querySelector('.rrt-split'); if (!box || !S.sheets || S.active == null) return;
    save_active();
    var active = S.sheets[S.active];
    var headers = active.parsed.headers;
    if (!headers.length) { box.innerHTML = '<span class="dim">No columns to split on.</span>'; return; }
    if (S.split_col == null || headers.indexOf(S.split_col) < 0) { S.split_col = (active.mapping.category && active.mapping.category.source) || headers[0]; S.split_manual = {}; S.split_basis = null; }
    var field = field_for(active, S.split_col);
    if (S.split_basis !== 'converted' && S.split_basis !== 'original') S.split_basis = 'original';
    if (S.split_basis === 'converted' && !field) S.split_basis = 'original';
    var manual = S.split_basis === 'original';
    var multi = S.sheets.length > 1;
    if (manual && SPLIT_FEATURES.remember_grouping) {
      var lk = split_store_key();
      if (S.split_loaded_key !== lk) {
        var saved_g = load_saved_groups();
        if (saved_g && Object.keys(S.split_manual).length === 0) S.split_manual = Object.assign({}, saved_g);
        S.split_loaded_key = lk;
      }
    }

    var opts = headers.map(function (h) {
      var mt = field_for(active, h);
      var lbl = h + (mt ? ' → ' + mt.target : ' (not in template)');
      return '<option value="' + esc(h) + '"' + (h === S.split_col ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }).join('');

    var toggle = field
      ? '<div class="seg split-seg"><button type="button" data-basis="converted"' + (manual ? '' : ' class="active"') + '>Converted ' + esc(field.target) + '</button>' +
        '<button type="button" data-basis="original"' + (manual ? ' class="active"' : '') + '>Original value</button></div>'
      : '';
    var hint = manual
      ? 'Each original value is its own file — give two values the same <b>group name</b> to combine them.'
      : 'Groups are the cleaned <b>' + esc(field ? field.target : '') + '</b> values (your value-mapping applies).';

    var groups = split.group_by_key(split_keys_for(active, S.split_col, S.split_basis) || []);
    var items = groups.map(function (g, i) { return manual ? split_manual_item(i, g) : split_item(i, g.value, g.count); }).join('');
    var dl_html = '';
    if (SPLIT_FEATURES.group_picker && manual) {
      var gset = {}; Object.keys(S.split_manual).forEach(function (raw) { var n = (S.split_manual[raw] || '').trim(); if (n) gset[n] = true; });
      dl_html = '<datalist id="split-groups">' + Object.keys(gset).map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>';
    }

    box.innerHTML =
      '<p class="dim split-intro">Pick a column from your <b>original</b> file. Each group becomes its own reformatted <code>.xlsx</code> (full 12-column template, only that group’s rows)' + (multi ? ' — the <b>Download</b> button lets you apply it across some or all sheets.' : '.') + '</p>' +
      '<div class="split-row"><label class="split-lbl">Split on</label><select class="split-col" aria-label="Split on column">' + opts + '</select></div>' +
      '<div class="split-row">' + toggle + '<span class="dim split-hint">' + hint + '</span></div>' +
      '<div class="dl-tools split-tools"><label class="split-allbox" title="Select / deselect all"><input type="checkbox" class="s-all" checked> <b>Download</b></label>' +
      '<span class="dim split-allhint">— check each value to save it as its own .xlsx</span>' +
      '</div>' +
      (manual ? ('<div class="split-presets">' +
        '<button type="button" class="btn sm" data-clear-entries title="Reset all group boxes to default (one file per value); keeps the saved preset">↺ Clear entries</button>' +
        (SPLIT_FEATURES.remember_grouping ?
          '<button type="button" class="btn sm" data-save-preset title="Save this grouping to reuse on the next same-layout file">\uD83D\uDCBE Save preset</button>' +
          '<button type="button" class="btn sm" data-forget-preset title="Delete the saved grouping for this file layout + column">\uD83D\uDDD1 Forget preset</button>' +
          '<label class="split-autosave" title="Save the grouping automatically as you type"><input type="checkbox" class="split-autosave-chk"' + (autosave_on() ? ' checked' : '') + '> Auto-save</label>' +
          '<span class="split-preset-status dim"></span>' : '') +
        '</div>') : '') +
      (manual
        ? '<div class="split-head"><span class="sh-box"></span><span class="s-name">Original value <span class="dim">(rows)</span></span><span class="m-arrow"></span><span class="sh-grp">Download group / file name</span></div>'
        : '<div class="split-head"><span class="sh-box"></span><span class="s-name">Value</span><span class="s-count">Rows</span></div>') +
      dl_html +
      '<div class="split-list">' + items + '</div>' +
      '<div class="dl-foot"><button type="button" class="btn primary sm split-go">Download</button></div>';
    wire_split(box, groups, manual, multi);
  }

  function split_checked_count(box, manual) {
    var checked = Array.prototype.slice.call(box.querySelectorAll('.split-list input.s-on:checked'));
    if (!manual) return checked.length;
    var names = {};
    checked.forEach(function (c) { var inp = c.closest('.split-item').querySelector('.m-grp'); var nm = (inp.value || '').trim() || inp.dataset.raw; if (nm) names[nm] = true; });
    return Object.keys(names).length;
  }
  function wire_split(box, groups, manual, multi) {
    var sel = box.querySelector('.split-col');
    function sync_all() {
      var all = box.querySelectorAll('.split-list input.s-on');
      var on = box.querySelectorAll('.split-list input.s-on:checked').length;
      var sa = box.querySelector('.s-all');
      if (sa) { sa.checked = on > 0 && on === all.length; sa.indeterminate = on > 0 && on < all.length; }
    }
    function update_go() {
      var n = split_checked_count(box, manual);
      var go = box.querySelector('.split-go'); go.disabled = !n;
      go.textContent = !n ? 'Select values' : (multi ? '⤓ Download…' : '⤓ Download ' + n + ' file' + (n > 1 ? 's' : ''));
      sync_all();
    }
    sel.addEventListener('change', function () { S.split_col = sel.value; S.split_manual = {}; S.split_basis = null; render_split(); });
    box.querySelectorAll('[data-basis]').forEach(function (b) { b.addEventListener('click', function () { S.split_basis = b.dataset.basis; render_split(); }); });
    var s_all = box.querySelector('.s-all');
    if (s_all) s_all.addEventListener('change', function () { box.querySelectorAll('.split-list input.s-on').forEach(function (c) { c.checked = s_all.checked; }); update_go(); });
    var ce = box.querySelector('[data-clear-entries]'); if (ce) ce.addEventListener('click', function () { S.split_manual = {}; render_split(); });
    var sp = box.querySelector('[data-save-preset]'); if (sp) sp.addEventListener('click', function () { save_groups(); flash_preset_status(box, 'preset saved \u2713'); });
    var fp = box.querySelector('[data-forget-preset]'); if (fp) fp.addEventListener('click', function () { forget_saved_groups(); flash_preset_status(box, 'saved preset cleared'); });
    var as = box.querySelector('.split-autosave-chk'); if (as) as.addEventListener('change', function () { var pp = prefs(); pp.split_autosave = as.checked; save_prefs(pp); if (as.checked) save_groups(); flash_preset_status(box, as.checked ? 'auto-save on' : 'auto-save off'); });
    box.querySelectorAll('.split-list input.s-on').forEach(function (c) { c.addEventListener('change', update_go); });
    box.querySelectorAll('.m-grp').forEach(function (inp) { inp.addEventListener('input', function () { S.split_manual[inp.dataset.raw] = inp.value; refresh_group_datalist(box); if (autosave_on()) save_groups(); update_go(); }); });
    box.querySelector('.split-go').addEventListener('click', function () {
      var checked = Array.prototype.slice.call(box.querySelectorAll('.split-list input.s-on:checked')).map(function (c) { return groups[+c.value]; });
      if (!checked.length) return;
      track('split_download_used', { download_mode: 'split', split_basis: S.split_basis, selected_count: checked.length });
      open_split_picker(box, checked, manual);   // always show the format + filename builder
    });
    update_go();
    persistent_preset_status(box);
  }

  // Sheet picker for the split download — mirrors the top Download button.
  function close_split_picker() {
    var p = $('splitPop'); if (p) p.remove();
    document.removeEventListener('mousedown', sp_outside); document.removeEventListener('keydown', sp_esc);
  }
  function sp_outside(e) { var p = $('splitPop'); if (!p) return; if (!p.contains(e.target)) close_split_picker(); }
  function sp_esc(e) { if (e.key === 'Escape') close_split_picker(); }
  // The output group labels this split will produce (after manual merging) — matches run_split's
  // job.label so the per-group filename inputs key correctly.
  function split_output_labels(checked, manual) {
    if (manual) {
      var entries = checked.map(function (g) { return { name: manual_name(g.value), indices: g.indices }; });
      return split.merge_named(entries).map(function (m) { return m.value; });
    }
    return checked.map(function (g) { return g.value === '' ? 'blank' : g.value; });
  }
  function open_split_picker(box, checked, manual) {
    close_split_picker();
    var btn = box.querySelector('.split-go');
    var pop = document.createElement('div'); pop.className = 'dl-pop'; pop.id = 'splitPop';
    var multi_sheets = S.sheets && S.sheets.length > 1;

    // sheet checklist ONLY when there's more than one sheet (a single-sheet list is just noise)
    var sheets_html = '';
    if (multi_sheets) {
      var items = S.sheets.map(function (b, i) {
        var has = b.parsed.headers.indexOf(S.split_col) >= 0;
        return '<label class="dl-item' + (has ? '' : ' off') + '"><input type="checkbox" class="sp-sheet" value="' + i + '"' + (has ? ' checked' : ' disabled') + '>' +
          '<span class="dl-name">' + esc(b.name) + '</span><span class="dim">' + (has ? b.parsed.data_rows.length + ' rows' : 'no column') + '</span></label>';
      }).join('');
      sheets_html = '<div class="dl-subhead">Sheets to split</div>' +
        '<div class="dl-tools"><button type="button" class="btn sm" data-all="1">Select all</button>' +
        '<button type="button" class="btn sm" data-all="0">Clear</button></div>' +
        '<div class="dl-list sp-sheets">' + items + '</div>';
    }

    // one editable filename per output group (the per-file naming, like the main Download picker)
    var labels = split_output_labels(checked, manual);
    var groups_html = '<div class="dl-subhead">File name per group' + (multi_sheets ? ' — sheet name appended per sheet' : '') + '</div>' +
      '<div class="dl-list sp-groups">' + labels.map(function (lab) {
        var disp = lab === '' ? 'blank' : lab;
        return '<div class="dl-sheet"><div class="dl-pickrow"><span class="dl-name">' + esc(disp) + '</span></div>' +
          '<div class="dl-row2"><input class="split-fname" data-label="' + esc(lab) + '" type="text" aria-label="Filename for group ' + esc(disp) + '"><span class="dl-ext dim"></span></div></div>';
      }).join('') + '</div>';

    pop.innerHTML =
      '<div class="dl-head">Split &amp; download <span class="dim">— one file per group</span></div>' +
      dl_format_html() + dl_builder_html() + sheets_html + groups_html +
      '<div class="dl-foot"><button type="button" class="btn primary sm" id="splitGo2">Download</button></div>';
    document.body.appendChild(pop);

    function refresh() {
      var f = read_builder(pop); S.dl_fields = f;
      var base = build_base_name(f), ext = dl_ext();
      pop.querySelectorAll('.split-fname').forEach(function (inp) {
        if (inp.dataset.touched) return;   // don't clobber a name the user typed
        var disp = inp.dataset.label === '' ? 'blank' : inp.dataset.label;
        inp.value = (base ? base + ' - ' : '') + disp;
      });
      pop.querySelectorAll('.sp-groups .dl-ext').forEach(function (x) { x.textContent = ext; });
    }
    wire_builder(pop, refresh);
    pop.querySelectorAll('.split-fname').forEach(function (inp) { inp.addEventListener('input', function () { inp.dataset.touched = '1'; }); });
    if (multi_sheets) {
      pop.querySelectorAll('[data-all]').forEach(function (tb) { tb.addEventListener('click', function () { var on = tb.dataset.all === '1'; pop.querySelectorAll('.sp-sheet:not([disabled])').forEach(function (c) { c.checked = on; }); }); });
    }

    position_pop(pop, btn);

    pop.querySelector('#splitGo2').addEventListener('click', function () {
      var idxs = multi_sheets
        ? Array.prototype.slice.call(pop.querySelectorAll('.sp-sheet:checked')).map(function (c) { return +c.value; })
        : [S.active];
      if (!idxs.length) return;
      var names = {};
      pop.querySelectorAll('.split-fname').forEach(function (inp) { names[inp.dataset.label] = clean_part(inp.value); });
      close_split_picker();
      run_split(idxs, checked, manual, names);
    });
    refresh();
    setTimeout(function () { document.addEventListener('mousedown', sp_outside); document.addEventListener('keydown', sp_esc); }, 0);
  }

  // Build & download one file per group, for each chosen sheet.
  function run_split(idxs, checked, manual, names) {
    var sel_vals = {}; checked.forEach(function (g) { sel_vals[g.value] = true; });
    var multi = idxs.length > 1;
    var jobs = [];
    idxs.forEach(function (si) {
      var b = S.sheets[si];
      var keys = split_keys_for(b, S.split_col, S.split_basis); if (!keys) return;
      compute_bundle(b);
      var gs = split.group_by_key(keys);
      if (manual) {
        var entries = gs.filter(function (g) { return sel_vals[g.value]; }).map(function (g) { return { name: manual_name(g.value), indices: g.indices }; });
        split.merge_named(entries).forEach(function (m) { jobs.push({ b: b, label: m.value, indices: m.indices }); });
      } else {
        gs.filter(function (g) { return sel_vals[g.value]; }).forEach(function (g) { jobs.push({ b: b, label: (g.value === '' ? 'blank' : g.value), indices: g.indices }); });
      }
    });
    var base = build_base_name(S.dl_fields) || safe_filename(S.file_name);
    jobs.forEach(function (job, k) {
      setTimeout(function () {
        var rows = job.indices.map(function (i) { return job.b.work_rows[i]; });
        var custom = names && names[job.label];                 // per-group name from the popover
        var parts = [custom || (base + ' - ' + job.label)];
        if (multi) parts.push(job.b.name);                      // keep multi-sheet files distinct
        emit_grid(job.b.result.headers, rows, parts.join(' - '));
      }, k * 250);
    });
  }

  // ---------- collapse ----------
  function apply_collapse_defaults() {
    document.querySelectorAll('.collapse-card').forEach(function (card) {
      var id = card.dataset.section, saved = get_pref('collapsed.' + id);
      card.classList.toggle('collapsed', saved === undefined ? !!DEFAULT_COLLAPSED[id] : !!saved);
    });
  }
  function wire_collapsibles() {
    document.querySelectorAll('.collapse-card .collapsible').forEach(function (h) {
      h.addEventListener('click', function (e) {
        if (e.target.closest('.drag-handle, .head-actions, button, select, a')) return;
        var card = h.closest('.collapse-card'); card.classList.toggle('collapsed');
        var p = prefs(); p.collapsed = p.collapsed || {}; p.collapsed[card.dataset.section] = card.classList.contains('collapsed'); save_prefs(p);
      });
    });
  }

    // ---------- download ----------
  function save_download(content, name, fmt) {
    var blob = fmt === 'csv'
      ? new Blob([content], { type: 'text/csv;charset=utf-8' })
      : new Blob([content], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    // keep the anchor in the DOM briefly: removing it synchronously after click() can cancel the
    // download in WebKit/Firefox (esp. for a text/csv blob).
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 1500);
  }
  function save_blob(buf, name) { save_download(buf, name, 'xlsx'); }   // back-compat (xlsx buffer)

  // One filename PART — keeps spaces, strips characters illegal in filenames.
  function clean_part(s) { return String(s == null ? '' : s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function safe_filename(s) { return clean_part(s) || 'sheet'; }
  // Compose the builder base name from {id,type,distance,name}; blanks + their separators are skipped.
  function build_base_name(f) { return [f.id, f.type, f.distance, f.name].map(clean_part).filter(Boolean).join(' - '); }
  // Auto-fill Race Type from a tab name when it matches a dropdown option (e.g. "Duathlon").
  function type_from_sheet(name) {
    var n = String(name || '').toLowerCase();
    for (var i = 0; i < RACE_TYPES.length; i++) if (n === RACE_TYPES[i].toLowerCase()) return RACE_TYPES[i];
    return '';
  }
  function dl_ext() { return S.dl_format === 'xlsx' ? '.xlsx' : '.csv'; }
  // Emit one grid in the chosen format under `base` (no extension): CSV (default) or .xlsx.
  // Columns to lock as Excel text in the CSV (so Excel doesn't re-format the time/date on open).
  function dl_safe_cols(headers) {
    var want = { 'DOB': 1, 'Recorded Time': 1 }, cols = [];
    (headers || []).forEach(function (h, i) { if (want[h]) cols.push(i); });
    return cols;
  }
  function emit_grid(headers, rows, base) {
    var name = clean_part(base) || 'rankings';
    if (S.dl_format === 'xlsx') {
      return io.grids_to_buffer([{ name: name.slice(0, 31), headers: headers, rows: rows }])
        .then(function (buf) { save_download(buf, name + '.xlsx', 'xlsx'); });
    }
    var csv_opts = S.dl_excel_safe ? { excel_safe_cols: dl_safe_cols(headers) } : null;   // CSV-only Excel-safe wrap
    save_download(io.grid_to_csv(headers, rows, csv_opts), name + '.csv', 'csv');
    return Promise.resolve();
  }
  // Single sheet / CSV: one file, honours the on-screen sort/filter.
  function download_single(base) {
    track('download', { download_mode: 'single', file_out_count: 1, selected_count: 1 });
    return emit_grid(S.result.headers, S.conv_table.export_rows(), base);
  }
  // Each selected sheet -> its own file with its own base name (staggered so the browser keeps them).
  // A bundle's converted rows minus the rows the user deleted on that sheet (work_rows[i] ↔ row i).
  function kept_rows(b) { return (b.excluded) ? b.work_rows.filter(function (_, i) { return !b.excluded[i]; }) : b.work_rows; }
  function download_selected(idx, names) {
    save_active();
    track('download', { download_mode: 'separate', file_out_count: idx.length, selected_count: idx.length });
    idx.forEach(function (i, k) {
      var b = S.sheets[i];
      setTimeout(function () { compute_bundle(b); emit_grid(b.result.headers, kept_rows(b), names[i]); }, k * 300);
    });
  }
  // Combine the chosen sheets into ONE file — converted rows stacked in tab order.
  function download_combined(idx, base) {
    save_active();
    track('download', { download_mode: 'combined', file_out_count: 1, selected_count: idx.length });
    var rows = [];
    idx.forEach(function (i) { var b = S.sheets[i]; compute_bundle(b); rows = rows.concat(kept_rows(b)); });
    emit_grid(S.sheets[idx[0]].result.headers, rows, base);
  }
  function download() { save_active(); open_download_picker(); }

  // ---- shared popover bits: positioning, format toggle, filename builder ----
  function position_pop(pop, btn) {
    var r = btn.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 340)) + 'px';
    var ph = pop.getBoundingClientRect().height;
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
    pop.style.top = top + 'px';
  }
  function dl_format_html() {
    return '<div class="seg dl-fmt"><button type="button" data-fmt="csv"' + (S.dl_format === 'csv' ? ' class="active"' : '') + '>CSV</button>' +
      '<button type="button" data-fmt="xlsx"' + (S.dl_format === 'xlsx' ? ' class="active"' : '') + '>Excel .xlsx</button></div>' +
      '<label class="dl-xsafe" title="Keep the time/date format when the CSV is opened in Excel. Wraps the DOB and Recorded Time columns as Excel text (=&quot;value&quot;) so Excel shows them EXACTLY as written instead of auto-reformatting the time/date. Other tools (Google Sheets, scripts) will see the literal =&quot;...&quot;. Not needed for the Excel .xlsx download.">' +
      '<input type="checkbox" id="dlXsafe"' + (S.dl_excel_safe ? ' checked' : '') + '> CSV-safe times/dates</label>';
  }
  function dl_builder_html() {
    var f = S.dl_fields;
    function opts(list, cur) { return '<option value="">—</option>' + list.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); }
    return '<div class="dl-builder">' +
      '<label class="dl-fld">Sanction ID <input id="dlId" type="text" value="' + esc(f.id) + '" placeholder="351003" aria-label="Sanction ID"></label>' +
      '<label class="dl-fld">Race Type <select id="dlType" aria-label="Race Type">' + opts(RACE_TYPES, f.type) + '</select></label>' +
      '<label class="dl-fld">Race Distance <select id="dlDist" aria-label="Race Distance">' + opts(RACE_DISTANCES, f.distance) + '</select></label>' +
      '<label class="dl-fld">Race Name <input id="dlName" type="text" value="' + esc(f.name) + '" placeholder="Clash Mississippi" aria-label="Race Name"></label>' +
      '</div>';
  }
  function read_builder(pop) {
    return { id: pop.querySelector('#dlId').value, type: pop.querySelector('#dlType').value,
      distance: pop.querySelector('#dlDist').value, name: pop.querySelector('#dlName').value };
  }
  function wire_builder(pop, on_change) {
    ['#dlId', '#dlType', '#dlDist', '#dlName'].forEach(function (s) {
      var el = pop.querySelector(s); if (!el) return;
      el.addEventListener('input', on_change); el.addEventListener('change', on_change);
    });
    pop.querySelectorAll('.dl-fmt [data-fmt]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.dl_format = b.dataset.fmt;
        pop.querySelectorAll('.dl-fmt [data-fmt]').forEach(function (x) { x.classList.toggle('active', x === b); });
        on_change();
      });
    });
    var xs = pop.querySelector('#dlXsafe');
    if (xs) xs.addEventListener('change', function () { S.dl_excel_safe = xs.checked; on_change(); });
  }
  function close_download_picker() {
    var p = $('dlPop'); if (p) p.remove();
    document.removeEventListener('mousedown', dl_outside); document.removeEventListener('keydown', dl_esc);
  }
  function dl_outside(e) {
    var p = $('dlPop'); if (!p) return;
    if (!p.contains(e.target) && !$('downloadBtn').contains(e.target)) close_download_picker();
  }
  function dl_esc(e) { if (e.key === 'Escape') close_download_picker(); }
  function open_download_picker() {
    close_download_picker();
    var btn = $('downloadBtn');
    var multi = S.sheets && S.sheets.length > 1;
    var mode = 'separate';
    var pop = document.createElement('div'); pop.className = 'dl-pop'; pop.id = 'dlPop';
    var list_html = '';
    if (multi) {
      list_html = '<div class="seg dl-mode"><button type="button" data-mode="separate" class="active">Separate files</button>' +
        '<button type="button" data-mode="combined">Combined (one file)</button></div>' +
        '<p class="dim dl-hint">Name each sheet\u2019s file below \u2014 Type is pre-filled from the tab name.</p>' +
        '<div class="dl-list">' + S.sheets.map(function (b, i) {
          return '<div class="dl-sheet"><label class="dl-pickrow"><input type="checkbox" class="dl-pick" value="' + i + '" checked>' +
            '<span class="dl-name">' + esc(b.name) + '</span><span class="dim">' + b.parsed.data_rows.length + ' rows</span></label>' +
            '<div class="dl-row2"><input class="dl-fname" data-i="' + i + '" type="text" aria-label="Filename for ' + esc(b.name) + '"><span class="dl-ext dim"></span></div></div>';
        }).join('') + '</div>';
    }
    pop.innerHTML =
      '<div class="dl-head">Download</div>' +
      dl_format_html() + dl_builder_html() +
      (multi ? '' : '<p class="dim dl-preview-wrap">Saves as <b class="dl-preview"></b></p>') +
      list_html +
      '<div class="dl-foot"><button type="button" class="btn primary sm" id="dlGo">Download</button></div>';
    document.body.appendChild(pop);
    position_pop(pop, btn);

    function update_go() {
      var go = pop.querySelector('#dlGo');
      if (!multi) { go.disabled = false; go.textContent = '\u2913 Download'; return; }
      var n = pop.querySelectorAll('.dl-pick:checked').length;
      go.disabled = !n;
      if (!n) { go.textContent = 'Select sheets'; return; }
      go.textContent = mode === 'combined'
        ? ('\u2913 Download 1 combined file (' + n + ' sheet' + (n > 1 ? 's' : '') + ')')
        : ('\u2913 Download ' + n + ' file' + (n > 1 ? 's' : ''));
    }
    function refresh() {
      var f = read_builder(pop); S.dl_fields = f;
      var ext = dl_ext();
      if (!multi) {
        var pv = pop.querySelector('.dl-preview'); if (pv) pv.textContent = (build_base_name(f) || 'rankings') + ext;
      } else {
        pop.querySelectorAll('.dl-fname').forEach(function (inp) {
          if (inp.dataset.touched) return;   // don't clobber a name the user typed
          var i = +inp.dataset.i;
          inp.value = build_base_name({ id: f.id, type: type_from_sheet(S.sheets[i].name) || f.type, distance: f.distance, name: f.name }) || safe_filename(S.sheets[i].name);
        });
        pop.querySelectorAll('.dl-ext').forEach(function (x) { x.textContent = ext; });
      }
      update_go();
    }
    wire_builder(pop, refresh);
    if (multi) {
      pop.querySelectorAll('.dl-fname').forEach(function (inp) { inp.addEventListener('input', function () { inp.dataset.touched = '1'; }); });
      pop.querySelectorAll('.dl-pick').forEach(function (c) { c.addEventListener('change', update_go); });
      pop.querySelectorAll('[data-mode]').forEach(function (mb) {
        mb.addEventListener('click', function () {
          mode = mb.dataset.mode;
          pop.querySelectorAll('[data-mode]').forEach(function (x) { x.classList.toggle('active', x === mb); });
          pop.querySelector('.dl-list').classList.toggle('combined-mode', mode === 'combined');
          var hint = pop.querySelector('.dl-hint');
          if (hint) hint.textContent = mode === 'combined' ? 'All selected sheets are stacked into one file, named from the fields above.' : 'Name each sheet\u2019s file below \u2014 Type is pre-filled from the tab name.';
          update_go();
        });
      });
    }
    pop.querySelector('#dlGo').addEventListener('click', function () {
      var f = read_builder(pop); S.dl_fields = f;
      if (!multi) { close_download_picker(); download_single(build_base_name(f)); return; }
      var sel = Array.prototype.slice.call(pop.querySelectorAll('.dl-pick:checked')).map(function (c) { return +c.value; });
      if (!sel.length) return;
      if (mode === 'combined') { close_download_picker(); download_combined(sel, build_base_name(f)); return; }
      var names = {};
      pop.querySelectorAll('.dl-fname').forEach(function (inp) {
        var i = +inp.dataset.i;
        names[i] = clean_part(inp.value) || build_base_name({ id: f.id, type: type_from_sheet(S.sheets[i].name) || f.type, distance: f.distance, name: f.name }) || safe_filename(S.sheets[i].name);
      });
      close_download_picker();
      download_selected(sel, names);
    });
    refresh();
    setTimeout(function () { document.addEventListener('mousedown', dl_outside); document.addEventListener('keydown', dl_esc); }, 0);
  }
  function save_profile() {
    if (!S.sig) return;
    S.store.save(S.sig, { mapping: mapper.mapping_to_text(S.mapping), value_overrides: S.value_overrides, saved_at: Date.now() });
    track('mapping_saved', {});
    var lbl = document.querySelector('#saveProfileBtn .lbl'); if (!lbl) return;
    var t = lbl.textContent; lbl.textContent = 'Saved ✓'; setTimeout(function () { lbl.textContent = t; }, 1600);
  }

  var COMPARE_PANELS = { tables: 'tablesView', files: 'filesView', mapping: 'mappingView', scorecard: 'scoreView', integrity: 'integrityView', reference: 'referenceView', steps: 'stepsView' };
  function set_compare_view(v) {
    if (!COMPARE_PANELS[v]) v = 'tables';
    var seg = $('compareSeg'); if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    Object.keys(COMPARE_PANELS).forEach(function (key) { var el = $(COMPARE_PANELS[key]); if (el) el.classList.toggle('hidden', key !== v); });
  }
  function wire_compare_seg() {
    $('compareSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]'); if (!b) return;
      set_compare_view(b.dataset.view);
      if (b.dataset.view === 'mapping' && S.result) render_split();
      var p = prefs(); p.compare_view = b.dataset.view; save_prefs(p);
    });
  }

  var STEP_DATA = [
    ['⬇', 'Drop your file', 'A race-results <code>.xlsx</code> or <code>.csv</code> — any column order or naming.'],
    ['⚡', 'It auto-converts', 'Reformatted to the USAT template right in your browser. <b>Nothing is uploaded.</b>'],
    ['✎', 'Review the highlights', 'Yellow cells are values the tool changed or guessed. Fix them in the table or the <b>Mapping</b> tab, then click a green <b>✓ Approve</b> (or edit the cell) to clear them.'],
    ['✓', 'Check Scorecard &amp; Integrity', 'Confirm every column mapped and that no athlete rows were lost.'],
    ['⤓', 'Download', 'Save the template-ready <code>.xlsx</code>. Optionally <b>Save mapping</b> to auto-apply it to future files with the same headers.']
  ];
  function render_steps() {
    var html = '<ol class="steps">' + STEP_DATA.map(function (st, i) {
      return '<li class="step"><span class="step-num">' + (i + 1) + '</span>' +
        '<div class="step-body"><div class="step-h"><span class="step-ico">' + st[0] + '</span><b>' + st[1] + '</b></div>' +
        '<span class="step-txt">' + st[2] + '</span></div></li>';
    }).join('') + '</ol>';
    document.querySelectorAll('.rrt-steps').forEach(function (el) { el.innerHTML = html; });
  }

  function effective_dark() {
    var t = get_pref('theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function apply_theme() {
    var t = get_pref('theme'), el = document.documentElement;
    if (t === 'dark' || t === 'light') el.setAttribute('data-theme', t); else el.removeAttribute('data-theme');
    var btn = $('themeToggle');
    if (btn) { var dark = effective_dark(); btn.textContent = dark ? '\u2600 Light' : '\u263E Dark'; btn.title = 'Switch to ' + (dark ? 'light' : 'dark') + ' theme'; }
  }
  function toggle_theme() {
    var dark = effective_dark(); var p = prefs(); p.theme = dark ? 'light' : 'dark'; save_prefs(p); apply_theme();
    track('theme_changed', { theme: p.theme });
  }

  function start_clock() {
    var elc = $('footerClock'); if (!elc) return;
    function tick() {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(new Date());
      var p = {}; parts.forEach(function (x) { p[x.type] = x.value; });
      elc.textContent = p.weekday + '., ' + p.month + '/' + p.day + '/' + p.year + ' ' +
        p.hour + ':' + p.minute + ':' + p.second + ' ' + p.dayPeriod + ' MTN';
    }
    tick(); setInterval(tick, 1000);
  }

  function init() {
    // Theme first — the toggle must render even if a later step fails or ExcelJS is missing.
    apply_theme();
    if ($('themeToggle')) $('themeToggle').addEventListener('click', toggle_theme);
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply_theme);
    start_clock();
    if (!window.ExcelJS) { alert('ExcelJS failed to load — please hard-refresh the page (Ctrl/Cmd+Shift+R).'); return; }
    S.store = mapper.make_store(window.localStorage);
    wire_dropzone(); wire_try_me(); wire_sf(); wire_folder(); wire_collapsibles(); wire_layout(); wire_compare_seg();
    var tip = document.createElement('div'); tip.className = 'rrt-tip hidden'; document.body.appendChild(tip);
    document.addEventListener('mouseover', function (e) { var td = e.target.closest && e.target.closest('td[data-tip]'); if (!td) return; tip.textContent = td.getAttribute('data-tip'); tip.classList.remove('hidden'); });
    document.addEventListener('mousemove', function (e) { if (tip.classList.contains('hidden')) return; var x = Math.min(e.clientX + 12, window.innerWidth - 300); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('td[data-tip]')) tip.classList.add('hidden'); });
    render_reference(); render_steps(); apply_collapse_defaults();
    set_compare_view(get_pref('compare_view') || 'tables');
    $('clearBtn').addEventListener('click', clear_all);
    $('downloadBtn').addEventListener('click', download);
    $('saveProfileBtn').addEventListener('click', save_profile);
    var lp = get_pref('link_tables'); S.link_tables = (lp === undefined ? true : !!lp);
    var lt = $('linkTables'); if (lt) { lt.checked = S.link_tables; lt.addEventListener('change', function () { S.link_tables = lt.checked; var pp = prefs(); pp.link_tables = lt.checked; save_prefs(pp); }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

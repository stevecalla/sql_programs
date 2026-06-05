/* app.js — browser UI for race_results_transform.
   All transform logic comes from window.RRT.* (same engine as CLI + tests).
   Excel/CSV I/O via vendored window.ExcelJS + RRT.io. Nothing is uploaded. */
(function () {
  'use strict';
  var RRT = window.RRT || {};
  var io = RRT.io, parse = RRT.parse, match = RRT.match, transform = RRT.transform,
      reconcile = RRT.reconcile, mapper = RRT.mapping, schema = RRT.schema,
      normalize = RRT.normalize, display = RRT.display, sort = RRT.sort;

  var ENUM_BUCKETS = { category: ['Age Group', 'Elite', 'Para', 'Relay', 'Open'], gender: ['M', 'F', 'NB', 'Open'] };
  var PREF_KEY = 'rrt_ui_v1';
  var DEFAULT_COLLAPSED = { scorecard: true, mapping: true, integrity: true };

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
    orig_table: null, conv_table: null, vm_expanded: {}, approved: {}, flag_info: null, link_tables: false
  };

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
      headers: [], data: [], order: [], query: '', sort_col: null, sort_dir: 1,
      cap: opts.cap || 500, show_all: false, filter_set: null, filter_label: ''
    };

    function compare(a, b, c) {
      // Comparator lives in the isomorphic core (src/sort.js) so it's unit-tested.
      return sort.compare_text(cell_text(T.data[a][c]), cell_text(T.data[b][c])) * T.sort_dir;
    }
    T.apply_sort = function () {
      T.order = T.data.map(function (_, i) { return i; });
      if (T.sort_col != null) T.order.sort(function (a, b) { return compare(a, b, T.sort_col); });
    };
    T.set_data = function (headers, data) { T.headers = headers; T.data = data; T.sort_col = null; T.filter_set = null; T.filter_label = ''; T.apply_sort(); mount(); render_body(); };
    T.export_rows = function () { return T.order.map(function (i) { return T.data[i]; }); };
    T.set_query = function (q) { T.query = q; var sb = T.el.querySelector('.tv-search'); if (sb) sb.value = q; render_body(); };
    T.set_order = function (order) { T.order = order.slice(); T.sort_col = null; render_body(); };
    function apply_filter(set, label) {
      T.filter_set = set || null; T.filter_label = label || '';
      var chk = T.el.querySelector('.tv-flagchk'); if (chk) chk.checked = !!(T.filter_set && T.filter_set === T.flagged_rows);
      render_body();
    }
    T.set_filter = function (set, label) { apply_filter(set, label); if (T.on_filter) T.on_filter(set, label); };
    T.set_filter_quiet = function (set, label) { apply_filter(set, label); };

    function visible_indices() {
      var q = T.query.toLowerCase(), out = [];
      for (var k = 0; k < T.order.length; k++) {
        var i = T.order[k];
        if (T.filter_set && !T.filter_set[i]) continue;
        if (q) {
          var row = T.data[i], hit = false;
          for (var c = 0; c < T.headers.length; c++) { if (cell_text(row[c]).toLowerCase().indexOf(q) >= 0) { hit = true; break; } }
          if (!hit) continue;
        }
        out.push(i);
      }
      return out;
    }

    function name_th(h, c) { return '<th data-c="' + c + '">' + esc(h) + '<span class="ind"></span></th>'; }
    function ctrl_th(h, c) {
      if (!T.col_menu) return '<th class="hctl-c"></th>';
      var cur = T.current_source ? T.current_source(c) : null;
      var opt_html = '<option value="">(blank)</option>' + T.source_headers.map(function (sh) {
        return '<option value="' + esc(sh) + '"' + (sh === cur ? ' selected' : '') + '>' + esc(sh) + '</option>';
      }).join('');
      return '<th class="hctl-c"><select class="hmap" data-c="' + c + '" title="Source column for ' + esc(h) + '">' + opt_html + '</select></th>';
    }

    function mount() {
      var tools = '<div class="tv-filter hidden"></div><div class="tv-toolbar">' +
        '<input class="tv-search" type="search" placeholder="Search rows…" value="' + esc(T.query) + '">' +
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

      var search = T.el.querySelector('.tv-search');
      search.addEventListener('input', function () { T.query = search.value; render_body(); if (T.on_search) T.on_search(T.query); });
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
          if (T.on_edit) T.on_edit(+td.dataset.i, +td.dataset.c, td);
        });
      }
    }

    function render_body() {
      var vis = visible_indices();
      var limit = T.show_all ? vis.length : Math.min(vis.length, T.cap), html = '';
      if (vis.length === 0) {
        html = '<tr><td class="tv-empty" colspan="' + (T.headers.length + 1) + '">No rows match the current search or filter. <button class="btn sm tv-clear-search">Show all rows</button></td></tr>';
      } else {
        for (var k = 0; k < limit; k++) {
          var i = vis[k];
          html += '<tr><td class="rownum">' + (i + 1) + '</td>';
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

  function handle_file(file) {
    S.file_name = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
    S.file_display = file.name;
    var is_csv = /\.csv$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function () {
      var p = is_csv ? Promise.resolve(io.csv_to_ir(reader.result)) : io.read_to_ir(reader.result);
      p.then(function (ir) { on_ir(ir); }).catch(function (e) { alert('Could not read file: ' + e.message); });
    };
    if (is_csv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
  }

  function on_ir(ir) {
    S.ir = ir;
    S.parsed = parse.detect_table(ir);
    S.sig = mapper.header_signature(S.parsed.headers);
    S.value_overrides = {}; S.vm_expanded = {}; S.approved = {};
    var prof = S.store.get(S.sig);
    if (prof && prof.mapping) {
      S.mapping = mapper.text_to_mapping(prof.mapping, S.parsed.headers);
      S.value_overrides = prof.value_overrides || {}; show_profile_bar(true);
    } else { S.mapping = match.auto_map(S.parsed.headers).mapping; show_profile_bar(false); }
    recompute(true);
    hide('uploadCard'); hide('introCard'); show('clearBtn');
    $('summaryBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clear_all() {
    S.ir = S.parsed = S.mapping = S.result = S.report = S.work_rows = null;
    S.value_overrides = {}; S.vm_expanded = {}; S.approved = {}; S.orig_table = S.conv_table = null;
    $('fileInput').value = '';
    ['summaryBar', 'compareCard', 'profileBar', 'clearBtn', 'flagLegend'].forEach(hide);
    show('uploadCard'); show('introCard');
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
  function recompute(first_time) {
    S.result = transform.run(S.parsed, S.mapping, { value_overrides: S.value_overrides });
    S.report = reconcile.build(S.parsed, S.mapping, S.result);
    S.work_rows = S.result.rows.map(function (r) { return r.slice(); });
    S.flag_info = build_flag_info();
    render_summary(); render_compare(first_time); render_scorecard(); render_mapping(); render_integrity();
    ['summaryBar', 'compareCard'].forEach(show);
    if (first_time) apply_collapse_defaults();
  }

  function render_summary() {
    var sc = S.report.scorecard, rep = S.report, n = function (x) { return x.toLocaleString(); };
    var skip = rep.rows.skipped.length, flagged = S.flag_info ? S.flag_info.total : rep.flag_count;
    $('summaryBar').innerHTML =
      '<span class="score-badge ' + sc.band + '">' + sc.pct + '%</span>' +
      '<span class="verdict">' + esc(sc.verdict) + '</span>' +
      '<span class="chips">' +
        '<span class="chip filechip" title="Uploaded file">📄 ' + esc(S.file_display || S.file_name) + '</span>' +
        '<span class="chip" title="Athlete rows written to the converted file"><b>' + n(rep.rows.out) + '</b> rows</span>' +
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

  // ---------- compare ----------
  function grid_scroll_pos(id) { var c = $(id), e = c && c.querySelector('.grid-scroll'); return e ? { l: e.scrollLeft, t: e.scrollTop } : null; }
  function grid_scroll_set(id, pos) { if (!pos) return; var c = $(id), e = c && c.querySelector('.grid-scroll'); if (e) { e.scrollLeft = pos.l; e.scrollTop = pos.t; } }
  function render_compare(first_time) {
    var keep_orig = grid_scroll_pos('originalGrid'), keep_conv = grid_scroll_pos('resultGrid');
    var orig_rows = S.parsed.data_rows.map(function (d) { return d.cells; });
    if (!S.orig_table) S.orig_table = TableView($('originalGrid'), { top_header: true });
    S.orig_table.set_data(S.parsed.headers, orig_rows);
    $('originalMeta').textContent = S.parsed.data_rows.length + ' rows · ' + S.parsed.headers.length + ' cols';

    if (!S.conv_table) {
      S.conv_table = TableView($('resultGrid'), {
        editable: true, show_flag_filter: true, col_menu: true, top_header: true,
        current_source: function (c) { var m = S.mapping[schema.TEMPLATE_SCHEMA[c].key]; return m && m.source; },
        on_remap: function (c, val) { mapper.set_mapping(S.mapping, schema.TEMPLATE_SCHEMA[c].key, val, S.parsed.headers); recompute(false); },
        on_edit: on_conv_edit
      });
    }
    S.conv_table.source_headers = S.parsed.headers;
    S.conv_table.get_flag = S.flag_info.get; S.conv_table.flagged_rows = S.flag_info.rows;
    S.conv_table.set_data(S.result.headers, S.work_rows);
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
      html += '<div class="map-row"><span class="tgt">' + esc(col.target) + '</span><select data-key="' + col.key + '">' + opts + '</select><span class="conf ' + conf + '">' + conf + '</span></div>';
    });
    document.querySelectorAll('.rrt-colmap').forEach(function (box) {
      box.innerHTML = html;
      box.querySelectorAll('select').forEach(function (sel) {
        sel.addEventListener('change', function () { mapper.set_mapping(S.mapping, sel.dataset.key, sel.value, S.parsed.headers); recompute(false); });
      });
    });
    render_value_map();
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
      b += '<select class="vm-setall" data-key="' + key + '" title="Set every value in this field at once">' +
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
      control = '<select data-key="' + key + '" data-src="' + esc(e.src_key) + '">' + opts + '</select>';
    } else {
      var ml = key === 'state' ? ' maxlength="2"' : '';
      control = '<input data-key="' + key + '" data-src="' + esc(e.src_key) + '"' + ml + ' value="' + esc(cur) + '">';
    }
    var reset = has_ov ? '<button class="vm-reset" data-key="' + key + '" data-src="' + esc(e.src_key) + '" title="Reset to the original / auto value">↺</button>' : '';
    var label = e.info.sample === '' ? '(blank)' : e.info.sample;
    return '<div class="vm-item"><span class="' + src_cls + '" title="' + esc(label) + '">' + esc(label) + ' <span class="dim">×' + e.info.count + '</span></span>' + control + reset + '</div>';
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
  function download() {
    io.grid_to_buffer(S.result.headers, S.conv_table.export_rows()).then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = S.file_name + ' - formatted.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }
  function save_profile() {
    if (!S.sig) return;
    S.store.save(S.sig, { mapping: mapper.mapping_to_text(S.mapping), value_overrides: S.value_overrides, saved_at: Date.now() });
    var lbl = document.querySelector('#saveProfileBtn .lbl'); if (!lbl) return;
    var t = lbl.textContent; lbl.textContent = 'Saved ✓'; setTimeout(function () { lbl.textContent = t; }, 1600);
  }

  var COMPARE_PANELS = { tables: 'tablesView', mapping: 'mappingView', scorecard: 'scoreView', integrity: 'integrityView', reference: 'referenceView', steps: 'stepsView' };
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
  }

  function init() {
    if (!window.ExcelJS) { alert('ExcelJS failed to load.'); return; }
    S.store = mapper.make_store(window.localStorage);
    wire_dropzone(); wire_collapsibles(); wire_layout(); wire_compare_seg();
    apply_theme();
    if ($('themeToggle')) $('themeToggle').addEventListener('click', toggle_theme);
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply_theme);
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

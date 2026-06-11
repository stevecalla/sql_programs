'use strict';
// snake_case file-naming for Salesforce race-results downloads. Pure, isomorphic, tested.
// Mirrors the original archive script so names are stable: single underscores, lowercase,
// `original_program_owner_versionid.ext`.

function snake_case(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')      // drop a trailing extension if present
    .replace(/[^a-z0-9]+/g, '_')       // non-alphanumerics -> underscore
    .replace(/^_+|_+$/g, '')           // trim leading/trailing underscores
    .replace(/_+/g, '_');              // collapse repeats
}

// Sanitize an already-chosen download name to "<snake_base><.ext-lowercased>".
function safe_file_name(value) {
  const s = String(value == null ? '' : value);
  const dot = s.lastIndexOf('.');
  const base = dot > 0 ? s.slice(0, dot) : s;
  const ext = dot > 0 ? s.slice(dot).toLowerCase() : '';
  return snake_case(base) + ext;
}

// [sanction_id_]program_name_owner_name_original_file_name_content_version_id.ext (single
// underscores) — the Sanction ID leads when known (most useful identifier), then the event (program),
// owner, the race-results title, and finally the unique ContentVersion id. A blank/absent sanction is
// simply omitted, so older 3-arg callers produce the same name as before.
// `file` carries Title, FileExtension, Id (ContentVersion id) from Salesforce.
function build_download_file_name(file, program_name, owner_name, sanction_id) {
  const parts = [
    snake_case(sanction_id || ''),
    snake_case(program_name || 'no_program_name'),
    snake_case(owner_name || 'no_owner_name'),
    snake_case((file && file.Title) || ''),
    snake_case((file && file.Id) || '')
  ].filter(Boolean);
  const ext = String((file && file.FileExtension) || 'file').toLowerCase();
  const stem = parts.join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return stem + '.' + ext;
}

module.exports = { snake_case, safe_file_name, build_download_file_name };

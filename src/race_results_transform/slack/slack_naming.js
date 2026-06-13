'use strict';
// snake_case file-naming for Slack race-results downloads. Reuses the SF naming primitives so the
// behaviour (single underscores, lowercase, trailing extension) matches the rest of the app.
// Name shape: <channel>_<uploader>_<filename>_<fileid>.ext
const sf_naming = require('../sf/sf_naming');

const snake_case = sf_naming.snake_case;
const safe_file_name = sf_naming.safe_file_name;

// `file` carries name/title + the Slack file id + extension. channel_name / uploader_name lead so the
// download is identifiable; the unique Slack file id trails to guarantee no collisions.
function build_download_file_name(file, channel_name, uploader_name) {
  const parts = [
    snake_case(channel_name || 'slack'),
    snake_case(uploader_name || 'no_uploader'),
    snake_case((file && (file.name || file.title)) || ''),
    snake_case((file && file.id) || '')
  ].filter(Boolean);
  const raw_ext = (file && (file.filetype || (file.name && file.name.indexOf('.') >= 0 && file.name.split('.').pop()))) || 'file';
  const ext = String(raw_ext).toLowerCase();
  const stem = parts.join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return stem + '.' + ext;
}

module.exports = { snake_case, safe_file_name, build_download_file_name };

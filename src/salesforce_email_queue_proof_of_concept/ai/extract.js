'use strict';
// Extract readable text from an attachment buffer for AI review. Text formats need no
// dependencies; binary formats (pdf/docx/xlsx) use OPTIONAL libraries the host can install
// (pdf-parse, mammoth, xlsx). If a parser isn't installed we degrade to a labelled placeholder
// so the pipeline never breaks.
const { html_to_text } = require('../sf/text_clean');

const TEXT_EXT = ['txt', 'csv', 'tsv', 'log', 'md', 'json', 'xml', 'html', 'htm'];

function try_require(name) { try { return require(name); } catch (e) { return null; } }

function unsupported(label, ext, o) {
  const size = o.content_size ? ' (' + o.content_size + ' bytes)' : '';
  return { ok: false, ext: ext, text: '', note: '[' + label + size + ': text extraction not available in this build]' };
}

// buffer: Node Buffer (or null). opts: { file_extension, title, content_size }
async function extract_text(buffer, opts) {
  const o = opts || {};
  const ext = String(o.file_extension || '').toLowerCase();
  const label = (o.title || 'attachment') + (ext ? '.' + ext : '');
  if (!buffer || !buffer.length) return { ok: false, ext: ext, text: '', note: '[' + label + ': empty]' };

  if (TEXT_EXT.indexOf(ext) >= 0) {
    let text = buffer.toString('utf8');
    if (ext === 'html' || ext === 'htm') text = html_to_text(text);
    return { ok: true, ext: ext, text: text };
  }
  if (ext === 'pdf') {
    const pdf = try_require('pdf-parse');
    if (!pdf) return unsupported(label, ext, o);
    try { const d = await pdf(buffer); return { ok: true, ext: ext, text: String(d.text || '').trim() }; }
    catch (e) { return { ok: false, ext: ext, text: '', note: '[' + label + ': PDF parse failed]' }; }
  }
  if (ext === 'docx') {
    const mammoth = try_require('mammoth');
    if (!mammoth) return unsupported(label, ext, o);
    try { const d = await mammoth.extractRawText({ buffer: buffer }); return { ok: true, ext: ext, text: String(d.value || '').trim() }; }
    catch (e) { return { ok: false, ext: ext, text: '', note: '[' + label + ': DOCX parse failed]' }; }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = try_require('xlsx');
    if (!XLSX) return unsupported(label, ext, o);
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const parts = wb.SheetNames.map(function (n) { return n + ':\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n]); });
      return { ok: true, ext: ext, text: parts.join('\n\n').trim() };
    } catch (e) { return { ok: false, ext: ext, text: '', note: '[' + label + ': spreadsheet parse failed]' }; }
  }
  if (IMAGE_EXT.indexOf(ext) >= 0) {
    const size = o.content_size ? ' (' + o.content_size + ' bytes)' : '';
    return { ok: false, ext: ext, text: '', note: '[' + label + size + ': image - read directly by the vision model (png/jpeg/gif/webp); not text-extracted]' };
  }
  return unsupported(label, ext, o);
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg'];
module.exports = { extract_text, TEXT_EXT, IMAGE_EXT };

// SINGLE source of truth for rendering a bot message as safe, formatted HTML across EVERY chatbot display —
// the test chat bubble, the conversation transcript, the stress-test results, and any future surface. This
// mirrors the public embeddable widget's formatter (modules/chatbot/public/widget_page.js `_wlink`) so the
// operator views render answers EXACTLY as a visitor sees them. Standardize here: a new surface should import
// `RichText` (or `renderRich`), never re-implement this. If the widget's formatter ever changes, change it here
// too so the two stay in lockstep.
//
// Rules (order matters): escape HTML first (never trust model output), then linkify [label](url) + bare URLs,
// then **bold** and *italic*.

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderRich(t) {
  let out = escapeHtml(t);
  // [label](https://url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, l, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + l + '</a>');
  // bare https://url (trailing punctuation left outside the link)
  out = out.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g, (m, pre, u) => { let tr = ''; const mm = /[.,!?;:)]+$/.exec(u); if (mm) { tr = mm[0]; u = u.slice(0, -tr.length); } return pre + '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>' + tr; });
  // **bold** then *italic*
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (m, x) => '<strong>' + x + '</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (m, pre, x) => pre + '<em>' + x + '</em>');
  return out;
}

// Drop-in element every chatbot surface uses to show a message. `plain` escapes only (no link/bold parsing) —
// use it for user-typed messages. `className` keeps each surface's own layout; line breaks are preserved.
export default function RichText({ text, className, plain = false, style }) {
  const html = plain ? escapeHtml(text) : renderRich(text);
  return <div className={className} style={{ whiteSpace: 'pre-wrap', ...(style || {}) }} dangerouslySetInnerHTML={{ __html: html }} />;
}

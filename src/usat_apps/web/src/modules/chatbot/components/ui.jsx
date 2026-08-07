import { useState } from 'react';
import { Collapsible, PortalModal } from '../../../lib/ui.jsx';   // shared logic (D: dedup)

export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Friendly Mountain-time timestamp (already MT wall-clock; not re-tz'd). e.g. "Aug 4, 2026 · 2:30 PM MT".
export function fmtMtn(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(s || '');
  const y = m[1], mo = _MONTHS[Number(m[2]) - 1] || m[2], d = Number(m[3]);
  let h = Number(m[4]); const min = m[5]; const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return mo + ' ' + d + ', ' + y + ' · ' + h + ':' + min + ' ' + ap + ' MT';
}
// Compact MTN datetime for list rows, e.g. "Aug 4, 2:30 PM".
export function fmtMtnShort(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(s || '').slice(0, 16);
  const mo = _MONTHS[Number(m[2]) - 1] || m[2], d = Number(m[3]);
  let h = Number(m[4]); const min = m[5]; const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return mo + ' ' + d + ', ' + h + ':' + min + ' ' + ap;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(String(iso).replace(' ', 'T') + 'Z');
  if (isNaN(t)) return String(iso).slice(0, 16);
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24); return d + 'd ago';
}

// Collapsible card — supports controlled (open/onToggle) OR uncontrolled (local state) use. Renders via the
// shared Collapsible with the chatbot's cbx-* classes so the look is unchanged.
const CBX_CARD_CLASSES = { card: 'cbx-card', head: 'cbx-cardhead', h: 'cbx-h', summary: 'cbx-summary', chev: 'cbx-chev', body: 'cbx-cardbody' };
export function Card({ title, summary, open, onToggle, children, classes }) {
  const [localOpen, setLocalOpen] = useState(!!open);
  const controlled = onToggle != null;
  const isOpen = controlled ? open : localOpen;
  const toggle = () => (controlled ? onToggle() : setLocalOpen((o) => !o));
  return (
    <Collapsible title={title} summary={summary} open={isOpen} onToggle={toggle} classes={classes || CBX_CARD_CLASSES}>
      {children}
    </Collapsible>
  );
}

// Modal — shared PortalModal with the chatbot's cbx-* classes.
export function Modal({ title, actions, wide, onClose, children }) {
  return (
    <PortalModal title={title} actions={actions} wide={wide} onClose={onClose} titleClass="cbx-modal-title" closeLabel="Close"
      classes={{ bg: 'cbx-modal-back', modal: 'cbx-modal', head: 'cbx-modal-head', actions: 'cbx-modal-actions', closeBtn: 'cbx-btn sm', body: 'cbx-modal-body' }}>
      {children}
    </PortalModal>
  );
}

import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { track } from '../../lib/track.js';
import RichText from './lib/richText.jsx';   // shared bot-message formatter (bold, links) — same across all chatbot views

function newConversationId() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'c_' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}
// The opening assistant greeting — shown in the bubble AND logged as the first turn (via /chat `intro`) so
// the review transcript includes it too.
function greeting(q) { return 'Hi! Ask me anything about the ' + (q || 'selected') + ' program.'; }

// Floating quick-test bubble, docked in the lower-right of the AI Chat Bot panel (fixed; this section is the
// only place it mounts). It talks to the SELECTED queue and logs as a test conversation, so anything you try
// here shows up in the left-rail thread list. A convenience twin of the right-rail "Test the assistant" card.
export default function ChatBubble({ queue, onLogged, load }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);
  const convoRef = useRef(newConversationId());
  const turnRef = useRef(0);
  const loadedNonceRef = useRef(0);

  // Start a fresh conversation: new id + turn counter, clear the transcript. The old (logged) test turns
  // stay in the thread list until deleted. Used on queue change and by the "New conversation" button.
  const reset = () => {
    convoRef.current = newConversationId(); turnRef.current = 0;
    setMsgs([{ role: 'bot', text: greeting(queue) }]);
  };
  // Reset the mini-conversation and refresh config whenever the queue changes.
  useEffect(() => {
    reset();
    if (queue) api.config(queue).then(setCfg).catch(() => setCfg(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Continue a selected conversation: when a thread is clicked in the left rail, the store hands us
  // { id, turns, nonce }. Load it into the bubble (same conversation_id, its turns, continue after them)
  // and open it. The nonce lets clicking the same thread reload it; onLogged does NOT set it, so chatting
  // in-place never reloads from under the user. The header "↺" still starts a brand-new conversation.
  useEffect(() => {
    if (!load || !load.nonce || load.nonce === loadedNonceRef.current) return;
    loadedNonceRef.current = load.nonce;
    convoRef.current = load.id;
    const turns = load.turns || [];
    turnRef.current = turns.length;   // continue after existing turns (also skips the intro greeting)
    setMsgs(turns.length ? turns.map((t) => ({ role: t.role === 'bot' ? 'bot' : 'user', text: t.text })) : [{ role: 'bot', text: greeting(queue) }]);
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, open, sending]);

  const send = async () => {
    const m = input.trim();
    if (!m || sending || !queue) return;
    setInput('');
    const next = msgs.concat([{ role: 'user', text: m }]);
    setMsgs(next); setSending(true);
    try {
      const r = await api.chat({ queue, message: m, history: next.slice(-6), conversation_id: convoRef.current, turn: turnRef.current, is_test: 1, intro: turnRef.current === 0 ? greeting(queue) : undefined });
      if (r && r.conversation_id) convoRef.current = r.conversation_id;
      turnRef.current += 1;
      setMsgs(next.concat([{ role: 'bot', text: r.answer || '(no answer)' }]));
      if (onLogged) onLogged(convoRef.current);
      try { track('chat_send', { panel: 'chatbot', view: 'bubble' }); } catch (e2) { /* noop */ }
    } catch (e) {
      setMsgs(next.concat([{ role: 'bot', text: 'Sorry — ' + (e.message || 'something went wrong') + '.' }]));
    } finally { setSending(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const ground = cfg ? (cfg.knowledge_chars ? ('grounded on ' + Number(cfg.knowledge_chars).toLocaleString() + ' chars') : 'no knowledge loaded') : '…';

  return (
    <>
      {open && (
        <div className="cb-panel" role="dialog" aria-label="AI Chat Bot quick test">
          <div className="cb-head">
            <div className="cb-head-t">
              <div>AI Chat Bot · {queue}</div>
              <div className="cb-sub">{ground}{cfg && cfg.model ? ' · ' + cfg.model : ''}</div>
            </div>
            <button className="cb-x" onClick={reset} aria-label="New conversation" title="Start a new conversation">↺</button>
            <button className="cb-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="cb-body" ref={bodyRef}>
            {msgs.map((m, i) => <RichText key={i} className={'cb-msg ' + m.role} text={m.text} plain={m.role !== 'bot'} />)}
            {sending && <div className="cb-msg bot cb-typing">…</div>}
          </div>
          <div className="cb-input">
            <textarea rows={1} value={input} placeholder={'Ask the ' + (queue || '') + ' bot…'} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
            <button className="cb-send" onClick={send} disabled={sending || !input.trim()}>Send</button>
          </div>
        </div>
      )}
      <button className={'cb-fab' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-label="Open AI Chat Bot" title="AI Chat Bot — quick test">
        {open ? '×' : '💬'}
      </button>
    </>
  );
}

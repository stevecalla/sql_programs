import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { track } from '../../lib/track.js';

function newConversationId() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'c_' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

// Floating quick-test bubble, docked in the lower-right of the AI Chat Bot panel (fixed; this section is the
// only place it mounts). It talks to the SELECTED queue and logs as a test conversation, so anything you try
// here shows up in the left-rail thread list. A convenience twin of the right-rail "Test the assistant" card.
export default function ChatBubble({ queue, onLogged }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);
  const convoRef = useRef(newConversationId());
  const turnRef = useRef(0);

  // Reset the mini-conversation and refresh config whenever the queue changes.
  useEffect(() => {
    convoRef.current = newConversationId(); turnRef.current = 0;
    setMsgs([{ role: 'bot', text: 'Hi! Ask me anything about the ' + (queue || 'selected') + ' program.' }]);
    if (queue) api.config(queue).then(setCfg).catch(() => setCfg(null));
  }, [queue]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, open, sending]);

  const send = async () => {
    const m = input.trim();
    if (!m || sending || !queue) return;
    setInput('');
    const next = msgs.concat([{ role: 'user', text: m }]);
    setMsgs(next); setSending(true);
    try {
      const r = await api.chat({ queue, message: m, history: next.slice(-6), conversation_id: convoRef.current, turn: turnRef.current, is_test: 1 });
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
            <button className="cb-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="cb-body" ref={bodyRef}>
            {msgs.map((m, i) => <div key={i} className={'cb-msg ' + m.role}>{m.text}</div>)}
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

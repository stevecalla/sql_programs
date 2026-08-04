import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';

// Docked chat bubble. Rendered ONLY by ChatbotSection, positioned absolute within .cb-card, so it appears
// in the assistant card's lower-right corner. Talks to /api/chatbot/chat (grounded on TeamUSA knowledge).
export default function ChatBubble() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [msgs, setMsgs] = useState([{ role: 'bot', text: 'Hi! I can answer questions about USA Triathlon and the Age Group Team USA program. What would you like to know?' }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, open, sending]);

  const send = async () => {
    const m = input.trim();
    if (!m || sending) return;
    setInput('');
    const next = msgs.concat([{ role: 'user', text: m }]);
    setMsgs(next);
    setSending(true);
    try {
      const r = await api.chat({ message: m, history: next.slice(-6) });
      setMsgs(next.concat([{ role: 'bot', text: r.answer || '(no answer)' }]));
    } catch (e) {
      setMsgs(next.concat([{ role: 'bot', text: 'Sorry — ' + (e.message || 'something went wrong') + '.' }]));
    } finally {
      setSending(false);
    }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const ground = cfg ? (cfg.knowledge_chars ? ('grounded on ' + Number(cfg.knowledge_chars).toLocaleString() + ' chars') : 'no knowledge loaded') : '…';

  return (
    <>
      {open && (
        <div className="cb-panel" role="dialog" aria-label="Team USA assistant">
          <div className="cb-head">
            <div className="cb-head-t">
              <div>Team USA Assistant</div>
              <div className="cb-sub">{ground}{cfg && cfg.model ? ' · ' + cfg.model : ''}</div>
            </div>
            <button className="cb-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="cb-body" ref={bodyRef}>
            {msgs.map((m, i) => <div key={i} className={'cb-msg ' + m.role}>{m.text}</div>)}
            {sending && <div className="cb-msg bot cb-typing">…</div>}
          </div>
          <div className="cb-input">
            <textarea rows={1} value={input} placeholder="Ask about Team USA…" onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
            <button className="cb-send" onClick={send} disabled={sending || !input.trim()}>Send</button>
          </div>
        </div>
      )}
      <button className={'cb-fab' + (open ? ' on' : '')} onClick={() => setOpen((o) => !o)} aria-label="Open Team USA assistant" title="Team USA assistant">
        {open ? '×' : '💬'}
      </button>
    </>
  );
}

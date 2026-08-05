import { useEffect } from 'react';
import * as store from './lib/store.js';
import ResizeHandle from '../../lib/ResizeHandle.jsx';
import Transcript from './components/Transcript.jsx';
import ChatbotAiPanel from './components/ChatbotAiPanel.jsx';
import ChatBubble from './ChatBubble.jsx';
import './chatbot.css';

// The AI Chat Bot main area (mirrors the email queue Section): two columns — transcript + AI panel — with a
// resizable divider. Queue & filters + the conversation list live in the platform siderail (ChatbotRail).
// Both read the shared store.
export default function ChatbotSection() {
  const s = store.useStore();
  useEffect(() => { store.init(); }, []);
  const cur = store.curQueueObj();
  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">AI Chat Bot{s.queue ? <span className="cbx-queue">{(cur && cur.name) || s.queue}</span> : null} <span className="cbx-pill">POC</span></h2>
        <span className="cbx-dim">Operator surface · grounded on curated knowledge only · never touches member PII</span>
      </div>
      <div className="cbx-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 6px ' + s.aiW + 'px' }}>
        <Transcript id={s.selectedId} turns={s.turns} loading={s.loadingTurns} />
        <ResizeHandle target="gridNext" dir={-1} min={store.AI_MIN} max={store.AI_MAX} def={store.AI_DEF}
          current={() => store.getState().aiW} onCommit={store.setAiW}
          title="Drag to resize the AI panel · double-click to reset" />
        <aside className="cbx-ai">
          <ChatbotAiPanel queue={s.queue} onLogged={store.onLogged} />
        </aside>
      </div>
      <ChatBubble queue={s.queue} onLogged={store.onLogged} />
    </div>
  );
}

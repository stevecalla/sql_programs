import { useState, useEffect } from 'react';
import * as store from './lib/store.js';
import { WidgetPublicBotCard, WidgetPreviewCard, WidgetAppearanceCard, WidgetColorCard, WidgetGtmCard, WidgetEmbedCard } from './components/ChatbotAiPanel.jsx';
import './chatbot.css';

// Chatbot → Public widget. Two-column shell: the live preview on the left (main) with the "open full page"
// link above it, and a right rail — Public bot (queue/channel), Bubble & theme, Bot color, GTM how-to,
// Embed code. Theme / bubble / color live HERE so the preview, controls, and embed snippet stay in lockstep.
export default function WidgetSection() {
  const [theme, setTheme] = useState('light');
  const [bubble, setBubble] = useState('triathlon');
  const [color, setColor] = useState('#152C53');   // USAT blue
  const [reload, setReload] = useState(0);          // bump to refetch the preview after the pinned queue changes
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const src = base + '/api/public-chatbot/widget?theme=' + theme + '&bubble=' + bubble + '&color=' + encodeURIComponent(color) + (reload ? '&_r=' + reload : '');

  // Live-update the shared left rail when the preview logs a new conversation. The widget (same-origin
  // iframe) postMessages 'chatbot_answer' to us; the server logs that turn fire-and-forget, so we reload the
  // thread list a beat later (and once more) to catch the write — the parity the training panel gets from
  // its onLogged callback. Rail queue/filter state is untouched; we just re-query.
  useEffect(function () {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return;
      var d = e.data;
      if (!d || d.source !== 'usat-chatbot' || d.event !== 'chatbot_answer') return;
      setTimeout(function () { store.loadThreads(); }, 1000);
      setTimeout(function () { store.loadThreads(); }, 2600);
    }
    window.addEventListener('message', onMsg);
    return function () { window.removeEventListener('message', onMsg); };
  }, []);
  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">Public widget <span className="cbx-pill">GTM</span></h2>
        <span className="cbx-dim">Embeddable, member-facing bot · Team USA · strict grounding · curated knowledge only — no PII</span>
      </div>
      <div className="cbx-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 420px' }}>
        <div style={{ overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
          <div className="cbx-row-end" style={{ marginBottom: 8 }}>
            <a className="cbx-btn xs" href={src} target="_blank" rel="noreferrer">open full page ↗</a>
          </div>
          <WidgetPreviewCard src={src} theme={theme} />
        </div>
        <aside className="cbx-ai">
          <WidgetPublicBotCard onSaved={function () { setReload(function (n) { return n + 1; }); }} />
          <WidgetAppearanceCard theme={theme} setTheme={setTheme} bubble={bubble} setBubble={setBubble} />
          <WidgetColorCard color={color} setColor={setColor} />
          <WidgetGtmCard />
          <WidgetEmbedCard theme={theme} bubble={bubble} color={color} />
        </aside>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { WidgetPreviewCard, WidgetAppearanceCard, WidgetColorCard, WidgetGtmCard, WidgetEmbedCard } from './components/ChatbotAiPanel.jsx';
import './chatbot.css';

// Chatbot → Public widget. Two-column shell: the live preview on the left (main) with the "open full page"
// link above it, and a right rail — Bubble & theme, Bot color, GTM how-to, Embed code. Theme / bubble /
// color live HERE so the preview, the controls, and the embed snippet all stay in lockstep.
export default function WidgetSection() {
  const [theme, setTheme] = useState('light');
  const [bubble, setBubble] = useState('triathlon');
  const [color, setColor] = useState('#152C53');   // USAT blue
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const src = base + '/api/public-chatbot/widget?theme=' + theme + '&bubble=' + bubble + '&color=' + encodeURIComponent(color);
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
          <WidgetAppearanceCard theme={theme} setTheme={setTheme} bubble={bubble} setBubble={setBubble} />
          <WidgetColorCard color={color} setColor={setColor} />
          <WidgetGtmCard />
          <WidgetEmbedCard theme={theme} bubble={bubble} color={color} />
        </aside>
      </div>
    </div>
  );
}

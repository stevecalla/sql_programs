import { useState } from 'react';
import { WidgetPreviewCard, WidgetColorCard, WidgetGtmCard, WidgetEmbedCard } from './components/ChatbotAiPanel.jsx';
import './chatbot.css';

// Chatbot → Public widget. Same two-column shell as the operator / email-queue pages: the live widget
// preview on the left (main), a right rail with the Bot color card, the GTM how-to, and the copy-paste
// embed code. Theme / bubble / color live HERE so the preview and the embed snippet stay in lockstep.
export default function WidgetSection() {
  const [theme, setTheme] = useState('light');
  const [bubble, setBubble] = useState('triathlon');
  const [color, setColor] = useState('#152C53');   // USAT blue
  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">Public widget <span className="cbx-pill">GTM</span></h2>
        <span className="cbx-dim">Embeddable, member-facing bot · Team USA · strict grounding · curated knowledge only — no PII</span>
      </div>
      <div className="cbx-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 420px' }}>
        <div style={{ overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
          <WidgetPreviewCard theme={theme} setTheme={setTheme} bubble={bubble} setBubble={setBubble} color={color} />
        </div>
        <aside className="cbx-ai">
          <WidgetColorCard color={color} setColor={setColor} />
          <WidgetGtmCard />
          <WidgetEmbedCard theme={theme} bubble={bubble} color={color} />
        </aside>
      </div>
    </div>
  );
}

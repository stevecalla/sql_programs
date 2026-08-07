import { WidgetPreviewCard, WidgetGtmCard, WidgetEmbedCard } from './components/ChatbotAiPanel.jsx';
import './chatbot.css';

// Chatbot → Public widget. Same two-column shell as the operator / email-queue pages: the live widget
// preview on the left (main), a right rail with the GTM how-to + the copy-paste embed code. Styling the
// widget here is exactly what ships to external sites.
export default function WidgetSection() {
  return (
    <div className="cbx-wrap">
      <div className="cbx-topbar">
        <h2 className="cbx-title">Public widget <span className="cbx-pill">GTM</span></h2>
        <span className="cbx-dim">Embeddable, member-facing bot · Team USA · strict grounding · curated knowledge only — no PII</span>
      </div>
      <div className="cbx-main2" style={{ gridTemplateColumns: 'minmax(0,1fr) 420px' }}>
        <div style={{ overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
          <WidgetPreviewCard />
        </div>
        <aside className="cbx-ai">
          <WidgetGtmCard />
          <WidgetEmbedCard />
        </aside>
      </div>
    </div>
  );
}

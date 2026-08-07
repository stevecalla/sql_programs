import { WidgetPreviewCard } from './components/ChatbotAiPanel.jsx';

// Chatbot → Public widget. A dedicated, discoverable panel for the embeddable public bot: a live preview of
// the real widget plus the copy-paste GTM/iframe embed. Styling the widget here is exactly what ships.
export default function WidgetSection() {
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h2>Public widget</h2>
      <p className="muted small" style={{ marginTop: -4 }}>The embeddable, member-facing bot — Team USA, strict grounding, curated knowledge only. Preview it, style it, and copy the embed for GTM.</p>
      <WidgetPreviewCard />
    </div>
  );
}

import ChatBubble from './ChatBubble.jsx';
import './chatbot.css';

// The Chatbot section (POC). The bubble is docked in the lower-right corner of the assistant CARD below
// (position:absolute within .cb-card), so for this internal instance it stays inside the card rather than
// floating over the whole app. Grounded on the TeamUSA email-queue knowledge; internal-only for now.
export default function ChatbotSection() {
  return (
    <div className="page cb-page">
      <h2>Team USA Assistant <span className="cb-pill">POC</span></h2>
      <div className="cb-card">
        <p className="muted" style={{ maxWidth: 620, marginTop: 0 }}>
          An internal preview of the Team USA chatbot. It answers from the <b>same curated Team USA knowledge</b> the
          email queue uses — and only that. If something isn’t in the knowledge, it will say so rather than guess.
        </p>
        <p className="muted" style={{ maxWidth: 620 }}>
          Click the chat bubble in the corner of this card to try it. This is the internal test surface; the public
          website widget comes later.
        </p>
        <ChatBubble />
      </div>
    </div>
  );
}

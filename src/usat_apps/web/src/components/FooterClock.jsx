import { useEffect, useState } from 'react';

// Footer at the bottom of the main content: platform label on the left, running date + clock on right.
export default function FooterClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="footer-clock">
      <span className="footer-src">USAT Apps platform</span>
      <span className="fc-when" aria-label="current date and time">
        <span className="fc-day">{date}</span> · <span className="fc-time">{time}</span>
      </span>
    </div>
  );
}

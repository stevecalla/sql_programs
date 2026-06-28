import { useEffect, useState } from 'react';

// Running clock shown at the bottom of the main content: full date (with weekday) + local time,
// ticking every second.
export default function FooterClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="footer-clock" aria-label="current date and time">
      <span className="fc-day">{date}</span> · <span className="fc-time">{time}</span>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Source DB table(s) feeding each page — shown on the left of the footer. Mirrors the merge footer.
const SOURCES = {
  '/': ['participation (usat_sales_db)'],
  '/participation-maps': ['participation (usat_sales_db)'],
  '/reference': [],
  '/admin': ['reporting auth + reporting_events'],
};

// Footer at the bottom of the main content: source table(s) on the left, running date + clock right.
export default function FooterClock() {
  const [now, setNow] = useState(new Date());
  const { pathname } = useLocation();
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tables = SOURCES[pathname] || [];
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="footer-clock">
      <span className="footer-src">
        {tables.length
          ? <>Source {tables.length > 1 ? 'tables' : 'table'}: <code>{tables.join(', ')}</code></>
          : <>&nbsp;</>}
      </span>
      <span className="fc-when" aria-label="current date and time">
        <span className="fc-day">{date}</span> · <span className="fc-time">{time}</span>
      </span>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Footer at the bottom of the main content: the source DB table(s) feeding the current page on the
// left, running date + clock on the right. Ported from src/reporting's FooterClock (per-route source).
const PART_SRC = [
  'all_participation_data_with_membership_match_summary',
  'all_participation_data_with_membership_match_flows',
  'all_participation_data_with_membership_match_events',
];
const SOURCES = {
  '/reporting/participation-maps': PART_SRC,
  '/metrics': ['usat_apps_events'],
  '/admin/users': ['usat_apps auth store + usat_apps_events'],
};

export default function FooterClock() {
  const [now, setNow] = useState(new Date());
  const { pathname } = useLocation();
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tables = SOURCES[pathname];
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <div className="footer-clock">
      <span className="footer-src">
        {tables && tables.length
          ? <>Source {tables.length > 1 ? 'tables' : 'table'}: <code>{tables.join(', ')}</code></>
          : 'USAT Apps platform'}
      </span>
      <span className="fc-when" aria-label="current date and time">
        <span className="fc-day">{date}</span> · <span className="fc-time">{time}</span>
      </span>
    </div>
  );
}

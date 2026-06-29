import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// Source DB table(s) feeding each page's grid — shown on the left of the footer.
const SOURCES = {
  '/': ['salesforce_account_duplicate_snapshot', 'salesforce_duplicate_consolidated_cluster', 'salesforce_duplicate_merge_id_review'],
  '/duplicates': ['salesforce_duplicate_consolidated_cluster'],
  '/merge-id': ['salesforce_duplicate_merge_id_review'],
  '/accounts': ['salesforce_account_duplicate_snapshot'],
  '/process': ['salesforce_duplicate_detection_run'],
  '/tuning': ['salesforce_duplicate_sweep_profile'],
  '/merge-admin': ['salesforce_duplicate_consolidated_cluster (+ live Salesforce)'],
  '/merge-process': ['salesforce_merge_queue', 'salesforce_merge_history', 'salesforce_merge_premerge_snapshot'],
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

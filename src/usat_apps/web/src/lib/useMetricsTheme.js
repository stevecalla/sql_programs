import { useEffect, useState } from 'react';

// Shared hook: mirror the app's data-theme attribute into React state so metrics charts recolor
// when the user toggles light/dark. Used by both the platform Usage-metrics page and the SF Merge
// metrics page (previously each page carried an identical copy of this effect).
export function useMetricsTheme() {
  const [theme, setTheme] = useState('');
  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

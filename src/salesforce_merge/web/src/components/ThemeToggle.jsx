import { useEffect, useState } from 'react';
import { apply_theme, effective_dark, toggle_theme, watch_system } from '../lib/theme.js';

// ☀/☾ light-dark toggle, mirroring the email-queue. Stored choice wins; otherwise follows the OS.
export default function ThemeToggle() {
  const [dark, setDark] = useState(effective_dark());

  useEffect(() => {
    apply_theme();
    watch_system(() => setDark(effective_dark()));
  }, []);

  const onClick = () => { toggle_theme(); setDark(effective_dark()); };

  return (
    <button
      className="btn"
      data-theme-toggle
      aria-label="Toggle light or dark theme"
      title={'Switch to ' + (dark ? 'light' : 'dark') + ' theme'}
      onClick={onClick}
    >
      {dark ? '☀ Light' : '☾ Dark'}
    </button>
  );
}

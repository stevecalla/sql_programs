import { NavLink } from 'react-router-dom';
import EnvSwitch from './EnvSwitch.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import NavDropdown from './NavDropdown.jsx';

// Grouped by function: standalone links plus dropdowns for related pages.
const REVIEW = [
  { to: '/duplicates', label: 'Duplicates' },
  { to: '/merge-id', label: 'Merge-ID' },
  { to: '/accounts', label: 'All accounts' },
];
const ADMIN = [
  { to: '/metrics', label: 'Metrics' },
  { to: '/admin', label: 'Admin' },
];

export default function TopNav({ user, env, setEnv, onLogout }) {
  const linkClass = ({ isActive }) => (isActive ? 'link active' : 'link');
  return (
    <header className="nav">
      <span className="brandmark" aria-hidden="true">M</span>
      <div className="brand">Account Merge Console</div>
      <nav className="links">
        <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
        <NavDropdown label="Review" items={REVIEW} />
        <NavLink to="/get-duplicates" className={linkClass}>Get Duplicates</NavLink>
        <NavDropdown label="Admin" items={ADMIN} />
        <NavLink to="/reference" className={linkClass}>Reference</NavLink>
      </nav>
      <div className="right">
        <EnvSwitch env={env} setEnv={setEnv} />
        <ThemeToggle />
        <span className="user">{user.user}</span>
        <button className="btn" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

import { NavLink } from 'react-router-dom';
import EnvSwitch from './EnvSwitch.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const LINKS = [
  ['/', 'Dashboard'],
  ['/duplicates', 'Duplicates'],
  ['/merge-id', 'Merge-ID'],
  ['/accounts', 'All Accounts'],
  ['/admin', 'Admin'],
  ['/metrics', 'Metrics'],
];

export default function TopNav({ user, env, setEnv, onLogout }) {
  return (
    <header className="nav">
      <span className="brandmark" aria-hidden="true">M</span>
      <div className="brand">Account Merge Console</div>
      <nav className="links">
        {LINKS.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'link active' : 'link')}>
            {label}
          </NavLink>
        ))}
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

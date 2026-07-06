import React from 'react';
import { NavLink } from 'react-router-dom';

// Shared top nav for the reporting suite. As more reports arrive they become NavLinks here (and
// pages/routes in App.jsx) — one app, many report pages, per plans_and_notes/PHASE_PLAN.md.
export default function AppShell({ me, onLogout, children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          USAT Reporting
        </div>
        <nav className="tabs">
          <NavLink to="/participation-maps" className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>
            Participation maps
          </NavLink>
        </nav>
        <div className="who">
          <span className="user">{me.user}{me.role === 'admin' ? ' · admin' : ''}</span>
          <button className="link" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

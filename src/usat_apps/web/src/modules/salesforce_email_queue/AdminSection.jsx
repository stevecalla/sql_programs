import { Routes, Route, Navigate } from 'react-router-dom';
import AdminOverview from './pages/AdminOverview.jsx';
import AdminMaintenance from './pages/AdminMaintenance.jsx';
import AdminOperations from './pages/AdminOperations.jsx';
import AdminLogs from './pages/AdminLogs.jsx';
import AdminSettings from './pages/AdminSettings.jsx';
import AdminAccess from './pages/AdminAccess.jsx';
import AdminReference from './pages/AdminReference.jsx';

// Inner router for the Email Queue admin area (mounted at /admin/email-queue/* by nav.js nested:true).
// Index = Overview, matching the standalone admin's default pane + the rail's first link.
export default function AdminSection() {
  return (
    <Routes>
      <Route index element={<AdminOverview />} />
      <Route path="overview" element={<AdminOverview />} />
      <Route path="maintenance" element={<AdminMaintenance />} />
      <Route path="operations" element={<AdminOperations />} />
      <Route path="logs" element={<AdminLogs />} />
      <Route path="settings" element={<AdminSettings />} />
      <Route path="access" element={<AdminAccess />} />
      <Route path="reference" element={<AdminReference />} />
      <Route path="*" element={<Navigate to="/admin/email-queue" replace />} />
    </Routes>
  );
}

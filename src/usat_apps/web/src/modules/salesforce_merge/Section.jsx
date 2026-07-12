import { Routes, Route, Navigate } from 'react-router-dom';
import './merge.css';
import Dashboard from './pages/Dashboard.jsx';
import Duplicates from './pages/Duplicates.jsx';
import MergeId from './pages/MergeId.jsx';
import AllAccounts from './pages/AllAccounts.jsx';
import GetDuplicates from './pages/GetDuplicates.jsx';
import SelectMerges from './pages/SelectMerges.jsx';
import MergeProcess from './pages/MergeProcess.jsx';
import Restore from './pages/Restore.jsx';
import Tuning from './pages/Tuning.jsx';
import Reference from './pages/Reference.jsx';

// salesforce_merge module — front-end entry. Renders merge's pages under the platform shell via merge's
// own nested routes (the drill-in rail lives in App.jsx / MergeRail.jsx). All merge CSS is scoped under
// .sfmerge so merge's tokens (red accent, 14px) can't restyle the rest of the platform (navy shell).
export default function MergeSection() {
  return (
    <div className="sfmerge">
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="duplicates" element={<Duplicates />} />
        <Route path="merge-id" element={<MergeId />} />
        <Route path="accounts" element={<AllAccounts />} />
        <Route path="get-duplicates" element={<GetDuplicates />} />
        <Route path="select-merges" element={<SelectMerges />} />
        <Route path="merge-process" element={<MergeProcess />} />
        <Route path="restore" element={<Restore />} />
        <Route path="tuning" element={<Tuning />} />
        <Route path="reference" element={<Reference />} />
        <Route path="*" element={<Navigate to="/salesforce/merge" replace />} />
      </Routes>
    </div>
  );
}

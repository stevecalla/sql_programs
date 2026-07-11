import { api } from '../../lib/api.js';
import ConsolePanel from './ConsolePanel.jsx';

// Operations · Fleet — the root menu.js console (proxy + all servers). Kept at /ops/operations.
export default function OpsOperationsFleet() {
  return <ConsolePanel title="Operations · Fleet" subtitle="root menu.js · proxy + all servers" fetcher={api.opsConsole} runner={api.opsConsoleRun} />;
}

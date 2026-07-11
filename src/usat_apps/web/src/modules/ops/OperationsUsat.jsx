import { api } from '../../lib/api.js';
import ConsolePanel from './ConsolePanel.jsx';

// Operations · USAT Apps — the src/usat_apps/menu.js console (tests, build, users, pm2, and the
// participation data pipeline). Served at /ops/operations-usat.
export default function OpsOperationsUsat() {
  return <ConsolePanel title="Operations · USAT Apps" subtitle="usat_apps/menu.js · tests, build, users, pm2, participation pipeline" fetcher={api.opsConsoleUsat} runner={api.opsConsoleUsatRun} />;
}

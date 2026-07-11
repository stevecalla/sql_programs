// participation_maps module — front-end entry. Renders the ported native Plotly participation map
// (which itself renders ParticipationTabs + Reference). Lazy-loaded by the platform nav
// (web/src/nav.js), so Plotly ships in this module's own bundle chunk and only downloads when a user
// opens the map. Ported from src/reporting (branch reporting_app_v21).
import './participation.css';
import ParticipationMap from './ParticipationMap.jsx';

export default function ParticipationMapsSection() {
  return <ParticipationMap />;
}

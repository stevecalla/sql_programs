import React, { useEffect } from 'react';
import { api } from '../lib/api.js';

// The full interactive dashboard (the proven standalone build) rendered in an iframe, with live data
// injected server-side (/api/participation-view). This gives 1:1 parity with the standalone POC while
// the data comes from the API (fixture now, MySQL after Phase 1). Base-aware so it also works behind
// the /reporting proxy.
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

export default function ParticipationMaps() {
  useEffect(() => {
    api.event({ event_name: 'page_view', panel: 'participation-maps', view: 'participation-maps' });
  }, []);

  return (
    <div className="dash-page">
      <iframe title="Participation maps" className="dash-frame" src={BASE + '/api/participation-view'} />
    </div>
  );
}

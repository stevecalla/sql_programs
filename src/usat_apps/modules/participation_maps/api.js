'use strict';
// participation_maps module — server API. Routes namespaced under /api/participation-maps/* and gated by
// the module's panel key. Ported from src/reporting/api/routes.js (branch reporting_app_v21).
//   GET .../bootstrap  full map payload   GET .../unique  distinct athletes (live)
//   GET .../home       home-side adult distinct (penetration numerator)
//   GET .../reach      resident reach split (Opportunity card)   GET .../dataset  "data as of" badge
const { require_panel } = require('../../auth/require_auth');
const participation = require('./store/participation_read');

function mount(app) {
  const gate = require_panel('participation-maps');

  app.get('/api/participation-maps/bootstrap', gate, async function (req, res) {
    try {
      const r = await participation.get_bootstrap({ force: req.query.force === '1' });
      res.json({ ok: true, source: r.source, generated_at: new Date(r.at).toISOString(), data: r.payload });
    } catch (e) {
      res.status(e.code === 'NO_DATA' ? 503 : 500).json({ ok: false, error: e.message, code: e.code || null });
    }
  });

  app.get('/api/participation-maps/unique', gate, async function (req, res) {
    try {
      const q = req.query;
      const sel = {
        years: (q.years || '').split(',').filter(Boolean),
        months: (q.months || 'all').split(',').filter(Boolean),
        region: q.region || null, state: q.state || null, ironman: q.ironman || null,
      };
      const r = await participation.unique_for_selection(sel);
      res.json({ ok: true, national: r.national, byState: r.byState, byRegion: r.byRegion });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/participation-maps/home', gate, async function (req, res) {
    try {
      const q = req.query;
      const sel = {
        years: (q.years || '').split(',').filter(Boolean),
        months: (q.months || 'all').split(',').filter(Boolean),
        ironman: q.ironman || null,
      };
      const r = await participation.home_athletes_for_selection(sel);
      res.json({ ok: true, national: r.national, byHomeState: r.byHomeState, byHomeRegion: r.byHomeRegion, byHomeStateOnlyIn: r.byHomeStateOnlyIn, byHomeRegionOnlyIn: r.byHomeRegionOnlyIn });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/participation-maps/reach', gate, async function (req, res) {
    try {
      const q = req.query;
      const sel = {
        years: (q.years || '').split(',').filter(Boolean),
        months: (q.months || 'all').split(',').filter(Boolean),
        ironman: q.ironman || null,
        ageGroup: q.ageGroup === 'youth' ? 'youth' : 'adult',
      };
      const r = await participation.reach_for_selection(sel);
      res.json({ ok: true, national: r.national, byHomeState: r.byHomeState });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/participation-maps/dataset', gate, async function (req, res) {
    try {
      const r = await participation.get_bootstrap();
      res.json({ ok: true, source: r.source, generated_at: new Date(r.at).toISOString(),
        last_updated: (r.payload && r.payload.lastUpdated) || null,
        last_updated_utc: (r.payload && r.payload.lastUpdatedUtc) || null });
    } catch (e) {
      res.status(e.code === 'NO_DATA' ? 503 : 500).json({ ok: false, error: e.message, code: e.code || null });
    }
  });
}

module.exports = { mount };

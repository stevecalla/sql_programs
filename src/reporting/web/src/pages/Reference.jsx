import { useEffect, useRef, useState } from 'react';

// Native reference page — definitions, formulas, source tables, and data caveats for the participation
// reports. Merges the standalone dashboard's full Reference content with the live-MySQL field mapping.
// Rendered both as a route (/reference) and as the "Reference" tab under participation-maps.

// Live source tables (local usat_sales_db). The app reads the pre-aggregated summary/flows/events tables
// that step_3i builds from the parent participation table.
const SRC = {
  parent: 'all_participation_data_with_membership_match',
  summary: 'all_participation_data_with_membership_match_summary',
  flows: 'all_participation_data_with_membership_match_flows',
  events: 'all_participation_data_with_membership_match_events',
};

// Each section: { title, note?, items:[ [term, definition], ... ] }. Rendered as cards + exported to CSV.
const REF = [
  { title: 'Reading the dashboard', items: [
    ['Controls', 'Year, Month, Map style, Metric and the Display-options menu all update the whole page at once.'],
    ['Combine periods', 'Select multiple years or months (checkbox dropdowns) to combine periods.'],
    ['Cross-filter', 'Click a state or region on the map to filter the Events tab (and pick the State-flows state).'],
    ['Sort & export', 'Sort any table by clicking its header; every table exports to CSV.'],
  ] },
  { title: 'Map styles', note: 'Choropleth, Pins and YoY are independent on/off toggles — turn the fill off for a neutral map, or overlay pins on any fill.', items: [
    ['Choropleth', 'States shaded by the selected metric.'],
    ['Pins', 'Event locations plotted by ZIP code — navy = non-IRONMAN, red = IRONMAN, circle sized by participants.'],
    ['YoY', 'Year-over-year change by state (percent or absolute), with numbered gold badges on the top movers.'],
    ['Flows', '3D arcs showing athlete travel from home state to event state; the base map shades net importers vs exporters.'],
  ] },
  { title: 'Core metrics & how they are calculated', items: [
    ['Participants', 'Count of participation records (event starts) in the period. One athlete racing 3 times counts as 3.'],
    ['Unique participants', 'Distinct athletes for the exact selection — COUNT(DISTINCT id_profiles), i.e. athletes who raced while holding an active USAT membership. This is the one non-additive metric (an athlete spans many events/states/months), so it is counted live from the base table for whatever years / months / filters you pick — never summed from per-slice counts. It updates a beat after the additive metrics (brief “…”).'],
    ['% unique', 'Unique participants ÷ Participants (uses the exact live unique).'],
    ['Races / participant', 'Participants ÷ Unique participants (uses the exact live unique).'],
    ['Home (in-state)', 'Participations where the athlete’s home state = the event state.'],
    ['Away (cross-state travel)', 'Participations where the home state is one of the 50 states and ≠ the event state.'],
    ['Unknown home', 'Participations whose home state is missing/blank or not one of the 50 states (e.g. DC, territories, foreign, military) — can’t be placed as home or away.'],
    ['Reconciliation', 'Home + Away + Unknown home = Participants, at every level.'],
    ['Home %', 'Home ÷ (Home + Away) — the known-home basis (excludes Unknown home).'],
    ['Unknown home %', 'Unknown home ÷ Participants.'],
    ['New / Repeat', 'First-time vs returning athletes in the period.'],
    ['IRONMAN share', 'IRONMAN participations ÷ all participations.'],
    ['Female %, age bands', 'Share of participations in that group.'],
  ] },
  { title: 'The matrices (travel)', items: [
    ['Cell (row = home, col = event)', 'Participations by that home state/region’s athletes racing in that event state/region.'],
    ['Diagonal', 'State matrix: raced in their own state (in-state). Region matrix: raced within their own region.'],
    ['By its athletes (row total)', 'All participations by that state/region’s athletes (in-state + traveled).'],
    ['Hosted here (column total)', 'All participations held there (locals + visitors).'],
    ['Traveled out / in', 'By-its-athletes − diagonal / Hosted-here − diagonal.'],
    ['Net ±', 'Hosted here − By its athletes (= Traveled in − Traveled out). Positive = net importer/destination; negative = net exporter/feeder.'],
    ['Grand total travel', 'Sum of all off-diagonal cells = total participations − in-state races.'],
    ['Region matrix, two measures', '"Out/Into region" = crossed a region line (reconciles with the diagonal); "Out/Into state" = raced in any other state (total cross-state travel, incl. trips within the same region).'],
  ] },
  { title: 'Cross-state travel — why there are two totals', note: 'Both measure racing outside the home state, from different sources; they don’t match by design.', items: [
    ['Traveled-away KPI (Summary)', 'Counted per participation record; includes away trips whose destination is outside the 50-state grid (DC, territories). The fullest total.'],
    ['Matrix grand-total cell', 'Sums only flows between the 50 mapped states, so it is slightly lower.'],
    ['Unmatched records', 'Home + Away can fall short of Participants because some records have no usable home state.'],
  ] },
  { title: 'Year-over-year (YoY) map', note: 'Compares the selected metric between a baseline year (from) and a comparison year (to), one value per state.', items: [
    ['% change', 'Round to 1 decimal of (to − from) ÷ from. Diverging scale: red = decline, green = growth, ~white = 0.'],
    ['Absolute change', 'to − from, same diverging red→green scale.'],
    ['Like-for-like months', 'Only months present in BOTH years are compared, so a partial "to" year measures against the same months of the baseline.'],
    ['Zero baseline (0 → n)', 'A state with 0 in the baseline has no valid % (division by zero); shown as "0 → n (new)", shaded top-positive, and excluded from the Top-N gainers ranking.'],
    ['No data either year', 'States with 0 in both years are left blank (n/a).'],
    ['Top movers', 'Numbered gold badges mark the ranked gainers, decliners, or absolute movers.'],
  ] },
  { title: 'Regions (custom USAT groupings)', items: [
    ['Pacific (6)', 'AK, CA, HI, NV, OR, WA'],
    ['Rockies (7)', 'AZ, CO, ID, MT, NM, UT, WY'],
    ['Central (8)', 'IA, KS, MN, ND, NE, OK, SD, TX'],
    ['Midwest (8)', 'IL, IN, KY, MI, OH, VA, WI, WV'],
    ['Southeast (10)', 'AL, AR, FL, GA, LA, MO, MS, NC, SC, TN'],
    ['Northeast (11)', 'CT, DE, MA, MD, ME, NH, NJ, NY, PA, RI, VT'],
  ] },
  { title: 'Fields used (live MySQL)', note: 'The map keys on the event state; reporting stats use the race-side columns (name_events_rr / id_events_rr / id_sanctioning_events), not the membership-purchase columns.', items: [
    ['Event state', 'state_code_events (50 states)'],
    ['Home state', 'member_state_code_addresses — Home = home state equals event state'],
    ['Year / Month', 'start_date_year_races / start_date_month_races'],
    ['Participants / Events / Races', 'COUNT(id_rr) / COUNT(DISTINCT id_events_rr) / COUNT(DISTINCT id_race_rr)'],
    ['Gender', "gender_code = 'F' / 'M'"],
    ['Age bands', 'age_as_race_results_bin (4-19 = 4-9+10-19; 60+ = 60-69…90-99; bad_age excluded)'],
    ['IRONMAN', 'is_ironman = 1 (curated allow-list materialized upstream; rolled up MAX per event)'],
    ['New / Repeat', "member_created_at_category_starts_mp = 'created_year' is new; else repeat"],
    ['Unique athletes', 'COUNT(DISTINCT id_profiles) — active-member profile; counted live per selection via /api/unique, restricted to the 50 event-states to match the participant basis.'],
    ['Cross-state flows', 'home → event COUNT(id_rr), both 50-state, home ≠ event'],
  ] },
  { title: 'Source tables & freshness', note: 'Live, read-only local ' + 'usat_sales_db' + '. Full detail: plans_and_notes/FIELD_MAPPING.md.', items: [
    ['Parent table', SRC.parent + ' — one row per participation (id_rr).'],
    ['Summary table', SRC.summary + ' — state/region metrics by year-month (feeds the maps + Summary).'],
    ['Flows table', SRC.flows + ' — home → event origin-destination pairs (feeds the matrices + Flows).'],
    ['Events table', SRC.events + ' — per-event roll-ups (feeds the Events tab + Pins).'],
    ['Last updated', 'Shown in the header — the source table’s timestamp (created_at).'],
    ['Partial years', 'The current year is year-to-date (partial) — not comparable to full years.'],
    ['Multi-period selections', 'Participations, gender, age, home/away, IRONMAN and new/repeat are exact. Unique athletes (and % unique, races/participant) are counted live from the base table for the exact selection, so they are exact too — including multi-month and multi-year. Events and Races are still distinct counts summed per period. The Events-tab unique total shows the live distinct across the filtered events, not the column sum.'],
    ['Coverage', 'Event state / gender / age / IRONMAN / new-repeat ~100%; home state ~90% (the rest count as away/unknown).'],
  ] },
];

function downloadCSV(fname, header, rows) {
  const esc = (v) => { v = (v == null) ? '' : ('' + v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = header.map(esc).join(',') + '\n' + rows.map((r) => r.map(esc).join(',')).join('\n');
  const b = new Blob([csv], { type: 'text/csv' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = fname; a.click();
}
function exportRef() {
  const rows = [];
  REF.forEach((s) => {
    if (s.note) rows.push([s.title, '(note)', s.note]);
    s.items.forEach(([t, d]) => rows.push([s.title, t, d]));
  });
  downloadCSV('participation_reference.csv', ['Section', 'Term', 'Definition'], rows);
}

export default function Reference() {
  const fsRef = useRef(null);
  const [full, setFull] = useState(false);
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === fsRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen(); else if (fsRef.current && fsRef.current.requestFullscreen) fsRef.current.requestFullscreen(); };
  const btn = { padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' };
  return (
    <div className="page reference" ref={fsRef} style={full ? { background: dark ? '#0b1220' : '#ffffff', padding: 16, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Reference &amp; definitions</h2>
          <p className="muted" style={{ marginTop: 0 }}>What the data means, how each number is calculated, and what to watch for.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={toggleFs} title="Fullscreen" style={btn}>{full ? 'Exit ⛶' : '⛶ Full'}</button>
          <button onClick={exportRef} title="Download every definition as CSV" style={btn}>Download CSV</button>
        </div>
      </div>

      <div className="ref-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gridAutoRows: '300px', gap: 16, marginTop: 12 }}>
        {REF.map((s) => (
          <div className="card ref-card" key={s.title} style={{ height: 300, overflowY: 'auto' }}>
            <h3>{s.title}</h3>
            {s.note ? <p className="muted small" style={{ marginTop: 0 }}>{s.note}</p> : null}
            <ul className="ref-dl">
              {s.items.map(([t, d]) => <li key={t}><b>{t}</b> — {d}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

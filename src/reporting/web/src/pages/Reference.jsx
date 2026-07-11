import { useEffect, useRef, useState } from 'react';

// Native reference page — definitions, formulas, source tables, and data caveats for the participation
// reports. Merges the standalone dashboard's full Reference content with the live-MySQL field mapping.
// Rendered both as a route (/reference) and as the "Reference" tab under participation-maps.
// Cards are copyable (Copy button) and resizeable (drag the lower-right corner).

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
    ['These cards', 'Each Reference card is copyable (Copy button) and resizeable — drag the lower-right corner to grow it.'],
  ] },
  { title: 'Map styles', note: 'Choropleth, Pins and YoY are independent on/off toggles — turn the fill off for a neutral map, or overlay pins on any fill.', items: [
    ['Heatmap (Choropleth)', 'States shaded by the selected metric.'],
    ['Pins', 'Event locations plotted by ZIP code — navy = non-IRONMAN, red = IRONMAN, circle sized by participants.'],
    ['YoY', 'Year-over-year change by state (percent or absolute), with numbered gold badges on the top movers.'],
    ['Flows', '3D arcs showing athlete travel from home state to event state; the base map shades net importers vs exporters.'],
    ['Regions', 'Reference map: every state tinted by its region (see the Regions card for membership).'],
  ] },
  { title: 'Core metrics & how they are calculated', items: [
    ['Participants', 'Count of participation records (event starts) in the period. One athlete racing 3 times counts as 3.'],
    ['Unique participants', 'Distinct athletes for the exact selection — COUNT(DISTINCT id_profiles), i.e. athletes who raced while holding an active USAT membership. Non-additive, so counted live from the base table for whatever years / months / filters you pick — never summed from per-slice counts.'],
    ['% unique', 'Unique participants ÷ Participants (uses the exact live unique).'],
    ['Races / participant', 'Participants ÷ Unique participants (uses the exact live unique).'],
    ['Home (in-state)', 'Participations where the athlete’s home state = the event state.'],
    ['Away (cross-state travel)', 'Participations where the home state is one of the 54 jurisdictions and ≠ the event state.'],
    ['Unknown home', 'Participations whose home state is missing/blank or outside the 54 jurisdictions (foreign, military APO/FPO, Canadian provinces) — can’t be placed as home or away. DC and the territories are known home.'],
    ['Reconciliation', 'Home + Away + Unknown home = Participants, at every level.'],
    ['Home %', 'Home ÷ (Home + Away) — the known-home basis (excludes Unknown home).'],
    ['New / Repeat', 'First-time vs returning athletes in the period.'],
    ['IRONMAN share', 'IRONMAN participations ÷ all participations.'],
    ['Female %, age bands', 'Share of participations in that group.'],
  ] },
  { title: 'Adult vs non-adult', note: 'Adult = age 20+; the split is on participations (race entries), not unique athletes.', items: [
    ['Adult participants', 'Participations by athletes aged 20+ (age bins 20-29…90-99).'],
    ['Non-adult participants', 'Participations by athletes under 20 (youth 4-19), plus any with no age recorded — i.e. Participants − Adult participants.'],
    ['Adult %', 'Adult participations ÷ all participations.'],
    ['Non-adult %', 'Non-adult participations ÷ all participations. Adult % + Non-adult % = 100%.'],
  ] },
  { title: 'Penetration & Opportunity (per-capita)', note: 'Per-capita metrics use US Census population loaded by step 2c. The exact population source + vintage appears in the population/penetration metric tooltips.', items: [
    ['Population (Census)', 'State resident population — US Census ACS 1-year (table B01001, age-split at 20 into adult 20+ and youth <20). Primary source is the Census API (needs CENSUS_API_KEY); falls back to BigQuery public census if no key. Loaded into census_state_population (population / population_adult / population_youth); the vintage is stamped in its source column.'],
    ['All-states penetration / 1,000 pop', 'Distinct residents of a state who raced ANYWHERE (home or away), counted once ÷ the age-group population × 1,000 — "who lives here and races." This is the headline figure and drives the Opportunity band + headroom. Numerator counted live via /api/reach (by member_state_code_addresses, member-matched, for the selected age group).'],
    ['In-state penetration / 1,000 pop', 'Distinct residents who raced ONLY in their home state (home-only — never traveled out) ÷ the age-group population × 1,000. A SUBSET of all-states, so in-state ≤ all-states. Same residents, same denominator — it just narrows the numerator to those who stayed home. The Map toggle can colour the map + bands by this instead of all-states.'],
    ['Where residents race (breakout)', 'The all-states residents split into three mutually-exclusive buckets that sum exactly to all-states: raced only in-state (home-only = in-state), raced in-state and out (both), raced only out-of-state (away-only). only-in + both + only-out = all-states.'],
    ['/1k', 'Per 1,000 people of the age group: numerator ÷ population × 1,000. BOTH measures use the SAME residents (member-matched, selected age group) and the SAME denominator — all-states counts those who raced anywhere, in-state counts the home-only subset. In-state + out-of-state /1k are additive for participations but overlap for unique athletes (the "both" group); the buckets above are the clean additive split.'],
    ['National /1k', 'The population-weighted national benchmark for each measure: Σ numerator ÷ Σ population × 1,000 (big states pull the mean correctly). All-states and in-state have their own national rate.'],
    ['/1k gap', 'A state’s /1k − the national /1k (negative = below national). The all-states gap is what assigns the Opportunity band.'],
    ['Headroom', 'Estimated additional athletes to lift a state to the national rate = (national − state /1k) ÷ 1,000 × age-group population. The ranking sorts by headroom (biggest real-world targets first); zero for states at/above national. Computed for both all-states and in-state.'],
    ['Map basis (all-states vs in-state)', 'A toggle under the Opportunity map. All-states (default) colours states by residents-racing-anywhere; In-state colours by the home-only subset. The card always shows both blocks — the toggle only changes which drives the map, bands, and headline.'],
    ['Adult / Youth toggle', 'Switches the whole Opportunity view between adults 20+ (over adult population) and youth 4–19 (over youth population). Both numerator age filter and denominator change together, so the rate stays a true per-capita for that group.'],
    ['Age bands & sex on the card', 'Shares of the state’s participations: 4–19, 20–29, and 30+ (= 100 − 4–19 − 20–29), plus the male/female split. These are of ALL participations (all ages) and match the Age bands / Gender metrics in the dropdown.'],
    ['Basis + single-year note', 'Penetration athletes are member-matched residents in the selected age group (adults 20+ or youth 4–19). Denominator is the matching Census population, so /1k is per 1,000 of that group. Penetration is only exact for a single year — multi-year selections sum the numerator against one-year population (a banner warns when >1 year is selected).'],
    ['Opportunity view — bands', 'Four bands rank each state by its penetration (/1k) against the national rate on the active basis. Leader (green): at or above the national rate — a leading market that already out-performs the benchmark, so little to no headroom. On-par (grey): between the national rate and the upper (leader) cutoff — tracking roughly with the benchmark. Under-penetrated (amber): under the national rate but above the floor — an under-served market with real, achievable headroom. Lagging (red): at or below half the national rate — the weakest markets and the biggest growth opportunity.'],
    ['Opportunity bands — how the cutoffs are set', 'The band thresholds are set three ways on the active basis. National-relative (default): Leader ≥ the national rate, Lagging ≤ half national (On-par is empty in this mode). Statistical: from the distribution of state penetration values — Quantile (Leader = top 20%, Lagging = bottom 20%, split at the median) or Std-dev (Leader ≥ mean+σ, Lagging ≤ mean−σ, split at the mean; σ multiplier adjustable). Absolute: fixed cutoffs you type.'],
    ['Known-member basis', 'All-states penetration counts member-matched residents only, so it is directional (undercounts non-member finishers); the ranking/spread is robust.'],
  ] },
  { title: 'The matrices (travel)', items: [
    ['Cell (row = home, col = event)', 'Participations by that home state/region’s athletes racing in that event state/region.'],
    ['Diagonal', 'State matrix: raced in their own state (in-state). Region matrix: raced within their own region.'],
    ['By its athletes (row total)', 'All participations by that state/region’s athletes (in-state + traveled).'],
    ['Hosted here (column total)', 'All participations held there (locals + visitors).'],
    ['Traveled out / in', 'By-its-athletes − diagonal / Hosted-here − diagonal.'],
    ['Net ±', 'Hosted here − By its athletes (= Traveled in − Traveled out). Positive = net importer/destination; negative = net exporter/feeder.'],
    ['Grand total travel', 'Sum of all off-diagonal cells = total participations − in-state races.'],
  ] },
  { title: 'Year-over-year (YoY) map', note: 'Compares the selected metric between a baseline year (from) and a comparison year (to), one value per state.', items: [
    ['% change', 'Round to 1 decimal of (to − from) ÷ from. Diverging scale: red = decline, green = growth, ~white = 0.'],
    ['Absolute change', 'to − from, same diverging red→green scale.'],
    ['Like-for-like months', 'Only months present in BOTH years are compared, so a partial "to" year measures against the same months of the baseline.'],
    ['Zero baseline (0 → n)', 'A state with 0 in the baseline has no valid % (division by zero); shown as "0 → n (new)", shaded top-positive, and excluded from the Top-N gainers ranking.'],
    ['Top movers', 'Numbered gold badges mark the ranked gainers, decliners, or absolute movers.'],
  ] },
  { title: 'Regions (custom USAT groupings)', note: 'Region membership is defined in the region_data table (the single source of truth) and drives both the ETL scope and the app geography. It includes DC and the territories; the geographic map (locationmode USA-states) can only draw the 50 states + DC (a tiny sliver by Maryland), and territories are off-scope.', items: [
    ['Pacific (6)', 'AK, CA, HI, NV, OR, WA'],
    ['Rockies (7)', 'AZ, CO, ID, MT, NM, UT, WY'],
    ['Central (8)', 'IA, KS, MN, ND, NE, OK, SD, TX'],
    ['Midwest (8)', 'IL, IN, KY, MI, OH, VA, WI, WV'],
    ['Southeast (10)', 'AL, AR, FL, GA, LA, MO, MS, NC, SC, TN'],
    ['Northeast (12)', 'CT, DC, DE, MA, MD, ME, NH, NJ, NY, PA, RI, VT'],
    ['Territories', 'GU, PR, VI — assigned in region_data and included in the ETL scope, but not rendered on the US-states map.'],
  ] },
  { title: 'Fields used (live MySQL)', note: 'The map keys on the event state; reporting stats use the race-side columns (name_events_rr / id_events_rr / id_sanctioning_events), not the membership-purchase columns.', items: [
    ['Event state', 'state_code_events'],
    ['Home state', 'member_state_code_addresses — Home = home state equals event state'],
    ['Year / Month', 'start_date_year_races / start_date_month_races'],
    ['Participants / Events / Races', 'COUNT(id_rr) / COUNT(DISTINCT id_events_rr) / COUNT(DISTINCT id_race_rr)'],
    ['Adult', 'age_as_race_results_bin IN (20-29…90-99); Non-adult = the rest of turnout'],
    ['Gender', "gender_code = 'F' / 'M'"],
    ['Age bands', 'age_as_race_results_bin (4-19 = 4-9+10-19; 60+ = 60-69…90-99; bad_age excluded)'],
    ['IRONMAN', 'is_ironman = 1 — official IRONMAN events: name contains "ironman", OR a curated allow-list of official races that omit it (Augusta 70.3, IM 70.3 Maine, Steelhead 70.3). Excludes independent 70.3/140.6 races (e.g. Howlin Half 70.3, Marthas Vineyard 70.3). Defined once in queries/ironman_rule.js, materialized upstream, rolled up MAX per event.'],
    ['Unique athletes', 'COUNT(DISTINCT id_profiles) — active-member profile; counted live per selection via /api/unique.'],
    ['Home-side athletes (penetration)', 'COUNT(DISTINCT id_profiles) by member_state_code_addresses, adult; counted live via /api/home.'],
    ['Cross-state flows', 'home → event COUNT(id_rr), both 50-state, home ≠ event'],
  ] },
  { title: 'Source tables & freshness', note: 'Live, read-only local ' + 'usat_sales_db' + '. Full detail: plans_and_notes/FIELD_MAPPING.md.', items: [
    ['Parent table', SRC.parent + ' — one row per participation (id_rr).'],
    ['Summary table', SRC.summary + ' — state/region metrics by year-month (feeds the maps + Summary).'],
    ['Flows table', SRC.flows + ' — home → event origin-destination pairs (feeds the matrices + Flows).'],
    ['Events table', SRC.events + ' — per-event roll-ups (feeds the Events tab + Pins).'],
    ['Region table', 'region_data — state ⇄ region ⇄ lat/lng (+ population source of truth); reload via the menu after editing the CSV.'],
    ['Population table', 'census_state_population — state → population (US Census ACS 1-yr), built by step 2c; source/vintage in its source column.'],
    ['Data build scope', 'TEST vs FULL: step 3i can build just recent years (TEST = 2024 & 2025) or the FULL window. The current scope shows as a badge in the header (from reporting_build_meta); menu → "Show data build scope".'],
    ['Last updated', 'Shown in the header — the source table’s timestamp (created_at).'],
    ['Partial years', 'The current year is year-to-date (partial) — not comparable to full years. Use full-year for penetration.'],
    ['Coverage', 'Event state / gender / age / IRONMAN / new-repeat ~100%; home state ~90% (the rest count as away/unknown).'],
  ] },
];
const REF_BY_TITLE = Object.fromEntries(REF.map((s) => [s.title, s]));

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
// Plain-text of a card, for the per-card Copy button.
function cardText(s) {
  const lines = [s.title];
  if (s.note) lines.push('(' + s.note + ')');
  s.items.forEach(([t, d]) => lines.push('• ' + t + ' — ' + d));
  return lines.join('\n');
}
// Highlight every occurrence of q (already lowercased) within text; returns strings + <mark> nodes.
function highlight(text, q) {
  if (!q) return text;
  const low = text.toLowerCase(); const out = []; let idx = 0; let pos = low.indexOf(q);
  while (pos >= 0) {
    if (pos > idx) out.push(text.slice(idx, pos));
    out.push(<mark key={out.length} style={{ background: '#fde68a', color: 'inherit', padding: 0, borderRadius: 2 }}>{text.slice(pos, pos + q.length)}</mark>);
    idx = pos + q.length; pos = low.indexOf(q, idx);
  }
  if (idx < text.length) out.push(text.slice(idx));
  return out;
}

export default function Reference() {
  const fsRef = useRef(null);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState('');
  const [order, setOrder] = useState(REF.map((s) => s.title));   // card order (drag to rearrange)
  const [expanded, setExpanded] = useState({});                  // per-card expand/collapse
  const [query, setQuery] = useState('');                        // search across every definition
  const dragTitle = useRef(null);
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === fsRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen(); else if (fsRef.current && fsRef.current.requestFullscreen) fsRef.current.requestFullscreen(); };
  const copyCard = (s) => {
    try { navigator.clipboard.writeText(cardText(s)); setCopied(s.title); setTimeout(() => setCopied(''), 1500); } catch (e) { /* clipboard unavailable */ }
  };
  // Drag-to-rearrange (native HTML5 DnD via the ⠿ handle; drop target is the whole card).
  const onDragStart = (title) => (e) => { dragTitle.current = title; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (target) => (e) => {
    e.preventDefault();
    const src = dragTitle.current; dragTitle.current = null;
    if (!src || src === target) return;
    setOrder((o) => { const a = o.filter((t) => t !== src); const i = a.indexOf(target); a.splice(i < 0 ? a.length : i, 0, src); return a; });
  };
  const toggleExpand = (title) => setExpanded((x) => Object.assign({}, x, { [title]: !x[title] }));
  const btn = { padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', color: 'var(--ink)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' };
  const miniBtn = { padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' };
  return (
    <div className="page reference" ref={fsRef} style={full ? { background: dark ? '#0b1220' : '#ffffff', padding: 16, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>Reference &amp; definitions</h2>
          <p className="muted" style={{ marginTop: 0 }}>What the data means, how each number is calculated, and what to watch for. Cards are copyable and resizeable (drag the corner).</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all definitions…"
            aria-label="Search reference definitions"
            style={{ width: 240, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', color: 'var(--ink)', fontSize: 14 }} />
          <button onClick={toggleFs} title="Fullscreen" style={btn}>{full ? 'Exit ⛶' : '⛶ Full'}</button>
          <button onClick={exportRef} title="Download every definition as CSV" style={btn}>Download CSV</button>
        </div>
      </div>

      {(() => {
        const q = query.trim().toLowerCase();
        const shown = order.map((title) => REF_BY_TITLE[title]).filter(Boolean).map((s) => {
          if (!q) return s;
          const titleHit = s.title.toLowerCase().includes(q) || (s.note && s.note.toLowerCase().includes(q));
          const items = titleHit ? s.items : s.items.filter(([t, d]) => (t + ' ' + d).toLowerCase().includes(q));
          return (titleHit || items.length) ? Object.assign({}, s, { items }) : null;
        }).filter(Boolean);
        return (<>
          {q ? <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>{shown.length ? (shown.length + ' matching card' + (shown.length === 1 ? '' : 's')) : 'No matches — try another term.'}</p> : null}
          <div className="ref-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gridAutoRows: 'min-content', gap: 16, marginTop: 12, alignItems: 'start' }}>
            {shown.map((s) => {
              const title = s.title; const isExp = !!expanded[title];
              return (
                <div className="card ref-card" key={title}
                  onDragOver={onDragOver} onDrop={onDrop(title)}
                  style={{ height: isExp ? 'auto' : 300, minWidth: 240, minHeight: 150, maxHeight: isExp ? 'none' : undefined, overflow: 'auto', resize: 'both', gridColumn: isExp ? '1 / -1' : 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span draggable onDragStart={onDragStart(title)} title="Drag to rearrange" style={{ cursor: 'grab', color: 'var(--muted)', fontSize: 14, userSelect: 'none' }}>⠿</span>
                      {highlight(s.title, q)}
                    </h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => toggleExpand(title)} title={isExp ? 'Collapse' : 'Expand to full width'} style={miniBtn}>{isExp ? '× Collapse' : '⤢ Expand'}</button>
                      <button onClick={() => copyCard(s)} title="Copy this card to the clipboard" style={miniBtn}>{copied === s.title ? '✓ Copied' : 'Copy'}</button>
                    </div>
                  </div>
                  {s.note ? <p className="muted small" style={{ marginTop: 4 }}>{highlight(s.note, q)}</p> : null}
                  <ul className="ref-dl">
                    {s.items.map(([t, d]) => <li key={t}><b>{highlight(t, q)}</b> — {highlight(d, q)}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </>);
      })()}
    </div>
  );
}

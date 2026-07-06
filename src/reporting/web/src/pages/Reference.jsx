// Native reference page — definitions, formulas, and data caveats for the participation reports.
// Ported from the standalone dashboard's Reference tab.
export default function Reference() {
  return (
    <div className="page reference">
      <h2>Reference &amp; definitions</h2>
      <p className="muted">What the data means, how each number is calculated, and what to watch for.</p>

      <Section title="Core metrics">
        <Dl items={[
          ['Participants', 'Count of participation records (event starts). One athlete racing 3 times counts as 3.'],
          ['Unique participants', 'Distinct athletes (deduplicated).'],
          ['% unique', 'Unique ÷ Participants.'],
          ['Races / participant', 'Participants ÷ Unique.'],
          ['Home (in-state)', 'Participations where the athlete’s home state = the event state.'],
          ['Away (cross-state travel)', 'Participations where home state ≠ event state.'],
        ]} />
      </Section>

      <Section title="Travel & the matrices">
        <Dl items={[
          ['By its athletes (row total)', 'All participations by that state/region’s athletes (in-state + traveled).'],
          ['Hosted here (column total)', 'All participations held there (locals + visitors).'],
          ['Traveled out / in', 'By-its-athletes − diagonal / Hosted-here − diagonal.'],
          ['Net ±', 'Hosted − By-its-athletes. Positive = net importer (destination); negative = net exporter (feeder).'],
          ['Grand total travel', 'Sum of off-diagonal cells = total − in-state races.'],
        ]} />
      </Section>

      <Section title="Regions (custom USAT groupings)">
        <Dl items={[
          ['Pacific', 'AK, CA, HI, NV, OR, WA'],
          ['Rockies', 'AZ, CO, ID, MT, NM, UT, WY'],
          ['Central', 'IA, KS, MN, ND, NE, OK, SD, TX'],
          ['Midwest', 'IL, IN, KY, MI, OH, VA, WI, WV'],
          ['Southeast', 'AL, AR, FL, GA, LA, MO, MS, NC, SC, TN'],
          ['Northeast', 'CT, DE, MA, MD, ME, NH, NJ, NY, PA, RI, VT'],
        ]} />
      </Section>

      <Section title="Fields used (live MySQL)">
        <p className="muted small" style={{ marginTop: 0 }}>
          Source: <code>usat_sales_db.all_participation_data_with_membership_match</code>, one row per
          participation (<code>id_rr</code>). The map keys on the <b>event state</b>.
        </p>
        <Dl items={[
          ['Event state', 'state_code_events (50 states)'],
          ['Home state', 'member_state_code_addresses — Home = home state equals event state'],
          ['Year / Month', 'start_date_year_races / start_date_month_races'],
          ['Participants / Events / Races', 'COUNT(id_rr) / COUNT(DISTINCT id_events_rr) / COUNT(DISTINCT id_race_rr)'],
          ['Gender', "gender_code = 'F' / 'M'"],
          ['Age bands', 'age_as_race_results_bin (4-19 = 4-9+10-19; 60+ = 60-69…90-99; bad_age excluded)'],
          ['IRONMAN', 'is_ironman = 1'],
          ['New / Repeat', "member_created_at_category_starts_mp = 'created_year' is new; else repeat"],
          ['Unique athletes', 'COUNT(DISTINCT id_profiles)'],
          ['Cross-state flows', 'home → event COUNT(id_rr), both 50-state, home ≠ event'],
        ]} />
        <p className="muted small">
          Coverage: event state / gender / age / IRONMAN / new-repeat ~100%; home state ~90% (the rest
          count as away/unknown). Full detail: plans_and_notes/FIELD_MAPPING.md.
        </p>
      </Section>

      <Section title="Data, freshness & caveats">
        <Dl items={[
          ['Source', 'participation table in local usat_sales_db (read-only).'],
          ['Last updated', 'Shown in the header — the source table’s timestamp.'],
          ['2026', 'Year-to-date (partial) — not comparable to full years.'],
          ['Multi-period', 'Participations/gender/age/home-away/IRONMAN/new-repeat are exact; distinct counts (Unique, Events, Races) are summed per period.'],
        ]} />
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return <div className="card ref-card"><h3>{title}</h3>{children}</div>;
}
function Dl({ items }) {
  return (
    <ul className="ref-dl">
      {items.map(([t, d]) => <li key={t}><b>{t}</b> — {d}</li>)}
    </ul>
  );
}

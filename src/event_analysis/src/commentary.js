/**
 * commentary.js — Dynamic narrative, insight, and speaker-note generation.
 *
 * Two modes (both return the same shape):
 *   generate_rule_based(r)    — instant, no API; everything derived from data
 *   generate_ai(r, api_key)   — calls Claude API for rich natural-language content
 *
 * Editorial voice goal: every read/bullet/narrative is short, decisive, and
 * uses the "headline metric + one interpretive sentence" pattern. Decliners
 * get a ⚠ glyph; clear bright spots get a ✓.
 */

'use strict';

// jsonrepair fixes common AI-generated JSON problems (unescaped quotes inside
// strings, embedded newlines, smart quotes, trailing commas, truncated
// braces). Used as Layer 2 of the parse-recovery chain in generate_ai().
// Loaded lazily — if the package isn't installed yet (`npm i` not run),
// we fall through to the existing slice-based recovery instead of crashing.
let jsonrepair = null;
try { jsonrepair = require('jsonrepair').jsonrepair; }
catch (e) { /* jsonrepair not installed — recovery falls back to slicing */ }

const { usHolidays } = require('./calendar');
const {
  MINUS, EM_DASH, EN_DASH, GE, WARN, CHECK, ARROW_R, TIMES,
  MN_SHORT, MN_FULL,
  fmt_int, fmt_delta, fmt_delta1, fmt_pct, fmt_pct_n,
  severity, severity_pct, list_and,
} = require('./fmt');

const MN = MN_SHORT;  // local alias (keeps line lengths reasonable)

// ── Helpers ───────────────────────────────────────────────────────────────────

function sum_type(cx, t) {
  return Object.values(cx ?? {}).reduce((s, m) => s + (m[t] ?? 0), 0);
}

function compute_pipeline(r) {
  // Returns per-type pipeline totals for slide 7. Falls back to zeros if
  // creation_rows isn't attached to results.
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
  const ya = r.years?.BASELINE_YEAR ?? (new Date().getFullYear() - 1);
  const yb = r.years?.ANALYSIS_YEAR ?? new Date().getFullYear();
  const pre_ya = ya - 1;
  const now = new Date();
  const cutoff_mo = (yb === now.getFullYear()) ? Math.max(1, Math.min(12, now.getMonth() + 1)) : 12;
  const in_yr_mos = Array.from({ length: cutoff_mo }, (_, i) => i + 1);
  const rows_a = r.creation_rows?.BASELINE_YEAR ?? [];
  const rows_b = r.creation_rows?.ANALYSIS_YEAR ?? [];
  const get = (rows, yr, type, mos) =>
    rows.filter(rw => rw.yr === yr && rw.type === type && (mos === null || mos.includes(rw.mo)))
        .reduce((s, rw) => s + (rw.cnt ?? 0), 0);
  const per_type = TYPES.map(t => ({
    type: t,
    pre_a: get(rows_a, pre_ya, t, [10, 11, 12]),
    iy_a:  get(rows_a, ya,     t, in_yr_mos),
    tot_a: rows_a.filter(rw => rw.type === t).reduce((s, rw) => s + (rw.cnt ?? 0), 0),
    pre_b: get(rows_b, ya,     t, [10, 11, 12]),
    iy_b:  get(rows_b, yb,     t, in_yr_mos),
    tot_b: rows_b.filter(rw => rw.type === t).reduce((s, rw) => s + (rw.cnt ?? 0), 0),
  }));
  const totals = per_type.reduce((acc, p) => ({
    pre_a: acc.pre_a + p.pre_a, iy_a: acc.iy_a + p.iy_a, tot_a: acc.tot_a + p.tot_a,
    pre_b: acc.pre_b + p.pre_b, iy_b: acc.iy_b + p.iy_b, tot_b: acc.tot_b + p.tot_b,
  }), { pre_a: 0, iy_a: 0, tot_a: 0, pre_b: 0, iy_b: 0, tot_b: 0 });
  return {
    per_type, totals, cutoff_mo,
    cutoff_label: `Jan${EN_DASH}${MN_FULL[cutoff_mo]}`,
    has_data: rows_a.length > 0 || rows_b.length > 0,
  };
}

function compute_base(r) {
  const c_baseline = r.c_baseline ?? {}, c_analysis = r.c_analysis ?? {};
  const n_baseline = r.baseline_active?.length ?? 0;
  const n_analysis = r.analysis_active?.length ?? 0;
  const net = n_analysis - n_baseline;
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
  const BASELINE_YEAR = r.years?.BASELINE_YEAR ?? (new Date().getFullYear() - 1);
  const ANALYSIS_YEAR = r.years?.ANALYSIS_YEAR ?? new Date().getFullYear();

  const by_type = TYPES.map(t => ({
    type: t,
    n_baseline:  sum_type(c_baseline, t),
    n_analysis:  sum_type(c_analysis, t),
    delta: sum_type(c_analysis, t) - sum_type(c_baseline, t),
    pct_n: (() => {
      const a = sum_type(c_baseline, t), b = sum_type(c_analysis, t);
      return a ? ((b - a) / a) * 100 : 0;
    })(),
    org:   r.organicByType?.[t]?.orgTotal ?? null,
    org_pct: (() => {
      const v = r.organicByType?.[t];
      if (!v) return null;
      return v.tot25 ? (v.orgTotal / v.tot25) * 100 : null;
    })(),
  }));

  const sorted_delta = [...by_type].sort((a, b) => a.delta - b.delta);
  const top_decliner = sorted_delta.find(d => d.delta < 0) ?? null;
  const top_grower   = [...by_type].sort((a, b) => b.delta - a.delta).find(d => d.delta > 0) ?? null;
  const sorted_org   = [...by_type]
    .filter(d => d.org !== null && d.org !== undefined)
    .sort((a, b) => (a.org ?? 0) - (b.org ?? 0));
  const top_org_decliner = sorted_org[0] ?? top_decliner;
  const top_org_grower   = sorted_org[sorted_org.length - 1] ?? top_grower;

  const monthly_arr = Object.entries(r.monthly ?? {}).map(([m, d]) => {
    const mm = Number(m);
    const ci = (r.calImpact ?? [])[mm - 1] ?? null;
    const cal = ci?.calTotal ?? 0;
    const org = ci?.orgTotal ?? d.netDelta ?? 0;
    return {
      m: mm, label: MN[mm], long: MN_FULL[mm],
      n_baseline: d.n_baseline ?? 0, n_analysis: d.n_analysis ?? 0,
      ret: d.ret ?? 0, sa: d.sa ?? 0, su: d.su ?? 0, ttr: d.ttr ?? 0,
      attr: d.attr ?? 0, rec: d.rec ?? 0, new: d.new ?? 0,
      delta: d.netDelta ?? 0, netDelta: d.netDelta ?? 0, netShift: d.netShift ?? 0,
      cal, organic: org,
      repl_rate: (d.attr ?? 0) > 0 ? Math.round((((d.new ?? 0) + (d.rec ?? 0)) / d.attr) * 100) : null,
    };
  }).sort((a, b) => a.m - b.m);

  const worst_months = [...monthly_arr].sort((a, b) => a.delta - b.delta).slice(0, 3);
  const best_months  = [...monthly_arr].sort((a, b) => b.delta - a.delta).slice(0, 3);
  const worst_organic = [...monthly_arr].sort((a, b) => a.organic - b.organic).slice(0, 3);
  const best_organic  = [...monthly_arr].sort((a, b) => b.organic - a.organic).slice(0, 3);
  const worst_repl = [...monthly_arr]
    .filter(m => m.repl_rate !== null && m.attr >= 5)
    .sort((a, b) => (a.repl_rate ?? 0) - (b.repl_rate ?? 0))
    .slice(0, 2);

  const misleading = monthly_arr
    .filter(m => Math.abs(m.cal) > 2 && Math.sign(m.delta) !== Math.sign(m.organic))
    .sort((a, b) => Math.abs(b.delta - b.organic) - Math.abs(a.delta - a.organic))[0] ?? null;

  const seg = r.segSummary ?? {};
  const attrited = seg.Lost ?? 0, new_ev = seg.New ?? 0, rec = seg.Recovered ?? 0;
  const shifted = seg.Shifted ?? 0, retained = seg.Retained ?? 0, ttr = seg['Tried to Return'] ?? 0;
  const repl_rate = attrited > 0 ? Math.round(((new_ev + rec) / attrited) * 100) : 0;

  return {
    BASELINE_YEAR, ANALYSIS_YEAR, n_baseline, n_analysis, net,
    by_type, sorted_delta, top_decliner, top_grower, top_org_decliner, top_org_grower,
    monthly_arr, worst_months, best_months, worst_organic, best_organic, worst_repl,
    misleading,
    seg, attrited, new_ev, rec, shifted, retained, ttr, repl_rate,
    organic_by_type: r.organicByType ?? {},
    calImpact: r.calImpact ?? [],
  };
}

// ── Holiday helpers ──────────────────────────────────────────────────────────

function format_dow(year, month, day) {
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd];
}
function format_holiday(year, h) {
  return `${h.name}: ${MN_FULL[h.month]} ${h.day}, ${year} (${format_dow(year, h.month, h.day)})`;
}
function build_holiday_lists(BASELINE_YEAR, ANALYSIS_YEAR) {
  const hols_a = usHolidays(BASELINE_YEAR).sort((a, b) => a.month - b.month || a.day - b.day);
  const hols_b = usHolidays(ANALYSIS_YEAR).sort((a, b) => a.month - b.month || a.day - b.day);
  return {
    year_a_list: hols_a.map(h => format_holiday(BASELINE_YEAR, h)),
    year_b_list: hols_b.map(h => format_holiday(ANALYSIS_YEAR, h)),
    raw_a: hols_a,
    raw_b: hols_b,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Rule-based generator — editorial voice, Unicode formatting, fully dynamic.
// ════════════════════════════════════════════════════════════════════════════
function generate_rule_based(r) {
  const b = compute_base(r);
  const {
    BASELINE_YEAR, ANALYSIS_YEAR, n_baseline, n_analysis, net,
    by_type, top_decliner, top_grower, top_org_decliner, top_org_grower,
    worst_months, best_months, worst_organic, best_organic, worst_repl,
    misleading, monthly_arr,
    seg, attrited, new_ev, rec, shifted, retained, ttr, repl_rate,
    organic_by_type, calImpact,
  } = b;

  const w1 = worst_months[0], w2 = worst_months[1];
  const g1 = best_months[0],  g2 = best_months[1];
  const worst_chrono = [w1, w2].filter(Boolean).sort((a, b) => a.m - b.m);
  const worst_labels_long  = worst_chrono.map(m => m?.long).filter(Boolean);
  const worst_labels_short = worst_chrono.map(m => m?.label).filter(Boolean);
  const worst_combined = worst_chrono.reduce((s, m) => s + (m?.delta ?? 0), 0);
  const worst_cal_total = worst_chrono.reduce((s, m) => s + Math.abs(m?.cal ?? 0), 0);
  const no_cal_cover = worst_cal_total < 1;

  const hol = build_holiday_lists(BASELINE_YEAR, ANALYSIS_YEAR);

  // ── Slide 1 bullets — punchy editorial sub-lines ─────────────────────────
  const headline_sub = (() => {
    const pct = fmt_pct(n_baseline, n_analysis);
    if (Math.abs(net) <= 20) return `${pct} ${EM_DASH} modest headline, but composition matters`;
    return `${pct} ${EM_DASH} significant change ${EM_DASH} review by type`;
  })();

  const decliner_sub = top_decliner
    ? (top_decliner.delta === net
        ? 'Sole driver of the net decline'
        : (Math.abs(top_decliner.delta) > Math.abs(net) ? 'Larger than the net change, partially offset by growth elsewhere' : 'Largest absolute decline'))
    : 'All types roughly flat';

  const worst_sub = worst_chrono.length
    ? (no_cal_cover
        ? `Zero calendar cover ${EM_DASH} purely organic losses`
        : `Combined ${fmt_delta(worst_combined)} ${EM_DASH} partial calendar cover`)
    : '';

  const grower_sub = top_grower
    ? (top_grower.org_pct !== null && top_grower.org_pct > 10
        ? `Only type growing ${EM_DASH} a genuine bright spot`
        : `Largest absolute gain (${fmt_delta(top_grower.delta)} events)`)
    : 'No type outperformed';

  const slide_1_bullets = [
    { label: `${fmt_delta(net)} events overall`,                                  bg_type: net >= 0 ? 'positive' : 'negative', sub: headline_sub },
    { label: top_decliner ? `${top_decliner.type} ${fmt_pct_n(top_decliner.pct_n)}` : 'No clear decliner',
      bg_type: top_decliner ? 'negative' : 'neutral', sub: decliner_sub },
    { label: worst_chrono.length ? `${list_and(worst_labels_short)} ${fmt_delta(worst_combined)}` : 'No notably weak months',
      bg_type: worst_combined < 0 ? 'negative' : 'neutral', sub: worst_sub },
    { label: top_grower ? `${top_grower.type} ${fmt_pct_n(top_grower.pct_n)}` : 'No clear grower',
      bg_type: top_grower ? 'positive' : 'neutral', sub: grower_sub },
  ];

  // ── Slide 2 narrative — headline takeaway first ──────────────────────────
  const slide_2_narrative = (() => {
    if (Math.abs(net) <= 2)
      return 'Total event count is essentially flat year-over-year. Composition is the story.';
    if (top_decliner && Math.abs(top_decliner.delta) >= Math.abs(net) - 2)
      return `${top_decliner.type} accounts for the full net ${fmt_delta(net)} decline. Races roughly flat${top_grower ? `. ${top_grower.type} the bright spot` : ''}.`;
    if (top_decliner && top_grower)
      return `Net ${fmt_delta(net)} (${fmt_pct(n_baseline, n_analysis)}): ${top_decliner.type} ${fmt_delta(top_decliner.delta)} drives the decline; ${top_grower.type} ${fmt_delta(top_grower.delta)} the offset.`;
    return `Net ${fmt_delta(net)} (${fmt_pct(n_baseline, n_analysis)}). Review type composition for drivers.`;
  })();

  // ── Slide 3 narrative — worst-month takeaway ─────────────────────────────
  const slide_3_narrative = (() => {
    if (!worst_months[0]) return 'Monthly distribution is broadly even.';
    const wlist = worst_chrono.map(m => `${m.label} (${fmt_delta(m.delta)})`);
    const blist = best_months.filter(m => m.delta > 0).slice(0, 2).map(m => `${m.label} (${fmt_delta(m.delta)})`);
    let s = `${list_and(wlist)} drive the decline`;
    if (blist.length) s += `; ${list_and(blist)} the bright spots`;
    s += '. ';
    if (Math.abs(worst_combined) > 25) s += 'Concentrated losses in specific months, not broad-based.';
    else s += 'Losses are spread thin rather than concentrated.';
    return s;
  })();

  // ── Slide 4 narrative — calendar verdict ─────────────────────────────────
  const slide_4_narrative = (() => {
    if (!worst_chrono.length)
      return 'Calendar analysis isolates which monthly changes are calendar vs organic.';
    const months_str = list_and(worst_labels_long);
    if (no_cal_cover) {
      let s = `${months_str} had flat weekend-day counts ${EM_DASH} the combined ${fmt_delta(worst_combined)} is fully organic. No alibi.`;
      if (misleading) s += ` ${misleading.long} is most misleading: ${fmt_delta(misleading.delta)} raw but ${fmt_delta1(misleading.organic)} organic.`;
      return s;
    }
    return `Calendar provides partial cover. ${worst_chrono.map(m => `${m.long}: organic ${fmt_delta1(m.organic)}`).join('; ')}.${misleading ? ` Most misleading: ${misleading.long} ${EM_DASH} ${fmt_delta(misleading.delta)} raw vs ${fmt_delta1(misleading.organic)} organic.` : ''}`;
  })();

  // ── Slide 5 narrative — organic verdict ──────────────────────────────────
  const structural_decliners = by_type.filter(d => d.org_pct !== null && d.org_pct < -5);
  const structural_growers   = by_type.filter(d => d.org_pct !== null && d.org_pct > 5);
  const flat_types           = by_type.filter(d => d.org_pct !== null && Math.abs(d.org_pct) <= 2);
  const slide_5_narrative = (() => {
    const parts = [];
    if (structural_decliners.length)
      parts.push(`${list_and(structural_decliners.map(d => `${d.type} (${fmt_pct_n(d.org_pct)})`))} ${structural_decliners.length === 1 ? 'is' : 'are'} contracting structurally`);
    if (flat_types.length)
      parts.push(`${list_and(flat_types.map(d => d.type))} near-flat organically`);
    if (structural_growers.length)
      parts.push(`${list_and(structural_growers.map(d => `${d.type} (${fmt_pct_n(d.org_pct)})`))} growing on organic basis`);
    return parts.join('; ') + '.';
  })();

  // ── Slide 6 narrative — replacement story ────────────────────────────────
  const att_pct = n_baseline ? Math.round((attrited / n_baseline) * 100) : 0;
  const slide_6_narrative = (() => {
    let s = `Of ${fmt_int(n_baseline)} ${BASELINE_YEAR} active events, ${fmt_int(attrited)} (${att_pct}%) did not return. `;
    s += `${fmt_int(new_ev)} new + ${fmt_int(rec)} recovered = ${repl_rate}% gross replacement.`;
    if (worst_repl.length) s += ` Replacement weakest in ${list_and(worst_repl.map(m => `${m.label} (${m.repl_rate}%)`))}.`;
    return s;
  })();

  // ── Slide 7 narrative — pipeline action ──────────────────────────────────
  const slide_7_narrative = (() => {
    if (!top_org_decliner && !top_org_grower)
      return 'Application pipeline shows when organizers are filing relative to prior year.';
    const parts = [];
    if (top_org_decliner)
      parts.push(`${top_org_decliner.type} ${WARN} structural decliner (${fmt_pct_n(top_org_decliner.org_pct ?? 0)} organic) ${EM_DASH} highest-ROI outreach target`);
    if (top_org_grower && top_org_grower !== top_org_decliner)
      parts.push(`${top_org_grower.type} ${CHECK} organic leader (${fmt_pct_n(top_org_grower.org_pct ?? 0)}) ${EM_DASH} reinforce, don't rescue`);
    return parts.join('. ') + '.';
  })();

  // ── Slide 8 narrative — win-back ─────────────────────────────────────────
  const slide_8_narrative = (() => {
    if (!worst_chrono.length) return 'Monitor monthly replacement rates as the year progresses.';
    const repls = worst_chrono.filter(m => m.repl_rate !== null).map(m => `${m.label} ${m.repl_rate}%`);
    let s = `${list_and(worst_labels_long)} each lose meaningful volume (combined ${fmt_delta(worst_combined)})`;
    if (repls.length) s += ` with partial replacement (${repls.join(', ')})`;
    s += `. The net change reflects volume rather than a broad shift in demand. Action: outreach to ${worst_chrono[worst_chrono.length - 1].long} organizers while still recruitable.`;
    return s;
  })();

  // ── Speaker notes — all dynamic ──────────────────────────────────────────
  const type_summary = by_type.map(d => `${d.type}: ${d.n_baseline}→${d.n_analysis} (${fmt_delta(d.delta)}, ${fmt_pct_n(d.pct_n)})`).join('\n- ');
  const holidays_text =
    `Holidays in ${BASELINE_YEAR}:\n- ${hol.year_a_list.join('\n- ')}\n\n` +
    `Holidays in ${ANALYSIS_YEAR}:\n- ${hol.year_b_list.join('\n- ')}`;

  // ── Rich structured speaker notes (mirror original format) ──────────────
  const notes = {};
  const pipeline = compute_pipeline(r);
  const step_titles = [
    'Step 0: What changed by type?',
    'Step 1: Which months drove the change?',
    'Step 2: Is the calendar to blame?',
    'Step 3: What is the true organic performance?',
    'Step 4: Did we really lose events at the event level?',
    'Step 5: What does the application pipeline tell us about opportunities?',
    `Step 6: What are the ${worst_labels_long.length ? worst_labels_long.join(' / ') + ' ' : ''}win-back opportunities?`,
  ];

  // Helper to format a list-item with editorial fragment for a type row.
  const type_line = (d) => {
    const op = d.org_pct !== null ? `${fmt_pct_n(d.org_pct)} organic` : '';
    let editorial = '';
    if (Math.abs(d.delta) <= 2) editorial = 'essentially flat. No structural concern.';
    else if (d.delta < -10)    editorial = `material decline relative to BASELINE_YEAR. ${WARN} Warrants follow-up.`;
    else if (d.delta < -3)     editorial = 'mild softness, within normal range.';
    else if (d.delta > 10)     editorial = `genuine organic growth. ${CHECK} Bright spot.`;
    else if (d.delta > 3)      editorial = 'mild gain.';
    else                        editorial = 'stable.';
    return `- ${d.type}: ${fmt_int(d.n_baseline)} ${ARROW_R} ${fmt_int(d.n_analysis)} (${fmt_delta(d.delta)}, ${fmt_pct_n(d.pct_n)}) ${EM_DASH} ${editorial}${op ? ' Organic ' + op + '.' : ''}`;
  };

  const monthly_top_list = (months, n) => months.slice(0, n).map(m => `${m.label} ${fmt_delta(m.delta)}`).join(', ');
  const month_obj_for = (mo) => monthly_arr.find(m => m.m === mo);

  // ── SLIDE 1 — Title / Overview ───────────────────────────────────────────
  notes.slide_1 = `SLIDE 1 ${EM_DASH} Title / Overview

Context: This deck walks through a 6-step analysis of USAT sanctioned events: ${BASELINE_YEAR} vs ${ANALYSIS_YEAR} YoY.

Headline numbers:
- Net change: ${fmt_delta(net)} events (${fmt_int(n_baseline)} to ${fmt_int(n_analysis)}), ${fmt_pct(n_baseline, n_analysis)}
- Composition matters more than the headline: ${top_decliner ? top_decliner.type + ' is the principal decliner (' + fmt_pct_n(top_decliner.pct_n) + ')' : 'no single type dominates the change'}
- ${worst_chrono.length ? list_and(worst_labels_long) + ' are the worst months (' + worst_chrono.map(m => fmt_delta(m.delta)).join(' and ') + ')' + (no_cal_cover ? ' with zero calendar explanation ' + EM_DASH + ' fully organic' : '') : 'monthly distribution is broadly even'}
- ${top_grower ? top_grower.type + ' is the only event type growing (' + fmt_pct_n(top_grower.pct_n) + ') ' + EM_DASH + ' a genuine bright spot' : 'no clear growth story'}

Data note: Excludes Cancelled, Declined, and Deleted events. Event-level matching is ~85${EN_DASH}90% reliable.

Framework overview:
${step_titles.map((s, i) => 'Step ' + i + ': ' + s.replace(/^Step \d+: /, '')).join('\n')}`;

  // ── SLIDE 2 — Step 0: Event Counts by Type ────────────────────────────────
  notes.slide_2 = `SLIDE 2 ${EM_DASH} Step 0: What Changed? Event Counts by Type

Key message: ${top_decliner
    ? `The ${fmt_delta(net)} net change is largely explained by ${top_decliner.type}. ${top_grower ? top_grower.type + ' is the offsetting growth story.' : 'All other types within normal variation.'}`
    : `Net change ${fmt_delta(net)} is broadly distributed; no single type dominates.`}

By type:
${by_type.map(type_line).join('\n')}
- TOTAL: ${fmt_int(n_baseline)} ${ARROW_R} ${fmt_int(n_analysis)} (${fmt_delta(net)}, ${fmt_pct(n_baseline, n_analysis)})

Talking point: ${top_decliner
    ? `If you set aside ${top_decliner.type}, the rest of the portfolio is comparatively stable. The question is whether the ${top_decliner.type} decline is a demand problem, a supply problem, or a structural shift.`
    : 'Portfolio composition is broadly stable. Watch for early signals of category-specific stress.'}
${top_grower && top_grower.org_pct !== null && top_grower.org_pct > 15
    ? `\n${top_grower.type} growth (${fmt_pct_n(top_grower.pct_n)}) suggests appetite for that programming is increasing. This may be a product and marketing opportunity.`
    : ''}`;

  // ── SLIDE 3 — Step 1: Monthly Breakdown ──────────────────────────────────
  // Worst-month type detail
  const wm_typedetail = worst_chrono.map(m => {
    const ar = (r.c_analysis?.[m.m]?.['Adult Race'] ?? 0) - (r.c_baseline?.[m.m]?.['Adult Race'] ?? 0);
    const yr = (r.c_analysis?.[m.m]?.['Youth Race'] ?? 0) - (r.c_baseline?.[m.m]?.['Youth Race'] ?? 0);
    const ac = (r.c_analysis?.[m.m]?.['Adult Clinic'] ?? 0) - (r.c_baseline?.[m.m]?.['Adult Clinic'] ?? 0);
    const yc = (r.c_analysis?.[m.m]?.['Youth Clinic'] ?? 0) - (r.c_baseline?.[m.m]?.['Youth Clinic'] ?? 0);
    const parts = [];
    if (ar !== 0) parts.push(`Adult Race ${fmt_delta(ar)}`);
    if (yr !== 0) parts.push(`Youth Race ${fmt_delta(yr)}`);
    if (ac !== 0) parts.push(`Adult Clinic ${fmt_delta(ac)}`);
    if (yc !== 0) parts.push(`Youth Clinic ${fmt_delta(yc)}`);
    const clinics_flat = ac === 0 && yc === 0;
    return `- ${m.long}: ${parts.join(', ')}${clinics_flat ? '. Clinics = 0 impact.' : '.'}`;
  });
  const races_dominate = worst_chrono.length && wm_typedetail.every(line => !line.includes('Clinic ') || line.endsWith('Clinics = 0 impact.'));

  notes.slide_3 = `SLIDE 3 ${EM_DASH} Step 1: Monthly Breakdown

Key message: ${worst_chrono.length
    ? `${worst_chrono.map(m => m.label + ' (' + fmt_delta(m.delta) + ')').join(' and ')} account for ${Math.abs(worst_combined) > Math.abs(net) ? 'more than' : 'most of'} the full annual change. Without those months the rest of the year is ${net - worst_combined >= 0 ? 'net positive' : 'mixed'}.`
    : 'Monthly distribution is broadly even; no single month dominates.'}

Monthly highlights:
- Best months: ${monthly_top_list(best_months, 3)}
- Worst months: ${monthly_top_list(worst_months, 3)}
- Full year: ${fmt_int(n_baseline)} ${ARROW_R} ${fmt_int(n_analysis)} = ${fmt_delta(net)}

${worst_chrono.length ? `Type detail for ${list_and(worst_labels_long)}:\n${wm_typedetail.join('\n')}\n${races_dominate ? 'The worst-month problem is a RACE product issue, not a clinic issue.' : 'Losses are spread across event types in the worst months.'}` : ''}

Talking point: ${best_months[0]
    ? `${best_months[0].long} (${fmt_delta(best_months[0].delta)})${best_months[1] && best_months[1].delta > 0 ? ' and ' + best_months[1].long + ' (' + fmt_delta(best_months[1].delta) + ')' : ''} ${best_months[1] && best_months[1].delta > 0 ? 'are' : 'is'} the strongest month${best_months[1] && best_months[1].delta > 0 ? 's' : ''}, driven by both organic demand and new event additions. ${worst_chrono.length ? 'The shoulder season is holding; the peak season is underperforming.' : ''}`
    : 'Watch for emerging monthly patterns in next quarter\'s data.'}`;

  // ── SLIDE 4 — Step 2: Calendar Impact ────────────────────────────────────
  // Build the key-findings list dynamically: include worst months + misleading + best organic.
  const cal_picks = (() => {
    const arr = calImpact ?? [];
    const big = [...arr]
      .filter(ci => Math.abs(ci.calTotal ?? 0) > 2 || Math.abs(ci.orgTotal ?? 0) > 5)
      .sort((a, b) => Math.abs(b.orgTotal ?? 0) - Math.abs(a.orgTotal ?? 0))
      .slice(0, 5);
    return big.sort((a, b) => a.month - b.month);
  })();
  const cal_lines = cal_picks.map(ci => {
    const dw_lbl = ci.dw === 0 ? 'None (0)' : `${ci.dw > 0 ? '+' : ''}${ci.dw} day${Math.abs(ci.dw) === 1 ? '' : 's'}`;
    const note = ci.dw === 0 && Math.abs(ci.orgTotal) > 5
      ? '(fully organic)'
      : (Math.abs(ci.calTotal) > 5 && Math.sign(ci.actDelta) !== Math.sign(ci.orgTotal) ? '(most misleading raw number)' : '');
    return `- ${MN_FULL[ci.month]}: ${dw_lbl} weekend-day change, calendar expected ${fmt_delta1(ci.calTotal)}, actual ${fmt_delta(ci.actDelta)}, organic ${fmt_delta1(ci.orgTotal)} ${note}`.trimEnd();
  });

  // Shift summary
  const total_shifted = shifted;
  const shift_pct = n_baseline ? Math.round((total_shifted / n_baseline) * 100) : 0;
  const shift_summary = worst_chrono.length
    ? `${fmt_int(total_shifted)} events (${shift_pct}%) moved months in ${ANALYSIS_YEAR}. Shifting explains a small share of monthly variance.`
    : `${fmt_int(total_shifted)} events (${shift_pct}%) moved months. Modest impact on monthly totals.`;

  notes.slide_4 = `SLIDE 4 ${EM_DASH} Step 2: Is This a Calendar Effect? ${no_cal_cover ? 'No.' : 'Partially.'}

Key message: ${no_cal_cover && worst_chrono.length
    ? `${list_and(worst_labels_long)} had ZERO change in weekend days between ${BASELINE_YEAR} and ${ANALYSIS_YEAR}. There is no calendar alibi for these declines ${EM_DASH} they are fully organic.`
    : `Calendar effects explain part but not all of the variance. Worst months: ${worst_chrono.map(m => m.long + ' organic ' + fmt_delta1(m.organic)).join('; ')}.`}

Methodology: Counts Saturdays AND Sundays. Calendar Expected Delta = Δweekend days ${TIMES} ${BASELINE_YEAR} events-per-weekend-day for that month/type. Organic Delta = Actual Delta minus Calendar Expected Delta.

Key findings:
${cal_lines.join('\n')}

Event shifting note: ${shift_summary}

${misleading ? `Talking point: ${misleading.long} is the most counter-intuitive data point. Raw ${fmt_delta(misleading.delta)} looks like ${misleading.delta > 0 ? 'a win' : 'a loss'} but is actually ${fmt_delta1(misleading.organic)} organic ${EM_DASH} the calendar ${misleading.cal > 0 ? 'handed it ' + fmt_delta1(misleading.cal) + ' expected events that did not materialise' : 'cost it ' + fmt_delta1(Math.abs(misleading.cal)) + ' that organic demand more than overcame'}.` : 'Talking point: Calendar shifts are well-aligned with raw deltas this year; no major distortions to flag.'}

Holidays in ${BASELINE_YEAR}:
- ${hol.year_a_list.join('\n- ')}

Holidays in ${ANALYSIS_YEAR}:
- ${hol.year_b_list.join('\n- ')}`;

  // ── SLIDE 5 — Step 3: Organic Performance ────────────────────────────────
  notes.slide_5 = `SLIDE 5 ${EM_DASH} Step 3: Organic Performance

Key message: Once calendar noise is stripped, ${top_org_decliner ? top_org_decliner.type + ' is ' + (top_org_decliner.org_pct < -5 ? 'in structural decline (' + fmt_pct_n(top_org_decliner.org_pct) + ' organic)' : 'the principal organic mover') : 'no clear organic mover'}${top_org_grower && top_org_grower !== top_org_decliner ? ' and ' + top_org_grower.type + ' is the only type genuinely growing (' + fmt_pct_n(top_org_grower.org_pct ?? 0) + ' organic)' : ''}.

Organic results by type:
${by_type.map(d => {
    const v = r.organicByType?.[d.type];
    const cal = v?.calTotal ?? 0, raw = v?.actDelta ?? d.delta, org = v?.orgTotal ?? 0;
    const op = d.org_pct !== null ? fmt_pct_n(d.org_pct) : 'n/a';
    let editorial = '';
    if (d.org_pct !== null) {
      if (d.org_pct < -5)       editorial = 'structural decline.';
      else if (d.org_pct > 10)  editorial = 'strong organic growth.';
      else if (d.org_pct > 3)   editorial = 'solid organic gain.';
      else if (d.org_pct < -3)  editorial = 'mild softness, monitor.';
      else                       editorial = 'flat. No race product concern.';
    }
    return `- ${d.type}: Raw ${fmt_delta(raw)}, Calendar effect ${fmt_delta1(cal)}, Organic ${fmt_delta1(org)}, Organic % ${op} ${EM_DASH} ${editorial}`;
  }).join('\n')}

Formula: Organic Delta = Actual Delta minus Calendar Expected Delta. Calendar effect = Δweekend days ${TIMES} ${BASELINE_YEAR} events-per-weekend-day for that month and type.

Best organic months (calendar-adjusted): ${best_organic.slice(0, 4).map(m => m.label + ' ' + fmt_delta1(m.organic)).join(', ')}
Worst organic months: ${worst_organic.slice(0, 4).map(m => m.label + ' ' + fmt_delta1(m.organic)).join(', ')}

Talking point: ${top_org_decliner
    ? `The calendar was not the alibi for ${top_org_decliner.type} ${EM_DASH} even after stripping the calendar effect, it is still ${fmt_delta1(top_org_decliner.org)} organic. This is a demand or supply issue, not a scheduling artifact.`
    : 'No type shows structural organic decline this period.'}`;

  // ── SLIDE 6 — Step 4: Event-Level Disposition ────────────────────────────
  const seg_pct = (v) => n_baseline ? Math.round((v / n_baseline) * 100) : 0;
  const summer_repl_lines = worst_chrono.map(m => {
    const replaced = (m.new ?? 0) + (m.rec ?? 0);
    const rate = m.attr > 0 ? Math.round((replaced / m.attr) * 100) : 0;
    return `- ${m.long}: ${fmt_int(m.n_baseline)} events in ${BASELINE_YEAR}, ${fmt_int(m.attr)} truly lost, ${fmt_int(replaced)} replaced, replacement rate ${rate}%. Net ${fmt_delta(m.delta)}.`;
  });
  const best_repl = best_months[0];
  if (best_repl && best_repl.attr > 0) {
    const br_replaced = (best_repl.new ?? 0) + (best_repl.rec ?? 0);
    const br_rate = Math.round((br_replaced / best_repl.attr) * 100);
    summer_repl_lines.push(`- ${best_repl.long}: ${fmt_int(best_repl.n_baseline)} events in ${BASELINE_YEAR}, replacement rate ${br_rate >= 100 ? '>100%' : br_rate + '%'} ${EM_DASH} ${best_repl.long} is ${br_rate >= 100 ? 'gaining' : 'replacing'} events overall.`);
  }
  const total_new_rec = new_ev + rec;
  const truly_lost = attrited;
  const gross_repl = truly_lost > 0 ? Math.round((total_new_rec / truly_lost) * 100) : 0;

  notes.slide_6 = `SLIDE 6 ${EM_DASH} Step 4: Did We Really Lose Events? Event-Level Disposition

Key message: ${attrited > 0
    ? `Yes ${EM_DASH} ${fmt_int(attrited)} of ${fmt_int(n_baseline)} ${BASELINE_YEAR} events (${seg_pct(attrited)}%) did not return in any form. But ${fmt_int(new_ev)} new events and ${fmt_int(rec)} recovered events partially offset this. The replacement gap is widest in the peak demand months.`
    : 'No notable attrition this period.'}

Segment breakdown (of ${fmt_int(n_baseline)} ${BASELINE_YEAR} events):
- Retained: ${fmt_int(retained)} (${seg_pct(retained)}%) ${EM_DASH} same event, same month in ${ANALYSIS_YEAR}
- Shifted: ${fmt_int(shifted)} (${seg_pct(shifted)}%) ${EM_DASH} same event, different month in ${ANALYSIS_YEAR}
- Lost: ${fmt_int(attrited)} (${seg_pct(attrited)}%) ${EM_DASH} did not return to ${ANALYSIS_YEAR} in any form
- New: ${fmt_int(new_ev)} (${n_analysis ? Math.round((new_ev / n_analysis) * 100) : 0}% of ${ANALYSIS_YEAR} total) ${EM_DASH} brand new events in ${ANALYSIS_YEAR}
- Recovered: ${fmt_int(rec)} ${EM_DASH} were cancelled in ${BASELINE_YEAR} but came back in ${ANALYSIS_YEAR}
- Tried to Return: ${fmt_int(ttr)} ${EM_DASH} filed a ${ANALYSIS_YEAR} application but were cancelled/declined

${worst_chrono.length ? 'Replacement rates ' + EM_DASH + ' selected months:\n' + summer_repl_lines.join('\n') : ''}

Overall: ${fmt_int(total_new_rec)} new/recovered events vs ${fmt_int(truly_lost)} truly lost = ${gross_repl}% gross replacement.${worst_repl.length ? ' Weakest replacement in ' + list_and(worst_repl.map(m => m.label + ' (' + m.repl_rate + '%)')) + ' when it matters most.' : ''}`;

  // ── SLIDE 7 — Step 5: Pipeline & Opportunities ───────────────────────────
  // Build per-type pipeline lines from creation rows.
  const pipe_lines = pipeline.has_data
    ? pipeline.per_type.map(p => {
        const a_total = p.pre_a + p.iy_a;
        const b_total = p.pre_b + p.iy_b;
        return `- ${p.type}: ${fmt_int(p.pre_a)} Q4 prior-yr + ${fmt_int(p.iy_a)} in-yr ${pipeline.cutoff_label} ${BASELINE_YEAR} = ${fmt_int(a_total)} apps vs ${fmt_int(p.pre_b)} + ${fmt_int(p.iy_b)} = ${fmt_int(b_total)} in ${ANALYSIS_YEAR}. ${
          p.pre_b - p.pre_a < -5 ? 'Q4 down ' + fmt_int(p.pre_a - p.pre_b) : (p.pre_b - p.pre_a > 5 ? 'Q4 up ' + fmt_int(p.pre_b - p.pre_a) : 'Q4 flat')
        }, in-yr ${fmt_delta(p.iy_b - p.iy_a)}.`;
      })
    : ['- (Pipeline data not available)'];
  const iy_delta = pipeline.totals.iy_b - pipeline.totals.iy_a;
  const iy_pct = pipeline.totals.iy_a ? Math.round((iy_delta / pipeline.totals.iy_a) * 100) : 0;

  // Opportunities — numbered, ranked by priority.
  const opportunities = [];
  if (top_org_decliner) {
    opportunities.push(`1. ${top_org_decliner.type}: Highest ROI. Target potential ${top_org_decliner.type.toLowerCase()} organizers ${MN_SHORT[pipeline.cutoff_mo]}${EN_DASH}Aug before spontaneous registration window closes. Recovered events would close most of the ${fmt_delta(top_org_decliner.delta)} gap.`);
  }
  if (top_grower) {
    opportunities.push(`${opportunities.length + 1}. ${top_grower.type}: ${top_grower === top_org_grower ? 'Fast-track approvals so momentum is not lost to processing delays.' : 'Keep application channel open. Already running ahead.'}`);
  }
  // Catch-all for remaining types
  const other_types = by_type.filter(d => d !== top_org_decliner && d !== top_grower);
  if (other_types.length) {
    opportunities.push(`${opportunities.length + 1}. ${other_types.map(d => d.type).join(' / ')}: Monitor. Healthy pipeline, limited late-year upside.`);
  }

  notes.slide_7 = `SLIDE 7 ${EM_DASH} Step 5: Application Pipeline and Opportunities

Key message: ${pipeline.has_data
    ? `The application pipeline for ${ANALYSIS_YEAR} is running ${iy_pct >= 0 ? '+' : ''}${iy_pct}% vs ${BASELINE_YEAR} pace through ${MN_SHORT[pipeline.cutoff_mo]} (${fmt_delta(iy_delta)} in-year applications). The year-end event count will likely be ${iy_delta >= 0 ? 'higher' : 'lower'} than the ${MN_SHORT[pipeline.cutoff_mo]} snapshot suggests.`
    : 'Application pipeline data shows when organizers are filing relative to prior year.'}

Application totals (prior-year Q4 + in-year through ${MN_SHORT[pipeline.cutoff_mo]}):
${pipe_lines.join('\n')}

In-year ${pipeline.cutoff_label} comparison: ${fmt_int(pipeline.totals.iy_a)} in ${BASELINE_YEAR} vs ${fmt_int(pipeline.totals.iy_b)} in ${ANALYSIS_YEAR} = ${fmt_delta(iy_delta)} (${iy_pct >= 0 ? '+' : ''}${iy_pct}%).

Opportunities:
${opportunities.join('\n')}`;

  // ── SLIDE 8 — Step 6: Win-Back Opportunity ───────────────────────────────
  // Per-worst-month disposition lines + by-type lost summary
  const wb_disposition = worst_chrono.map(m => {
    const new_rec = (m.new ?? 0) + (m.rec ?? 0);
    const rate = m.attr > 0 ? Math.round((new_rec / m.attr) * 100) : 0;
    return `- ${m.long}: ${fmt_int(m.n_baseline)} events, ${fmt_int(m.ret)} retained, ${fmt_int(m.sa)} shifted out, ${fmt_int(m.attr)} lost, ${fmt_int(m.su)} shifted in, ${fmt_int(new_rec)} new/recovered = ${fmt_int(m.n_analysis)} total. Replacement rate ${rate}%.`;
  });

  // Lost by type across the worst months
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
  const lbt = {}; for (const t of TYPES) lbt[t] = 0;
  let lbt_total = 0;
  for (const m of worst_chrono) {
    for (const t of TYPES) {
      const v = r.attrMt?.[m.m]?.[t] ?? 0;
      lbt[t] += v; lbt_total += v;
    }
  }
  const lbt_lines = TYPES
    .filter(t => lbt[t] > 0)
    .sort((a, b) => lbt[b] - lbt[a])
    .map(t => {
      const share = lbt_total ? Math.round((lbt[t] / lbt_total) * 100) : 0;
      const role = share >= 30 ? '(core product)' : (share <= 10 ? '(minor)' : '');
      return `- ${t}: ${fmt_int(lbt[t])} (${share}% of worst-month attrition) ${role}`.trimEnd();
    });

  const act_now = worst_chrono[worst_chrono.length - 1];   // later month
  const diagnose = worst_chrono[0];                         // earlier month

  notes.slide_8 = `SLIDE 8 ${EM_DASH} Step 6: ${worst_labels_long.join(' & ')} Win-Back Opportunity

Key message: ${worst_chrono.length
    ? `${list_and(worst_labels_long)} account for the largest monthly losses, partially offset by new and recovered events. The net change reflects volume gaps rather than a broad shift in demand. The immediate opportunity is ${act_now.long}; the strategic opportunity is diagnosing ${diagnose.long}.`
    : 'Monitor replacement rates as the year progresses.'}

Disposition:
${wb_disposition.join('\n')}

Lost events by type (combined ${worst_labels_long.join(' + ')}):
${lbt_lines.join('\n')}

Two-speed action plan:

${act_now.long.toUpperCase()} (act now ${EM_DASH} the later worst month):
- ${fmt_int(act_now.attr)} attrited organizers are KNOWN contacts from ${BASELINE_YEAR}
- Reach all by end of ${MN_SHORT[(new Date()).getMonth() + 1] || 'May'}
- 20% win-back rate = ~${Math.round(act_now.attr * 0.2)} events recovered, closing part of the ${act_now.long} gap
- Focus on the top contributing types from the by-type list above

${diagnose.long.toUpperCase()} (diagnose for ${ANALYSIS_YEAR + 1}):
- ${fmt_int(diagnose.attr)} attrited, too late for ${ANALYSIS_YEAR}
- Q3 ${ANALYSIS_YEAR}: interview the attrited organizers to understand WHY they left
  - Common reasons to probe: venue/permit issues, cost increase, organizer retirement, competition, USAT process friction
- Use findings to inform ${ANALYSIS_YEAR + 1} retention strategy before Q4 planning begins`;


  // ── Excel Slack bullets — original "headline + interpretation" pattern ───
  const excel_slack_bullets = [
    // Bullet 1 — total + principal mover narrative
    `${fmt_int(n_analysis)} events in ${ANALYSIS_YEAR} vs ${fmt_int(n_baseline)} in ${BASELINE_YEAR} (${fmt_delta(net)}, ${fmt_pct(n_baseline, n_analysis)}).${
      top_decliner ? ` ${top_decliner.type} accounts for the full net decline (${fmt_delta(top_decliner.delta)}, organic ${top_decliner.org_pct !== null ? fmt_pct_n(top_decliner.org_pct) : 'n/a'})` : ''
    }${
      top_grower ? `; ${top_grower.type} the only growth story (${top_grower.org_pct !== null ? fmt_pct_n(top_grower.org_pct) : fmt_pct_n(top_grower.pct_n)} organic).` : '.'
    }`,

    // Bullet 2 — monthly story with calendar context
    worst_chrono.length
      ? `Declines concentrated in ${list_and(worst_labels_long)}: ${worst_chrono.map(m => `${m.long} ${fmt_delta(m.delta)}`).join(', ')}.${
          no_cal_cover ? ` Calendar provides zero alibi ${EM_DASH} ${list_and(worst_labels_long)} had identical weekend-day counts both years.` : ''
        }${
          misleading ? ` ${misleading.long} most misleading: ${fmt_delta(misleading.delta)} raw but ${fmt_delta1(misleading.organic)} organic.` : ''
        }`
      : 'Monthly distribution is broadly even.',

    // Bullet 3 — event-level disposition
    `Of ${fmt_int(n_baseline)} ${BASELINE_YEAR} active events: ${fmt_int(attrited)} truly did not return; ${fmt_int(ttr)} tried to return but were cancelled in ${ANALYSIS_YEAR} ${EM_DASH} actionable. ${fmt_int(rec)} recovered from prior cancellations.${
      worst_repl.length ? ` ${list_and(worst_repl.map(m => m.label))} had the worst replacement rates.` : ''
    }`,

    // Bullet 4 — standout month + new events
    (best_months[0]
      ? `${best_months[0].long} is the standout: ${best_months[0].cal < -5 ? `lost ${fmt_delta1(best_months[0].cal)} calendar but ` : ''}delivered ${fmt_delta1(best_months[0].organic)} organic growth ${EM_DASH} strongest month. `
      : '') +
    `${fmt_int(new_ev)} genuinely brand-new events joined ${ANALYSIS_YEAR}.${
      best_months[1] && best_months[1].delta > 0
        ? ` ${best_months[1].long} (${fmt_delta(best_months[1].delta)}) ${best_months[1].cal > 5 ? 'largely calendar-driven' : 'organic gain'}.`
        : ''
    }`,
  ];

  // ── Excel Step 0 type-read column ────────────────────────────────────────
  // Pattern: "[glyph] <status>. Organic <pct>. <action/conclusion>."
  const excel_type_reads = {};
  by_type.forEach(d => {
    const op_str = d.org_pct !== null ? fmt_pct_n(d.org_pct) : `${fmt_pct_n(d.pct_n)} (raw)`;
    let parts = [];
    let glyph = '';
    if (Math.abs(d.delta) <= 2) {
      parts = ['Flat', `Organic ${op_str}`];
      if (d.type.includes('Race')) parts.push('Race product stable');
    } else if (d.delta < -10) {
      glyph = `${WARN} `;
      parts = ['Material decline', `Organic ${op_str}`, 'Warrants follow-up'];
    } else if (d.delta < -3) {
      parts = ['Mild softness', `Organic ${op_str}`, 'Monitor'];
    } else if (d.delta > 10) {
      glyph = `${CHECK} `;
      parts = ['Only growth', `Organic ${op_str}`];
    } else if (d.delta > 3) {
      parts = ['Mild gain', `Organic ${op_str}`];
    } else {
      parts = ['Stable', `Organic ${op_str}`];
    }
    excel_type_reads[d.type] = glyph + parts.join('. ') + '.';
  });

  // ── Excel month narratives (1-line organic interpretation per month) ─────
  const excel_month_narratives = {};
  monthly_arr.forEach(m => {
    const org = m.organic, cal = m.cal, no_c = Math.abs(cal) < 0.5;
    const cal_str = no_c ? '' : `Calendar ${fmt_delta1(cal)}.`;
    let body;
    if (org > 15)       body = 'Exceptional organic month. Demand independent of calendar.';
    else if (org > 8)   body = `Strong organic growth. ${cal_str}`;
    else if (org > 3)   body = `Solid organic gain. ${cal_str}`;
    else if (org > 0)   body = `Modest organic gain. ${cal_str}`;
    else if (org > -3)  body = `Roughly flat organically. ${cal_str}`;
    else if (org > -8)  body = `Modest organic decline. ${cal_str}`;
    else if (org > -15) body = `Significant organic decline. ${no_c ? `Zero calendar cover ${EM_DASH} fully organic.` : cal_str}`;
    else                body = `Worst organic month. ${no_c ? `No calendar explanation ${EM_DASH} fully organic.` : cal_str}`;
    if (Math.abs(cal) > 8 && Math.sign(m.delta) !== Math.sign(org)) {
      body = `Most misleading. Looks ${fmt_delta(m.delta)} raw but ${fmt_delta1(org)} organic. ` +
        (cal > 0 ? `Calendar handed it ${fmt_delta1(cal)} expected that didn't materialise.` : `Calendar headwind ${fmt_delta1(cal)} overcome.`);
    }
    excel_month_narratives[m.label] = body.trim();
  });

  // ── Excel type insights (Step 3) ─────────────────────────────────────────
  const excel_type_insights = {};
  by_type.forEach(d => {
    const op = d.org_pct !== null ? d.org_pct : d.pct_n;
    const op_str = fmt_pct_n(op);
    if (op > 10)       excel_type_insights[d.type] = `${CHECK} Strong organic growth ${op_str}. Structural expansion.`;
    else if (op > 3)   excel_type_insights[d.type] = `Solid organic gain ${op_str}. Healthy trajectory.`;
    else if (op > -3)  excel_type_insights[d.type] = `Organic ${op_str}. Stable.`;
    else if (op > -8)  excel_type_insights[d.type] = `Mild softness ${op_str}. Watch item.`;
    else                excel_type_insights[d.type] = `${WARN} Material organic decline ${op_str}. Warrants follow-up.`;
  });

  // ── Excel calendar findings ──────────────────────────────────────────────
  const excel_calendar_findings = (() => {
    const findings = [];
    if (worst_chrono.length) {
      findings.push([
        `${worst_chrono.map(m => `${m.label} ${fmt_delta(m.delta)}`).join(' / ')}:`,
        no_cal_cover
          ? `ΔWknd=0 for ${list_and(worst_labels_long)}. Entire decline is organic attrition. No alibi.`
          : `Partial calendar cover. ${worst_chrono.map(m => `${m.label} organic ${fmt_delta1(m.organic)}`).join(', ')}.`,
      ]);
    }
    if (misleading) {
      findings.push([
        `${misleading.label} ${fmt_delta(misleading.delta)}:`,
        `Calendar effect ${fmt_delta1(misleading.cal)}. Actual ${fmt_delta(misleading.delta)} ${ARROW_R} organic ${fmt_delta1(misleading.organic)}. Most misleading month.`,
      ]);
    }
    const top_org = best_organic[0];
    if (top_org && top_org.organic > 5) {
      findings.push([
        `${top_org.label} ${fmt_delta(top_org.delta)}:`,
        top_org.cal < 0
          ? `Calendar headwind ${fmt_delta1(top_org.cal)} but organic ${fmt_delta1(top_org.organic)} ${EM_DASH} standout organic month.`
          : `Organic ${fmt_delta1(top_org.organic)} (calendar ${fmt_delta1(top_org.cal)}). Strongest organic month.`,
      ]);
    }
    const shift_months = monthly_arr.filter(m => Math.abs(m.cal) > 0.5 && !findings.some(f => f[0].startsWith(m.label)));
    if (shift_months.length) {
      findings.push([
        `${shift_months.map(m => m.label).join('/')}:`,
        `Weekend-day count changes (Sat/Sun shifts) explain part of the variance; residual is organic.`,
      ]);
    }
    return findings;
  })();

  // ── Excel pipeline findings ──────────────────────────────────────────────
  const excel_pipeline_findings = {};
  by_type.forEach(d => {
    if (top_org_decliner && d.type === top_org_decliner.type) {
      excel_pipeline_findings[d.type] = `${WARN} Largest organic gap (${fmt_pct_n(d.org_pct ?? 0)}). Proactive outreach in the remaining window can recover events.`;
    } else if (top_org_grower && d.type === top_org_grower.type) {
      excel_pipeline_findings[d.type] = `${CHECK} Pipeline expanding ${EM_DASH} organic ${fmt_pct_n(d.org_pct ?? 0)}. Growth is structural; reinforce, don't rescue.`;
    } else {
      excel_pipeline_findings[d.type] = `Pipeline tracks active event count. ${d.delta >= 0 ? 'Holding steady' : 'Mild softness'} ${EM_DASH} monitor late-year applications.`;
    }
  });
  excel_pipeline_findings['Overall Pipeline'] =
    `Year-end active count will reflect both early-filing demand and late-year spontaneous applications.${
      top_org_decliner ? ` ${top_org_decliner.type} is the gap to close.` : ''
    }`;

  // ── Dynamic slide headers / structural labels ────────────────────────────
  const data_as_of = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const slide_1_subtitle = `${BASELINE_YEAR} vs ${ANALYSIS_YEAR}  |  Year-over-Year Analysis`;
  const slide_1_data_note = `Data as of ${data_as_of}  |  Excl. Cancelled / Declined / Deleted  |  ~85${EN_DASH}90% event-level match confidence`;

  const slide_3_header = worst_chrono.length
    ? `Monthly Breakdown ${EM_DASH} ${list_and(worst_labels_long)} Drive the Declines`
    : 'Monthly Breakdown';
  const slide_3_type_detail_label = worst_chrono.length ? `Type Detail ${EM_DASH} ${list_and(worst_labels_long)}` : `Type Detail ${EM_DASH} Full Year`;

  const slide_3_callout_left = worst_chrono.length
    ? (() => {
        const types_in_loss = TYPES_with_loss(r, worst_chrono.map(m => m.m));
        if (!types_in_loss.length) return `${list_and(worst_labels_long)} ${EM_DASH} no single type dominates the loss.`;
        const clinic_in_loss = types_in_loss.some(t => t.includes('Clinic'));
        return `${list_and(worst_labels_long)} are driven by ${list_and(types_in_loss)} ${EM_DASH} ${clinic_in_loss ? 'broad-based' : 'not clinic-related'}.`;
      })()
    : 'Distribution of monthly change is broadly even.';
  const slide_3_callout_right = best_months[0]
    ? `${best_months[0].long} (${fmt_delta(best_months[0].delta)})${best_months[1] && best_months[1].delta > 0 ? ` and ${best_months[1].long} (${fmt_delta(best_months[1].delta)})` : ''} ${best_months[1] && best_months[1].delta > 0 ? 'are' : 'is'} the strongest month${best_months[1] && best_months[1].delta > 0 ? 's' : ''}. ${best_months[1] && best_months[1].delta > 0 ? 'Both show' : 'Shows'} genuine organic strength plus new event additions.`
    : 'No standout positive month.';

  const slide_4_header = no_cal_cover && worst_chrono.length
    ? `Is This a Calendar Effect?  No ${EM_DASH} Not for ${list_and(worst_labels_long)}`
    : `Is This a Calendar Effect?  Partially ${EM_DASH} See Month Analysis`;
  const slide_4_alert = no_cal_cover && worst_chrono.length
    ? `${list_and(worst_labels_long)} had ZERO change in weekend days (Sat or Sun) between ${BASELINE_YEAR} and ${ANALYSIS_YEAR}. There is no calendar explanation for the declines ${EM_DASH} they are fully organic.`
    : 'Calendar effects explain some but not all of the monthly variance.';

  const slide_5_callout_left = top_org_decliner
    ? `${top_org_decliner.type}: ${fmt_pct_n(top_org_decliner.org_pct ?? 0)} organic\nLeading organic decliner. Calendar effects do not account for this change.`
    : 'No structural decliner identified.';
  const slide_5_callout_right = top_org_grower
    ? `${top_org_grower.type}: ${fmt_pct_n(top_org_grower.org_pct ?? 0)} organic\nOnly type genuinely growing on an organic basis. ${CHECK}`
    : 'No structural grower identified.';

  const slide_5_best_months  = best_organic.slice(0, 4).map(m => `${m.label} ${fmt_delta1(m.organic)}`);
  const slide_5_worst_months = worst_organic.slice(0, 4).map(m => `${m.label} ${fmt_delta1(m.organic)}`);

  const slide_6_highlight_months = [
    worst_months[0]?.label, worst_months[1]?.label, best_months[0]?.label,
  ].filter(Boolean);

  const cur_month = MN[(new Date()).getMonth() + 1] || 'May';
  const slide_7_opportunity_label = `Highest-Probability Opportunities ${EM_DASH} ${cur_month} through December ${ANALYSIS_YEAR}`;
  const slide_7_callout_left_title = top_org_decliner
    ? `${top_org_decliner.type} ${EM_DASH} Highest ROI Opportunity`
    : `Application Pipeline ${EM_DASH} Focus Area`;

  const slide_8_header = worst_chrono.length
    ? `${list_and(worst_labels_long)}: Organic Churn and the Win-Back Opportunity`
    : 'Organic Churn and Win-Back Opportunity';
  const slide_8_subtitle = worst_chrono.length
    ? `Replacement is partial ${EM_DASH} the volume of churn is the problem more than the rate. The actionable target is ${worst_chrono[worst_chrono.length - 1].long}.`
    : 'Monitor replacement rates as the year progresses.';

  return {
    slide_1_bullets, slide_2_narrative, slide_3_narrative, slide_4_narrative,
    slide_5_narrative, slide_6_narrative, slide_7_narrative, slide_8_narrative,
    notes,
    BASELINE_YEAR, ANALYSIS_YEAR, data_as_of,
    slide_1_subtitle, slide_1_data_note,
    slide_3_header, slide_3_type_detail_label, slide_3_callout_left, slide_3_callout_right,
    slide_4_header, slide_4_alert,
    slide_5_callout_left, slide_5_callout_right, slide_5_best_months, slide_5_worst_months,
    slide_6_highlight_months,
    slide_7_opportunity_label, slide_7_callout_left_title,
    slide_8_header, slide_8_subtitle,
    excel_slack_bullets, excel_type_reads, excel_month_narratives,
    excel_type_insights, excel_calendar_findings, excel_pipeline_findings,
    n_baseline, n_analysis, net, by_type, top_decliner, top_grower,
    worst_months, best_months, attrited, new_ev, rec, repl_rate, seg,
    holidays: hol,
    _ai_generated: false,
  };
}


// Helper: top 1-2 event types that contributed the bulk of losses in the
// given months. Limits the list to keep callouts readable.
function TYPES_with_loss(r, month_nums) {
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];
  const totals = {};
  for (const t of TYPES) totals[t] = 0;
  for (const m of month_nums) {
    for (const t of TYPES) {
      const d = (r.c_analysis?.[m]?.[t] ?? 0) - (r.c_baseline?.[m]?.[t] ?? 0);
      if (d < 0) totals[t] += d;
    }
  }
  const losers = Object.entries(totals).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  if (!losers.length) return [];
  const total = losers.reduce((s, [, v]) => s + v, 0);
  const out = [losers[0][0]];
  if (losers.length > 1 && losers[1][1] / total >= 0.15) out.push(losers[1][0]);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// AI generator (calls Claude API) — tightened prompt for editorial voice.
// ════════════════════════════════════════════════════════════════════════════
async function generate_ai(r, api_key) {
  if (!api_key) return generate_rule_based(r);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });
  const b = compute_base(r);
  const base = generate_rule_based(r);
  const worst_labels = b.worst_months.slice(0, 2).filter(Boolean).sort((a, c) => a.m - c.m).map(m => m.long);

  const data_json = JSON.stringify({
    overview: { BASELINE_YEAR: b.BASELINE_YEAR, ANALYSIS_YEAR: b.ANALYSIS_YEAR, total_a: b.n_baseline, total_b: b.n_analysis, net: b.net },
    by_type:  b.by_type.map(d => ({ type: d.type, n_baseline: d.n_baseline, n_analysis: d.n_analysis, delta: d.delta, pct: d.pct_n, organic: d.org, organic_pct: d.org_pct })),
    monthly_worst:   b.worst_months.map(m => ({ month: m.long, short: m.label, delta: m.delta, organic: m.organic, cal: m.cal })),
    monthly_best:    b.best_months.map(m => ({ month: m.long, short: m.label, delta: m.delta, organic: m.organic, cal: m.cal })),
    worst_organic:   b.worst_organic.map(m => ({ month: m.long, organic: m.organic, cal: m.cal })),
    best_organic:    b.best_organic.map(m => ({ month: m.long, organic: m.organic, cal: m.cal })),
    worst_repl:      b.worst_repl.map(m => ({ month: m.long, replacement_rate: m.repl_rate, lost: m.attr, new: m.new })),
    misleading_month: b.misleading
      ? { month: b.misleading.long, raw: b.misleading.delta, organic: b.misleading.organic, cal: b.misleading.cal }
      : null,
    segments: {
      retained: b.retained, shifted: b.shifted, attrited: b.attrited,
      new_events: b.new_ev, recovered: b.rec, tried_to_return: b.ttr,
      replacement_rate_pct: b.repl_rate,
    },
    holidays: build_holiday_lists(b.BASELINE_YEAR, b.ANALYSIS_YEAR),
  });

  const fs_mod = require('fs'), path_mod = require('path');
  const notes_path = path_mod.join(__dirname, '..', '..', '..', 'notes.md');
  let analyst_notes = '';
  try {
    const raw = fs_mod.readFileSync(notes_path, 'utf8');
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (cleaned.replace(/[#\-\s]/g, '').length > 20) analyst_notes = cleaned;
  } catch { /* skip */ }

  const sample_notes_template = `Each speaker note MUST follow the structured-section format. Use ONLY these section headers (in this order, separating with single blank lines):

SLIDE 1: "SLIDE 1 ${EM_DASH} Title / Overview" then sections: Context: / Headline numbers: (4 bullet items with "-") / Data note: / Framework overview: (7 numbered steps).

SLIDE 2: "SLIDE 2 ${EM_DASH} Step 0: What Changed? Event Counts by Type" then: Key message: (1-2 sentences) / By type: (5 bullet items: 4 types + TOTAL, each "- TYPE: a → b (Δ, pct) — editorial fragment") / Talking point: (strategic angle or open question, 2-3 sentences).

SLIDE 3: "SLIDE 3 ${EM_DASH} Step 1: Monthly Breakdown" then: Key message: / Monthly highlights: (3 bullet items: Best months / Worst months / Full year) / Type detail for worst months: (1 bullet per worst month) / Talking point:.

SLIDE 4: "SLIDE 4 ${EM_DASH} Step 2: Is This a Calendar Effect?" then: Key message: / Methodology: / Key findings: (5 bullet items, one per notable month) / Event shifting note: / Talking point: / Holidays in ${b.BASELINE_YEAR}: (bulleted list) / Holidays in ${b.ANALYSIS_YEAR}: (bulleted list).

SLIDE 5: "SLIDE 5 ${EM_DASH} Step 3: Organic Performance" then: Key message: / Organic results by type: (4 bullet items, one per type with Raw/Calendar/Organic) / Formula: / Best organic months: / Worst organic months: / Talking point:.

SLIDE 6: "SLIDE 6 ${EM_DASH} Step 4: Did We Really Lose Events? Event-Level Disposition" then: Key message: / Segment breakdown: (6 bullet items, one per segment) / Replacement rates ${EM_DASH} selected months: (one bullet per worst/best month) / Overall: (gross replacement summary).

SLIDE 7: "SLIDE 7 ${EM_DASH} Step 5: Application Pipeline and Opportunities" then: Key message: / Application totals: (one bullet per type) / In-year comparison: / Opportunities: (numbered 1-4 with action verbs).

SLIDE 8: "SLIDE 8 ${EM_DASH} Step 6: ${worst_labels.join(' & ')} Win-Back Opportunity" then: Key message: / Disposition: (per worst month) / Lost events by type: / Two-speed action plan: with sub-sections "ACT NOW (the later worst month):" and "DIAGNOSE (the earlier worst month):".`;

  const prompt = `You are a sports-event analyst writing punchy, structured speaker notes for a USAT sanctioned-events deck. The reader is an executive who needs both the numbers AND your editorial take.${analyst_notes ? '\n\nAdditional analyst context and notes:\n' + analyst_notes.slice(0, 800) + '\n\nFactor these notes where relevant.' : ''}

Year-pair: ${b.BASELINE_YEAR} vs ${b.ANALYSIS_YEAR}

Data:
${data_json}

EDITORIAL RULES:
1. Voice: short, decisive, opinionated. Lead with the takeaway, not the data dump.
2. Each narrative (slide_N_narrative) = max 2 sentences.
3. Each "Key read" / "Insight" cell = ONE short sentence (max 12 words).
4. Slack bullets follow: "<headline metric + change>. <one interpretive sentence with so-what>."
5. Slide 1 bullets follow: { label: "<short bold metric>", sub: "<6-12 word editorial insight>" }.

SPEAKER NOTES RULES (very important):
- Each speaker note is 150${EN_DASH}300 words, NOT a single paragraph.
- Use the EXACT section headers and bullet structure described below.
- Use bullet character "-" for list items, not "*" or "•".
- Use a SINGLE blank line between sections.
- Use ARROW "${ARROW_R}" for ranges/before-after (e.g. "1,178 ${ARROW_R} 1,165").
- For Slide 4 notes you MUST include the holiday lists provided in data.holidays.
- For Slide 7 you MUST use the creation pipeline numbers (totals.iy_a / iy_b etc.).
- For Slide 8 you MUST name the two worst months from the data and reference their actual loss counts.

${sample_notes_template}

FORMATTING RULES:
6. Use Unicode minus "${MINUS}" for negatives (never "-"). Examples: "${MINUS}13", "${MINUS}1.1%".
7. Use em-dash "${EM_DASH}" (never "--").
8. Use thousands separators: "1,178" not "1178".
9. Full month names ("July", "August") in narratives and notes. Short forms ("Jul") only inside tables/labels.
10. Prefix the principal decliner with "${WARN}" in type-read / type-insight / pipeline cells. Prefix the principal grower with "${CHECK}".
11. Use the EXACT month names from the data ${EM_DASH} do not invent "summer" or assume specific months.

TONE RULES (very important — apply to ALL generated text):
- Use measured, professional, fact-based language. The reader is a senior executive.
- Forbidden vocabulary (do NOT use these words or close synonyms in any narrative, speaker note, bullet, key-read, or insight cell):
  disaster, crisis, cratered, collapse, hemorrhaging, freefall, alarming, critical, catastrophic, bleed, bleeding, twin bleeds, war, battle, attack, destroyed, devastating, killed, killing, inferno, tragedy, devastating, plunged, plummeted, imploded.
- Forbidden framings: "the funnel's break point", "the portfolio is inverting", "this is the crisis", "twin bleeds", "supply-side / demand-side death spiral", "the bleed continues", "X is finished", "X is dying".
- Replace dramatic adjectives with quantified language: instead of "Adult Clinic cratered" say "Adult Clinic declined 13.4% (organic ${'-'}11.3%)". Instead of "alarming clinic-wide weakness" say "material clinic-wide decline that warrants follow-up".
- Headlines may name a "principal decliner" or "leading grower"; they should NOT call anything an "engine firing", "growth engine", "bright spot's offset", or use stage-magic language.
- Use "decline / decrease / contraction / softness / weakness" for negative movement; "growth / gain / increase / expansion" for positive movement. Use "material" or "meaningful" instead of "alarming / critical".
- A professional analyst's voice: confident, specific, free of editorial drama. If a number is significant, let the number speak — do not amplify with emotive words.

Return ONLY valid JSON (no markdown fence) with these keys:
{
  "slide_1_bullets": [
    { "label": "<short metric>", "sub": "<6-12 word editorial insight>", "bg_type": "positive|negative|neutral" },
    ... 4 entries total
  ],
  "slide_2_narrative": "2 sentences with the headline takeaway first",
  "slide_3_narrative": "2 sentences on which months drove changes",
  "slide_4_narrative": "2 sentences on calendar vs organic verdict",
  "slide_5_narrative": "2 sentences on organic verdict by type",
  "slide_6_narrative": "2 sentences on disposition and replacement",
  "slide_7_narrative": "2 sentences on pipeline opportunity",
  "slide_8_narrative": "2 sentences on win-back action",
  "notes": {
    "slide_1": "Full structured speaker note for slide 1 (see template above)",
    "slide_2": "Full structured speaker note for slide 2",
    "slide_3": "Full structured speaker note for slide 3",
    "slide_4": "Full structured speaker note for slide 4 INCLUDING the holiday lists from data.holidays",
    "slide_5": "Full structured speaker note for slide 5",
    "slide_6": "Full structured speaker note for slide 6",
    "slide_7": "Full structured speaker note for slide 7 (use creation pipeline numbers)",
    "slide_8": "Full structured speaker note for slide 8 (name the two worst months)"
  },
  "excel_slack_bullets": ["...","...","...","..."],
  "excel_type_reads": {
    "Adult Race": "One short editorial sentence (~10 words). Glyph if decliner/grower.",
    "Youth Race": "...",
    "Adult Clinic": "...",
    "Youth Clinic": "..."
  },
  "excel_month_narratives": { "Jan":"...","Feb":"...","Mar":"...","Apr":"...","May":"...","Jun":"...","Jul":"...","Aug":"...","Sep":"...","Oct":"...","Nov":"...","Dec":"..." },
  "excel_type_insights": { "Adult Race":"...", "Youth Race":"...", "Adult Clinic":"...", "Youth Clinic":"..." },
  "excel_calendar_findings": [["Month label:","one-sentence finding"]],
  "excel_pipeline_findings": {
    "Adult Race": "...",
    "Youth Race": "...",
    "Adult Clinic": "...",
    "Youth Clinic": "...",
    "Overall Pipeline": "..."
  }
}`;


  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const cleaned = raw.replace(/```(?:json)?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in response');
    let ai;
    try {
      // Layer 1 — clean JSON. Most common path when Claude behaves.
      ai = JSON.parse(match[0]);
    } catch (parse_err) {
      // Layer 2 — jsonrepair. Handles unescaped quotes/newlines, smart
      // quotes, trailing commas, missing braces, and most truncation.
      let repaired = false;
      if (jsonrepair) {
        try {
          ai = JSON.parse(jsonrepair(match[0]));
          repaired = true;
          console.warn('  [AI commentary] JSON repaired via jsonrepair.');
        } catch (repair_err) { /* fall through to layer 3 */ }
      }
      if (!repaired) {
        // Layer 3 — slice back to the last clean separator and try again
        // (original recovery). Works when the response was truncated mid-
        // field; fails when corruption is in-string. jsonrepair above
        // handles the in-string case so this is now a last-resort path.
        const pos = parse_err.message.match(/position (\d+)/)?.[1];
        if (!pos) throw parse_err;
        const cutoff = Number(pos);
        let trimmed = match[0].slice(0, cutoff);
        const last_sep = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf('{'));
        if (last_sep < 0) throw parse_err;
        trimmed = trimmed.slice(0, last_sep) + '}';
        const opens = (trimmed.match(/\{/g) || []).length;
        const closes = (trimmed.match(/\}/g) || []).length;
        if (opens > closes) trimmed += '}'.repeat(opens - closes);
        ai = JSON.parse(trimmed);
        console.warn(`  [AI commentary] Sliced recovery at pos ${cutoff}; partial fields.`);
      }
    }

    return {
      ...base,
      ...ai,
      notes: { ...base.notes, ...(ai.notes ?? {}) },
      excel_type_reads:        { ...base.excel_type_reads,        ...(ai.excel_type_reads ?? {}) },
      excel_type_insights:     { ...base.excel_type_insights,     ...(ai.excel_type_insights ?? {}) },
      excel_month_narratives:  { ...base.excel_month_narratives,  ...(ai.excel_month_narratives ?? {}) },
      excel_calendar_findings: ai.excel_calendar_findings ?? base.excel_calendar_findings,
      excel_slack_bullets:     ai.excel_slack_bullets     ?? base.excel_slack_bullets,
      excel_pipeline_findings: { ...base.excel_pipeline_findings, ...(ai.excel_pipeline_findings ?? {}) },
      _ai_generated: true,
    };
  } catch (err) {
    console.warn(`  [AI commentary] Failed: ${err.message} -- using rule-based fallback`);
    return base;
  }
}

module.exports = { generate_rule_based, generate_ai, build_holiday_lists };

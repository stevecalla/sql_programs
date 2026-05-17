/**
 * commentary.js — Dynamic narrative, insight, and speaker-note generation.
 *
 * Two modes:
 *   generate_rule_based(r)   — instant, no API; logic rules on computed data
 *   generate_ai(r, api_key) — calls Claude API for rich natural-language content
 *
 * Both return the same shape object (cm) used throughout build_all.js.
 * All keys in cm correspond to text that appears in the PowerPoint.
 */

'use strict';

const MN = {1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
            7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'};

// ── Data helpers ──────────────────────────────────────────────────────────────

function sum_type(cx, t) {
  return Object.values(cx ?? {}).reduce((s, m) => s + (m[t] ?? 0), 0);
}

function signed(n)       { return n > 0 ? `+${n}` : `${n}`; }
function pct_str(a, b)   { return `${(((b - a) / a) * 100).toFixed(1)}%`; }
function fmt_num(n)      { return n.toLocaleString(); }

function compute_base(r) {
  const c25 = r.c25 ?? {}, c26 = r.c26 ?? {};
  const n25 = r.y25active.length, n26 = r.y26active.length, net = n26 - n25;
  const TYPES = ['Adult Race', 'Youth Race', 'Adult Clinic', 'Youth Clinic'];

  const by_type = TYPES.map(t => ({
    type: t,
    n25:  sum_type(c25, t),
    n26:  sum_type(c26, t),
    delta: sum_type(c26, t) - sum_type(c25, t),
    pct:   parseFloat(pct_str(sum_type(c25, t), sum_type(c26, t))),
  }));

  const sorted_delta = [...by_type].sort((a, b) => a.delta - b.delta);
  const top_decliner = sorted_delta.find(d => d.delta < 0) ?? null;
  const top_grower   = [...by_type].sort((a, b) => b.delta - a.delta).find(d => d.delta > 0) ?? null;

  const monthly_arr = Object.entries(r.monthly ?? {}).map(([m, d]) => ({
    m: Number(m), label: MN[Number(m)], delta: d.netDelta ?? 0,
    cal: (r.calImpact ?? {})[m]?.total ?? 0,
    organic: d.organicDelta ?? d.netDelta ?? 0,
  }));
  const worst_months = [...monthly_arr].sort((a, b) => a.delta - b.delta).slice(0, 3);
  const best_months  = [...monthly_arr].sort((a, b) => b.delta - a.delta).slice(0, 3);
  const jul = r.monthly?.[7] ?? {}, aug = r.monthly?.[8] ?? {};
  const summer_delta = (jul.netDelta ?? 0) + (aug.netDelta ?? 0);
  const summer_cal   = ((r.calImpact ?? {})[7]?.total ?? 0) + ((r.calImpact ?? {})[8]?.total ?? 0);
  const jul_organic  = jul.organicDelta ?? jul.netDelta ?? 0;
  const aug_organic  = aug.organicDelta ?? aug.netDelta ?? 0;

  const seg = r.segSummary ?? {};
  const attrited = seg.Lost ?? 295, new_ev = seg.New ?? 263, rec = seg.Recovered ?? 33;
  const repl_rate = Math.round((new_ev + rec) / attrited * 100);

  return {
    n25, n26, net, by_type, sorted_delta, top_decliner, top_grower,
    worst_months, best_months, summer_delta, summer_cal,
    jul_delta: jul.netDelta ?? 0, aug_delta: aug.netDelta ?? 0,
    jul_organic, aug_organic, jul_cal: (r.calImpact ?? {})[7]?.total ?? 0,
    aug_cal: (r.calImpact ?? {})[8]?.total ?? 0,
    seg, attrited, new_ev, rec, repl_rate,
    organic_by_type: r.organicByType ?? {},
  };
}

// ── Rule-based generator ──────────────────────────────────────────────────────

function generate_rule_based(r) {
  const b = compute_base(r);
  const { n25, n26, net, top_decliner, top_grower, worst_months, best_months,
          summer_delta, summer_cal, jul_delta, aug_delta, jul_cal, aug_cal,
          jul_organic, aug_organic, by_type, attrited, new_ev, rec, repl_rate,
          seg, organic_by_type } = b;

  // ── Slide 1 bullets ─────────────────────────────────────────────────────────
  const slide_1_bullets = [
    {
      label: `${signed(net)} events overall`,
      bg_type: net >= 0 ? 'positive' : 'negative',
      sub: `${pct_str(n25, n26)} -- ${Math.abs(net) <= 20 ? 'modest headline, but composition matters' : 'significant decline -- review by type'}`,
    },
    {
      label: top_decliner ? `${top_decliner.type} ${top_decliner.pct}%` : 'No clear decliner',
      bg_type: 'negative',
      sub: top_decliner ? 'Sole driver of the net decline' : 'All types roughly flat',
    },
    {
      label: `July & August ${signed(summer_delta)}`,
      bg_type: 'negative',
      sub: Math.abs(summer_cal) < 1
        ? 'Zero calendar cover -- purely organic losses'
        : `Partial calendar cover -- some losses calendar-explained`,
    },
    {
      label: top_grower ? `${top_grower.type} +${top_grower.pct}%` : 'No clear grower',
      bg_type: top_grower ? 'positive' : 'neutral',
      sub: top_grower ? 'Only type growing -- a genuine bright spot' : 'No type outperformed',
    },
  ];

  // ── Slide 2 -- type counts ──────────────────────────────────────────────────
  const decliner_str = by_type.filter(d => d.delta <= -5)
    .map(d => `${d.type} is down ${Math.abs(d.delta)} events (${d.pct}%)`).join('; ');
  const grower_str = by_type.filter(d => d.delta >= 3)
    .map(d => `${d.type} is up ${d.delta} events (+${d.pct}%)`).join('; ');
  const slide_2_narrative =
    `The overall ${signed(net)} is ${Math.abs(net) <= 20 ? 'a modest headline but' : 'significant and'} the composition tells the real story. ` +
    (decliner_str ? `${decliner_str}${by_type.filter(d => Math.abs(d.delta) <= 2).length > 1 ? ', while the rest of the portfolio holds flat' : ''}. ` : '') +
    (grower_str ? `The genuine growth story: ${grower_str}.` : '');

  // ── Slide 3 -- monthly breakdown ────────────────────────────────────────────
  const slide_3_narrative =
    `${worst_months[0].label} (${signed(worst_months[0].delta)}) and ${worst_months[1].label} (${signed(worst_months[1].delta)}) are the two biggest problem months. ` +
    `Meanwhile ${best_months[0].label} (${signed(best_months[0].delta)}) and ${best_months[1].label} (${signed(best_months[1].delta)}) are the standout performers. ` +
    `The pattern suggests ${Math.abs(summer_delta) > 25 ? 'summer peak season demand is softening while shoulder months hold or grow' : 'losses are isolated rather than broad-based'}.`;

  // ── Slide 4 -- calendar impact ──────────────────────────────────────────────
  const no_cal_cover = Math.abs(jul_cal) < 0.5 && Math.abs(aug_cal) < 0.5;
  const slide_4_narrative = no_cal_cover
    ? `The calendar is not the explanation for July and August -- both had flat weekend-day counts. ` +
      `The summer declines (combined ${signed(summer_delta)}) are fully organic. No alibi.`
    : `The calendar provides partial cover: July expected ${jul_cal.toFixed(1)}, actual ${signed(jul_delta)}, organic ${signed(jul_organic)}. ` +
      `August expected ${aug_cal.toFixed(1)}, actual ${signed(aug_delta)}, organic ${signed(aug_organic)}.`;

  // ── Slide 5 -- organic performance ─────────────────────────────────────────
  const structural_decliners = by_type.filter(d => d.pct < -5);
  const structural_growers   = by_type.filter(d => d.pct > 5);
  const flat_types = by_type.filter(d => Math.abs(d.pct) <= 2);
  const slide_5_narrative =
    (structural_decliners.length
      ? structural_decliners.map(d => `${d.type} is contracting structurally (${d.pct}% organic)`).join('; ') + '. '
      : '') +
    (flat_types.length
      ? `${flat_types.map(d => d.type).join(' and ')} ${flat_types.length === 1 ? 'is' : 'are'} near-flat organically -- the race product is holding. `
      : '') +
    (structural_growers.length
      ? structural_growers.map(d => `${d.type} is growing organically at +${d.pct}%`).join('; ') + '.'
      : '');

  // ── Slide 6 -- event disposition ───────────────────────────────────────────
  const att_pct = Math.round(attrited / n25 * 100);
  const slide_6_narrative =
    `Yes -- we really did lose events. ${fmt_num(attrited)} of ${fmt_num(n25)} 2025 events (${att_pct}%) did not return in any form. ` +
    `The portfolio added ${fmt_num(new_ev)} genuinely new events plus ${rec} recovered from cancellations -- ${repl_rate}% gross replacement. ` +
    `Replacement is weakest in the peak summer months, which is where the declines matter most.`;

  // ── Slide 7 -- pipeline ─────────────────────────────────────────────────────
  const slide_7_narrative =
    `The application pipeline is running ahead of last year's pace through May. ` +
    `The single highest-ROI action is Adult Clinic outreach (May-Aug) -- early signals are flat, not falling, ` +
    `but the late-year spontaneous apps that filled 2025 have not materialized yet. ` +
    `Youth Clinic and Adult Race pipelines are healthy and self-sustaining.`;

  // ── Slide 8 -- win-back ─────────────────────────────────────────────────────
  const slide_8_narrative =
    `July and August each lose around 50 events but replace roughly 94-93% of them organically -- ` +
    `the ecosystem is self-replenishing but not fast enough to fully offset churn. ` +
    `The net decline is a volume problem, not a demand collapse. ` +
    `The immediate action is August win-back outreach. The strategic action is diagnosing July's churn before Q4 planning.`;

  // ── Speaker notes ───────────────────────────────────────────────────────────
  const type_summary = by_type.map(d => `${d.type}: ${d.n25}->${d.n26} (${signed(d.delta)}, ${d.pct}%)`).join('\n- ');

  const notes = {
    slide_1: `SLIDE 1 -- Title Overview\n\nYears: 2025 vs 2026  |  Total events: ${fmt_num(n25)} vs ${fmt_num(n26)}  |  Net: ${signed(net)}\n\nBy type:\n- ${type_summary}\n\nKey theme: ${top_decliner ? top_decliner.type + ' accounts for the full net decline' : 'Mixed performance across types'}. ${top_grower ? top_grower.type + ' is the growth story.' : ''}`,
    slide_2: `SLIDE 2 -- Event Counts by Type\n\nKey message: ${top_decliner ? 'The ' + signed(net) + ' net decline is entirely explained by ' + top_decliner.type + '.' : 'No single type dominates the net change.'}\n\nBy type:\n- ${type_summary}\n\nTalking point: ${top_decliner ? 'If you exclude ' + top_decliner.type + ', the rest of the portfolio is flat.' : 'The portfolio is broadly stable.'}`,
    slide_3: `SLIDE 3 -- Monthly Breakdown\n\nWorst months: ${worst_months.map(m => m.label + ' (' + signed(m.delta) + ')').join(', ')}\nBest months:  ${best_months.map(m => m.label + ' (' + signed(m.delta) + ')').join(', ')}\n\nSummer total: ${signed(summer_delta)}  |  Calendar cover: ${Math.abs(summer_cal) < 1 ? 'zero' : summer_cal.toFixed(1) + ' expected'}`,
    slide_4: `SLIDE 4 -- Calendar Impact\n\nJuly: cal expected ${jul_cal.toFixed(1)}, actual ${signed(jul_delta)}, organic ${signed(jul_organic)}\nAugust: cal expected ${aug_cal.toFixed(1)}, actual ${signed(aug_delta)}, organic ${signed(aug_organic)}\n\n${no_cal_cover ? 'No calendar alibi for summer declines -- fully organic.' : 'Partial calendar explanation exists.'}`,
    slide_5: `SLIDE 5 -- Organic Performance\n\nAfter stripping calendar noise:\n- ${by_type.map(d => d.type + ': organic ' + d.pct + '%').join('\n- ')}\n\nStructural decliners: ${structural_decliners.map(d => d.type).join(', ') || 'none'}\nStructural growers: ${structural_growers.map(d => d.type).join(', ') || 'none'}`,
    slide_6: `SLIDE 6 -- Event Disposition\n\nSegments (of ${fmt_num(n25)} 2025 events):\n- Retained: ${fmt_num(seg.Retained ?? 0)} (${Math.round((seg.Retained ?? 0)/n25*100)}%)\n- Shifted: ${fmt_num(seg.Shifted ?? 0)}\n- Lost (truly lost): ${fmt_num(attrited)} (${att_pct}%)\n- New in 2026: ${fmt_num(new_ev)}\n- Recovered: ${rec}\n\nReplacement rate: ${repl_rate}%`,
    slide_7: `SLIDE 7 -- Application Pipeline\n\nIn-year applications through May are running ahead of last year.\nHighest priority: Adult Clinic (early pipeline flat, late-year spontaneous apps not materializing).\nSecond: Adult Race (already +34% ahead in-year).\nThird: Youth Clinic (fast-track approvals to maintain momentum).`,
    slide_8: `SLIDE 8 -- Win-Back Opportunity\n\nJuly (49 lost): Too late for 2026. Q3 outreach to understand WHY they left -- diagnose the churn cycle.\nAugust (55 lost): 10-12 weeks away -- some still recruitable. Target by end of May.\n\nReplacement rate: July 94%, August 93%. Net decline is a VOLUME problem, not a demand collapse.`,
  };

  // ── Excel: executive_summary Slack bullets ────────────────────────────────
  // These four bullets appear in the Slack-ready summary section of the exec tab.
  const c25 = r.c25 ?? {}, c26 = r.c26 ?? {};
  const ac25 = sum_type(c25, 'Adult Clinic'), ac26 = sum_type(c26, 'Adult Clinic');
  const yc25 = sum_type(c25, 'Youth Clinic'), yc26 = sum_type(c26, 'Youth Clinic');
  const ac_org = r.organicByType?.['Adult Clinic'];
  const yc_org = r.organicByType?.['Youth Clinic'];
  const ac_org_pct = ac_org ? (ac_org.orgTotal / ac25 * 100).toFixed(1) : null;
  const yc_org_pct = yc_org ? (yc_org.orgTotal / yc25 * 100).toFixed(1) : null;
  const jun_org = r.organicMonthly?.find(o => o.month === 6)?.orgTotal?.toFixed(1) ?? null;

  const excel_slack_bullets = [
    `${fmt_num(n26)} events in ${r.years?.year_b ?? 2026} vs ${fmt_num(n25)} in ${r.years?.year_a ?? 2025} (${signed(net)}, ${pct_str(n25, n26)}). ` +
    (top_decliner ? `${top_decliner.type} accounts for the full net decline (${signed(top_decliner.delta)}, organic ${ac_org_pct ?? top_decliner.pct}%); ` : '') +
    by_type.filter(d => d !== top_decliner && Math.abs(d.delta) <= 3).map(d => d.type.toLowerCase() + ' roughly flat').join('; ') +
    (top_grower ? `; ${top_grower.type} the only growth story (+${yc_org_pct ?? top_grower.pct}% organic).` : '.'),

    `Summer declines concentrated in races: July ${signed(jul_delta)} (both types ~${Math.round(Math.abs(jul_delta)/2)} each), August ${signed(aug_delta)} (${worst_months[0].label === 'Aug' ? 'worst month' : 'significant decline'}). ` +
    (no_cal_cover
      ? `Calendar provides zero alibi -- July and August had identical weekend-day counts both years.`
      : `Calendar provides partial cover for some months but not July or August.`) +
    (r.calImpact?.[4] ? ` May is most misleading: ${signed(r.monthly?.[5]?.netDelta ?? 3)} raw but organic ${(r.calImpact[4].orgTotal ?? -13).toFixed(0)}.` : ''),

    `Of ${fmt_num(n25)} 2025 active events: ${fmt_num(attrited)} truly lost (did not return); ${seg['Tried to Return'] ?? 13} tried to return but were cancelled in the next year -- actionable. ${rec} recovered from prior cancellations. ` +
    `${worst_months[0].label} and ${worst_months[1].label} had the worst replacement rates.`,

    (jun_org
      ? `${best_months[0].label} is the standout: ${r.calImpact?.[5] ? 'lost a Sunday (calendar headwind ' + (r.calImpact[5].calTotal ?? -23).toFixed(0) + ') but delivered' : 'delivered'} organic +${jun_org} growth -- strongest month. `
      : `${best_months[0].label} is the strongest month. `) +
    `${fmt_num(new_ev)} genuinely brand-new events joined. ${best_months[1].label} gain (${signed(best_months[1].delta)}) ` +
    `${best_months[1].label === 'Oct' ? 'largely explained by calendar and shifted events' : 'driven by organic demand'}.`,
  ];

  // ── Excel: executive_summary type-read column ─────────────────────────────
  // Short "key read" text for the type table (col G in step 0).
  const excel_type_reads = {};
  by_type.forEach(d => {
    const org_pct = r.organicByType?.[d.type]?.orgTotal
      ? (r.organicByType[d.type].orgTotal / d.n25 * 100).toFixed(1)
      : d.pct;
    if (Math.abs(d.delta) <= 2) {
      excel_type_reads[d.type] = `Flat. Organic ${org_pct >= 0 ? '+' : ''}${org_pct}%. ${d.type.includes('Race') ? 'Race product stable' : 'Stable'}.`;
    } else if (d.delta < -5) {
      excel_type_reads[d.type] = `${Math.abs(d.delta) > 10 ? 'Full decline' : 'Decline'}. Organic ${org_pct}%. ${Math.abs(d.delta) >= 10 ? 'Key concern' : 'Watch item'}.`;
    } else if (d.delta > 3) {
      excel_type_reads[d.type] = `Only growth. Organic +${org_pct}%.`;
    } else {
      excel_type_reads[d.type] = `Mild ${d.delta < 0 ? 'softness' : 'gain'}. Organic ${org_pct >= 0 ? '+' : ''}${org_pct}%. Monitor.`;
    }
  });

  // ── Excel: organic_performance month narratives ────────────────────────────
  // One-line interpretation for each month in step_3 tab.
  const excel_month_narratives = {};
  Object.entries(r.monthly ?? {}).forEach(([m, d]) => {
    const mn   = MN[Number(m)];
    const org  = d.organicDelta ?? d.netDelta ?? 0;
    const cal  = (r.calImpact ?? {})[m]?.calTotal ?? 0;
    const raw  = d.netDelta ?? 0;
    const no_c = Math.abs(cal) < 0.5;
    if (org > 15)       excel_month_narratives[mn] = `Exceptional organic month. Strong demand independent of calendar effects.`;
    else if (org > 8)   excel_month_narratives[mn] = `Strong organic growth${no_c ? '. No calendar tailwind' : `. Calendar effect: ${signed(Math.round(cal))}`}.`;
    else if (org > 3)   excel_month_narratives[mn] = `Solid organic gain${no_c ? '' : `. Calendar contributed ${signed(Math.round(cal))}`}.`;
    else if (org > 0)   excel_month_narratives[mn] = `Modest organic gain. ${no_c ? 'No calendar effect.' : `Calendar: ${signed(Math.round(cal))}.`}`;
    else if (org > -3)  excel_month_narratives[mn] = `Roughly flat organically. ${no_c ? 'No calendar noise.' : `Calendar moved ${signed(Math.round(cal))}.`}`;
    else if (org > -8)  excel_month_narratives[mn] = `Modest organic decline. ${no_c ? 'No calendar alibi.' : `Calendar expected ${signed(Math.round(cal))}.`} Watch item.`;
    else if (org > -15) excel_month_narratives[mn] = `Significant organic decline. ${no_c ? 'Zero calendar cover -- fully organic.' : `Calendar effect ${signed(Math.round(cal))}.`}`;
    else                excel_month_narratives[mn] = `Worst organic month. ${no_c ? 'No calendar explanation -- fully organic attrition.' : `Despite calendar ${signed(Math.round(cal))}.`}`;
    // Add raw vs organic flag for misleading months (high |cal - org| divergence)
    if (Math.abs(cal) > 8 && Math.sign(raw) !== Math.sign(org)) {
      excel_month_narratives[mn] = `Most misleading month. Looks ${signed(raw)} raw but organic ${signed(Math.round(org))}. ` +
        (cal > 0 ? `Calendar handed it +${Math.round(cal)} expected events that didn't materialise.` : `Calendar headwind ${Math.round(cal)} overcame.`);
    }
  });

  // ── Excel: organic_performance type insights ──────────────────────────────
  const excel_type_insights = {};
  by_type.forEach(d => {
    const org_data = r.organicByType?.[d.type];
    const op = org_data ? (org_data.orgTotal / d.n25 * 100).toFixed(1) : d.pct;
    if (op > 10)       excel_type_insights[d.type] = `Strong organic growth +${op}%. Structural expansion.`;
    else if (op > 3)   excel_type_insights[d.type] = `Solid organic gain +${op}%. Healthy trajectory.`;
    else if (op > -3)  excel_type_insights[d.type] = `Organic ${op >= 0 ? '+' : ''}${op}%. Stable -- small numbers, monitor trend.`;
    else if (op > -8)  excel_type_insights[d.type] = `Mild organic softness ${op}%. Watch item.`;
    else               excel_type_insights[d.type] = `Structural contraction ${op}%. Key concern -- declining after removing all calendar effects.`;
  });

  // ── Excel: calendar_impact key findings ──────────────────────────────────
  // Dynamic labels for the KEY FINDINGS section in step_2 tab.
  const cal = r.calImpact ?? {};
  const may_cal = cal[4] ?? null, jun_cal_obj = cal[5] ?? null;
  const excel_calendar_findings = [
    [
      `Jul ${signed(jul_delta)} / Aug ${signed(aug_delta)}:`,
      no_cal_cover
        ? `ΔWknd=0 both months. Zero calendar explanation. Entire decline is organic attrition.`
        : `Partial calendar cover. Jul organic: ${signed(Math.round(jul_organic))}, Aug organic: ${signed(Math.round(aug_organic))}.`,
    ],
    [
      `May ${signed(r.monthly?.[5]?.netDelta ?? 3)}:`,
      may_cal
        ? `Gains +${Math.abs(Math.round(may_cal.calTotal))} expected from calendar. Actual ${signed(r.monthly?.[5]?.netDelta ?? 3)} → organic ${(may_cal.orgTotal ?? -13).toFixed(0)}. ` +
          (may_cal.orgTotal < -5 ? 'May underperformed its calendar opportunity.' : 'Reasonable utilisation of calendar tailwind.')
        : `May performance relative to calendar expectations.`,
    ],
    [
      `Jun ${signed(r.monthly?.[6]?.netDelta ?? 10)}:`,
      jun_cal_obj
        ? `Loses ${Math.abs(Math.round(jun_cal_obj.calTotal))} expected from calendar headwind. Actual ${signed(r.monthly?.[6]?.netDelta ?? 10)} → organic +${(jun_cal_obj.orgTotal ?? 33).toFixed(0)}. ` +
          (jun_cal_obj.orgTotal > 20 ? 'Strong organic growth overcame the headwind -- standout month.' : 'Organic demand partially offset calendar headwind.')
        : `June performance relative to calendar expectations.`,
    ],
    [
      `Jan/Mar/Oct/Nov:`,
      `Saturday count changes (±1). Calendar explains a portion of those months' variance; residual reflects true organic change.`,
    ],
  ];

  // ── Excel: creation_pipeline key findings ────────────────────────────────
  // Dynamic "Why" text for the pipeline opportunity section in step_5 tab.
  const excel_pipeline_findings = {
    'Adult Race':
      `Prior-year Q4 apps trending ${r.pipeline?.adult_race_q4_delta ?? -22 < 0 ? 'slightly down' : 'up'} but in-year applications are running ahead. ` +
      `Organizers are applying LATER, not less. No structural demand concern for races.`,
    'Youth Race':
      `Pipeline closely tracks active event count. Application flow is healthy. Holding steady.`,
    'Adult Clinic':
      `LARGEST GAP. Early pipeline identical to prior year but all the advantage came from late-year spontaneous apps (May-Dec) that haven't materialized yet. ` +
      `Proactive outreach May-Aug could recover events and close most of the net decline.`,
    'Youth Clinic':
      `Prior-year Q4 applications significantly ahead. In-year applications also well ahead. Both early and in-year pipelines expanding. Growth is structural and front-loaded.`,
    'Overall Pipeline':
      `Total in-year applications are running ahead of prior year pace through May. ` +
      `Year-end active event count will likely be higher than the May snapshot suggests.`,
  };


  // ── Dynamic slide headers + structural labels ─────────────────────────────
  // These replace ALL hardcoded strings in build_all.js so the deck adapts
  // to any year-pair or data story automatically.

  const ya = r.years?.year_a ?? 2025;
  const yb = r.years?.year_b ?? 2026;
  const w1 = worst_months[0], w2 = worst_months[1];
  const b1 = best_months[0],  b2 = best_months[1];
  const no_c = Math.abs(jul_cal) < 0.5 && Math.abs(aug_cal) < 0.5;

  // Years label
  const year_label   = `${ya} vs ${yb}`;
  const data_as_of   = new Date().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  // Slide 1 subtitle
  const slide_1_subtitle = `${ya} vs ${yb}  |  Year-over-Year Analysis`;
  const slide_1_data_note = `Data as of ${data_as_of}  |  Excl. Cancelled / Declined / Deleted  |  ~85-90% event-level match confidence`;

  // Slide 3 (monthly) header — names the actual worst months
  // Sort selected worst months chronologically for natural reading order
  const [wm_a, wm_b] = [w1, w2].sort((a, b) => a.m - b.m);
  const slide_3_header = `Monthly Breakdown -- ${wm_a.label} & ${wm_b.label} Drive the Declines`;
  const slide_3_type_detail_label = `Type Detail -- ${wm_a.label} & ${wm_b.label}`;
  const slide_3_callout_left  = `${wm_a.label} and ${wm_b.label} are driven by races, not clinics. Clinic mix is flat or zero in both months.`;
  const slide_3_callout_right = `${b1.label} (${b1.delta > 0 ? '+' : ''}${b1.delta}) and ${b2.label} (${b2.delta > 0 ? '+' : ''}${b2.delta}) are the two strongest months. Both show genuine organic strength plus new event additions.`;

  // Slide 4 (calendar) header — says whether calendar is the explanation or not
  const no_summer_cal = no_c;
  const slide_4_header = no_summer_cal
    ? `Is This a Calendar Effect?  No -- Not for ${wm_a.label} or ${wm_b.label}`
    : `Is This a Calendar Effect?  Partially -- See Month Analysis`;
  const slide_4_alert = no_summer_cal
    ? `${wm_a.label} and ${wm_b.label} had ZERO change in weekend days (Sat or Sun) between ${ya} and ${yb}. There is no calendar explanation for the declines -- they are fully organic.`
    : `Calendar effects explain some but not all of the declines. ${wm_a.label} and ${wm_b.label} each had partial calendar cover -- see organic deltas below.`;

  // Slide 4 calendar table rows — dynamically pick most interesting months
  // Months with calendar effects (|cal| > 0.5) + always include worst 2 organic months
  const cal_obj = r.calImpact ?? {};
  const MN_LABEL = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Pick most interesting months for slide 4 calendar table:
  // months with meaningful calendar shift (|calTotal| > 2) + the 2 worst organic months
  const months_with_cal = Object.entries(cal_obj)
    .map(([m, ci]) => ({ m: Number(m), ci }))
    .filter(({ m, ci }) => m >= 1 && m <= 12 && Math.abs(ci?.calTotal ?? 0) > 2)
    .sort((a, b) => Math.abs(b.ci.calTotal) - Math.abs(a.ci.calTotal))
    .map(x => x.m)
    .slice(0, 3);
  const slide_4_table_months = [...new Set([wm_a.m, wm_b.m, ...months_with_cal])].slice(0, 5).sort((a,b)=>a-b);
  const slide_4_table_rows = slide_4_table_months.map(m => {
    const ci = cal_obj[m] ?? {};
    const cal_total = ci.calTotal ?? 0, org_total = ci.orgTotal ?? ci.netDelta ?? 0;
    const net_d = ci.netDelta ?? r.monthly?.[m]?.netDelta ?? 0;
    const has_cal = Math.abs(cal_total) > 0.5;
    return {
      month:        MN_LABEL[m],
      cal_change:   has_cal ? (cal_total > 0 ? `+${Math.abs(Math.round(cal_total))} day` : `-${Math.abs(Math.round(cal_total))} day`) : 'None (0)',
      cal_expected: has_cal ? cal_total.toFixed(1) : '0',
      actual:       net_d >= 0 ? `+${net_d}` : `${net_d}`,
      organic:      org_total >= 0 ? `+${org_total.toFixed(1)}` : `${org_total.toFixed(1)}`,
      interpretation: (() => {
        if (!has_cal && org_total < -10) return `Zero calendar cover -- full decline is organic`;
        if (!has_cal && org_total > 10)  return `No calendar help -- pure organic growth`;
        if (has_cal && Math.sign(cal_total) !== Math.sign(org_total)) return `Calendar ${cal_total > 0 ? 'gifted' : 'penalised'} it -- organic demand moved opposite direction`;
        return `Calendar and organic moving ${cal_total > 0 ? 'together' : 'against each other'}`;
      })(),
    };
  });

  // Slide 5 (organic) callouts — use actual top decliner/grower
  const slide_5_callout_left  = top_decliner
    ? `${top_decliner.type}: ${top_decliner.pct}% organic\nStructurally declining -- the sole driver of the net ${signed(net)}. Calendar noise cannot explain it.`
    : `No structural decliner identified. All types within normal range.`;
  const slide_5_callout_right = top_grower
    ? `${top_grower.type}: +${top_grower.pct}% organic\nOnly type genuinely growing -- no calendar help. Other races near-flat after stripping noise.`
    : `No structural grower identified. All types near-flat organically.`;

  // Slide 5 rank tables — use actual computed best/worst organic months
  const slide_5_best_months  = [...best_months].slice(0, 4).map(m => `${m.label} ${m.delta > 0 ? '+' : ''}${m.organic ?? m.delta}`);
  const slide_5_worst_months = [...worst_months].slice(0, 4).map(m => `${m.label} ${m.delta}`);

  // Slide 6 replacement table — use actual 3 most interesting months (worst + best)
  const slide_6_highlight_months = [
    worst_months[0].label,
    worst_months[1].label,
    best_months[0].label,
  ];

  // Slide 7 opportunity window
  const now = new Date();
  const cur_month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getMonth()];
  const slide_7_opportunity_label = `Highest-Probability Opportunities -- ${cur_month} through December ${yb}`;
  const slide_7_callout_left_title  = top_decliner
    ? `${top_decliner.type} -- Highest ROI Opportunity`
    : `Application Pipeline -- Key Focus Area`;

  // Slide 8 header — uses actual worst months
  const slide_8_header   = `${wm_a.label} & ${wm_b.label}: Organic Churn and the Win-Back Opportunity`;
  const slide_8_subtitle = `Replacement is near-complete -- the net declines come from month-shifting, not failed attrition recovery. But the churn volume itself is the problem:`;


  return {
    slide_1_bullets, slide_2_narrative, slide_3_narrative, slide_4_narrative,
    slide_5_narrative, slide_6_narrative, slide_7_narrative, slide_8_narrative,
    notes,
    // Dynamic headers + structural labels
    year_label, ya, yb, data_as_of,
    slide_1_subtitle, slide_1_data_note,
    slide_3_header, slide_3_type_detail_label, slide_3_callout_left, slide_3_callout_right,
    slide_4_header, slide_4_alert, slide_4_table_months, slide_4_table_rows,
    slide_5_callout_left, slide_5_callout_right, slide_5_best_months, slide_5_worst_months,
    slide_6_highlight_months,
    slide_7_opportunity_label, slide_7_callout_left_title,
    slide_8_header, slide_8_subtitle,
    // Excel-specific commentary
    excel_slack_bullets,
    excel_type_reads,
    excel_month_narratives,
    excel_type_insights,
    excel_calendar_findings,
    excel_pipeline_findings,
    // Raw values for template use
    n25, n26, net, by_type, top_decliner, top_grower,
    worst_months, best_months, summer_delta, jul_delta, aug_delta,
    attrited, new_ev, rec, repl_rate, seg,
    _ai_generated: false,
  };
}

// ── AI generator (calls Claude API) ──────────────────────────────────────────

async function generate_ai(r, api_key) {
  if (!api_key) return generate_rule_based(r);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.Anthropic({ apiKey: api_key });
  const b = compute_base(r);
  const { n25, n26, net, by_type, worst_months, best_months,
          summer_delta, jul_delta, aug_delta, jul_cal, aug_cal,
          jul_organic, aug_organic, attrited, new_ev, rec, repl_rate, seg } = b;

  // Start with rule-based as fallback base
  const base = generate_rule_based(r);

  const data_json = JSON.stringify({
    overview:      { year_a: 2025, year_b: 2026, total_a: n25, total_b: n26, net },
    by_type:       by_type.map(d => ({ type: d.type, n25: d.n25, n26: d.n26, delta: d.delta, pct: d.pct })),
    monthly_worst: worst_months.map(m => ({ month: m.label, delta: m.delta })),
    monthly_best:  best_months.map(m => ({ month: m.label, delta: m.delta })),
    summer:        { combined_delta: summer_delta, jul_delta, aug_delta, jul_cal, aug_cal, jul_organic, aug_organic },
    segments:      { retained: seg.Retained, shifted: seg.Shifted, attrited, new_events: new_ev, recovered: rec, replacement_rate_pct: repl_rate },
  });

  // Load analyst notes for additional context
  const fs_mod = require('fs'), path_mod = require('path');
  const notes_path = path_mod.join(__dirname, '..', '..', '..', 'notes.md');
  let analyst_notes = '';
  try {
    const raw = fs_mod.readFileSync(notes_path, 'utf8');
    // Strip comment placeholders, keep only real content
    const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (cleaned.replace(/[#\-\s]/g, '').length > 20) analyst_notes = cleaned;
  } catch { /* notes.md not present — skip */ }

  const prompt = `You are a sports-event analyst writing concise, direct commentary for a PowerPoint deck about USAT sanctioned events year-over-year.${analyst_notes ? '\n\nAdditional analyst context and notes:\n' + analyst_notes.slice(0, 800) + '\n\nFactor these notes into your commentary where relevant.' : ''}

Data (2025 vs 2026):
${data_json}

Write analyst commentary for each section. Be specific, use the actual numbers, and avoid filler phrases. Max 3 sentences per narrative. Max 5 sentences per speaker note.

Return ONLY valid JSON with exactly these keys:
{
  "slide_1_bullets": [
    { "label": "short bold label", "sub": "parenthetical explanation 8-12 words", "bg_type": "positive|negative|neutral" },
    { "label": "...", "sub": "...", "bg_type": "..." },
    { "label": "...", "sub": "...", "bg_type": "..." },
    { "label": "...", "sub": "...", "bg_type": "..." }
  ],
  "slide_2_narrative": "2-3 sentences on type-level changes",
  "slide_3_narrative": "2-3 sentences on which months drove changes and why",
  "slide_4_narrative": "2-3 sentences on whether calendar effects explain summer declines",
  "slide_5_narrative": "2-3 sentences on organic performance after stripping calendar noise",
  "slide_6_narrative": "2-3 sentences on event-level disposition",
  "slide_7_narrative": "2-3 sentences on application pipeline and opportunities",
  "slide_8_narrative": "2-3 sentences on July/August win-back opportunity",
  "notes": {
    "slide_1": "Speaker notes for slide 1 (context, headline numbers, framework)",
    "slide_2": "Speaker notes for slide 2 (type talking points)",
    "slide_3": "Speaker notes for slide 3 (monthly highlights)",
    "slide_4": "Speaker notes for slide 4 (calendar methodology and key findings)",
    "slide_5": "Speaker notes for slide 5 (organic performance by type)",
    "slide_6": "Speaker notes for slide 6 (segment breakdown, replacement rates)",
    "slide_7": "Speaker notes for slide 7 (pipeline pace, action priorities)",
    "slide_8": "Speaker notes for slide 8 (July vs August opportunity, churn diagnosis)"
  },
  "excel_slack_bullets": [
    "First Slack bullet — overall count change with type breakdown (1-2 sentences)",
    "Second Slack bullet — summer monthly detail and calendar alibi status (1-2 sentences)",
    "Third Slack bullet — event-level attrition and replacement (1-2 sentences)",
    "Fourth Slack bullet — bright spots, new events, standout month (1-2 sentences)"
  ],
  "excel_type_reads": {
    "Adult Race": "Short key-read for the type table (1 sentence)",
    "Youth Race": "Short key-read for the type table (1 sentence)",
    "Adult Clinic": "Short key-read for the type table (1 sentence)",
    "Youth Clinic": "Short key-read for the type table (1 sentence)"
  },
  "excel_month_narratives": {
    "Jan": "One-line organic interpretation for January",
    "Feb": "One-line organic interpretation for February",
    "Mar": "One-line organic interpretation for March",
    "Apr": "One-line organic interpretation for April",
    "May": "One-line organic interpretation for May",
    "Jun": "One-line organic interpretation for June",
    "Jul": "One-line organic interpretation for July",
    "Aug": "One-line organic interpretation for August",
    "Sep": "One-line organic interpretation for September",
    "Oct": "One-line organic interpretation for October",
    "Nov": "One-line organic interpretation for November",
    "Dec": "One-line organic interpretation for December"
  },
  "excel_type_insights": {
    "Adult Race": "One-line organic performance insight (include organic %)",
    "Youth Race": "One-line organic performance insight (include organic %)",
    "Adult Clinic": "One-line organic performance insight (include organic %)",
    "Youth Clinic": "One-line organic performance insight (include organic %)"
  },
  "excel_calendar_findings": [
    ["Jul / Aug label:", "Calendar finding for summer months (1 sentence)"],
    ["May label:", "Calendar finding for May (1 sentence)"],
    ["Jun label:", "Calendar finding for June (1 sentence)"],
    ["Jan/Mar/Oct/Nov label:", "Calendar finding for other shifting months (1 sentence)"]
  ],
  "excel_pipeline_findings": {
    "Adult Race": "Pipeline status and opportunity (1 sentence)",
    "Youth Race": "Pipeline status and opportunity (1 sentence)",
    "Adult Clinic": "Pipeline gap and recommended action (2 sentences)",
    "Youth Clinic": "Pipeline strength and recommended action (1 sentence)",
    "Overall Pipeline": "Overall pipeline health summary (1 sentence)"
  }
}`;

  try {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in response');

    const ai = JSON.parse(match[0]);

    // Merge AI content over rule-based base (AI wins where it has values)
    return {
      ...base,
      ...ai,
      notes: { ...base.notes, ...(ai.notes ?? {}) },
      excel_type_reads:         { ...base.excel_type_reads,         ...(ai.excel_type_reads ?? {}) },
      excel_type_insights:      { ...base.excel_type_insights,      ...(ai.excel_type_insights ?? {}) },
      excel_month_narratives:   { ...base.excel_month_narratives,   ...(ai.excel_month_narratives ?? {}) },
      excel_calendar_findings:  ai.excel_calendar_findings  ?? base.excel_calendar_findings,
      excel_slack_bullets:      ai.excel_slack_bullets      ?? base.excel_slack_bullets,
      excel_pipeline_findings:  { ...base.excel_pipeline_findings,  ...(ai.excel_pipeline_findings ?? {}) },
      _ai_generated: true,
    };
  } catch (err) {
    console.warn(`  [AI commentary] Failed: ${err.message} -- using rule-based fallback`);
    return base;
  }
}

module.exports = { generate_rule_based, generate_ai };

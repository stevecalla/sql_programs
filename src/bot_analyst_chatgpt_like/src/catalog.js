const dotenv = require("dotenv");
dotenv.config({ path: "./../../../.env" });

const project = String(process.env.USAT_BQ_PROJECT_ID || "").trim();
const dataset = "membership_reporting";

/**
 * Notes:
 * - Keep this curated list small + “business meaning” focused.
 * - The AI will use these descriptions/examples/tags to choose the right source.
 * - We intentionally do NOT enumerate every column here.
 * - date_expr is a placeholder token your normalize_sql() can expand if the model uses `date_expr`.
 */
const CATALOG = [
  // ---------------------------
  // MEMBERSHIP SALES (RAW / TRANSACTIONAL)
  // ---------------------------
  {
    id: "membership_data",
    project,
    dataset: "membership_reporting",
    table: "membership_data",
    description: "Raw membership sales records. Use for daily/monthly sales, revenue, mix, month to date and year to date cuts.",
    pii_risk: "medium",
    example_questions: [
      "memberships sold this month",
      "membership revenue by type this month"
    ],

    // optional hint (helps inference and time-filter correctness)
    date_field: "purchased_on_adjusted_mp",
    date_field_date: "purchased_on_date_adjusted_mp",
    date_field_year: "purchased_on_year_adjusted_mp",
    date_field_month: "purchased_on_month_adjusted_mp",

    default_sales_units_field: "sales_units",
    default_sales_revenue_field: "sales_revenue",
    default_count_table: true, // optional flag so you can bias table selection

  },

  // ---------------------------
  // MEMBERSHIP (AGGREGATED)
  // ---------------------------
  {
    id: "membership_base_data",
    project,
    dataset,
    table: "membership_base_data",
    description:
      "Aggregated active membership table (safe default for active membership counts)",
    pii_risk: "low",
    tags: ["membership", "active members"],
    example_questions: [
      "membership base",
      "number of active members",
      "number of active members month to date vs last year same period",
      "active member by member type, member category",
    ],
    // model can use date_expr token; you can change later if membership_base_data has a standard date column
    // date_field: "purchased_on_adjusted_mp",
    // date_field_type: "STRING",
    // date_expr: "DATE(SAFE_CAST(purchased_on_adjusted_mp AS TIMESTAMP))",
    // default_sales_units_field: "sales_units",
    // default_sales_revenue_field: "sales_revenue",
  },


  {
    id: "membership_detail_data",
    project,
    dataset,
    table: "membership_detail_data",
    description:
      "Profile-level membership detail (renewals, cohorts, lifecycle). Use only if user explicitly asks for profile behavior/cohorts; otherwise aggregate.",
    pii_risk: "high",
    tags: ["membership", "active members", "profile_level", "cohort", "renewal", "lapse"],
    example_questions: [
      "membership base detailed ata",
      "number of active members",
      "number of active members month to date vs last year same period",
      "active member by member type, member category",
      "active member by age, gender, state",
      "renewal rate by cohort",
      "lapsed members who returned",
      "upgrade/downgrade behavior",
    ],
    // date_field: "purchased_on_adjusted_mp",
    // date_field_type: "STRING",
    // date_expr: "DATE(SAFE_CAST(purchased_on_adjusted_mp AS TIMESTAMP))",
  },

  // ---------------------------
  // PARTICIPATION (AGGREGATED / PROFILE)
  // ---------------------------
  {
    id: "participation_profile_data",
    project,
    dataset,
    table: "participation_profile_data",
    description:
      "Participation stats aggregated by profile/time (participants, participations, demographics). Default for 'participation stats', 'participants', 'participations', and trends over time.",
    pii_risk: "low",
    tags: ["participation", "participants", "participations", "racers"],
    example_questions: [
      "participation stats",
      "participants by year",
      "participations by month",
      "average age of participants over time",
    ],
    // guessing; update if you know the date field
    // date_field: "race_date",
    // date_field_type: "DATE",
    // date_expr: "race_date",
  },

  {
    id: "participation_race_profile_data",
    project,
    dataset,
    table: "participation_race_profile_data",
    description:
      "Race-level participation details by profile/race. Use for event/race participation breakdowns, distances, categories, and event-level trends.",
    pii_risk: "medium",
    tags: ["participation", "race_level", "events", "distance", "breakdown"],
    example_questions: [
      "participation by event and year",
      "top events by participation",
      "participation by distance category",
    ],
    // date_field: "race_date",
    // date_field_type: "DATE",
    // date_expr: "race_date",
  },

  {
    id: "all_participation_data_with_membership_match",
    project,
    dataset,
    table: "all_participation_data_with_membership_match",
    description:
      "Joined participation + membership match dataset. Use when the question links participation to membership status (members vs non-members, conversion, cross-sell, member participation rates).",
    pii_risk: "medium",
    tags: ["participation", "membership_match", "conversion", "members_vs_nonmembers"],
    example_questions: [
      "do members participate more than non-members?",
      "participation rate among members vs non-members",
      "membership conversion after participation",
    ],
    // date_field: "race_date",
    // date_field_type: "DATE",
    // date_expr: "race_date",
  },

  // ---------------------------
  // EVENTS / METRICS / MATCHING
  // ---------------------------
  {
    id: "event_metrics_data",
    project,
    dataset,
    table: "event_metrics_data",
    description:
      "Event-level metrics (sanctioned events, counts, performance metrics). Use for event trends, event KPIs, and event metadata summaries.",
    pii_risk: "low",
    tags: ["events"],
    example_questions: [
      "event counts by month",
      "event metrics trends by year",
      "top states by event volume",
    ],
    // date_field: "event_date",
    // date_field_type: "DATE",
    // date_expr: "event_date",
  },

  {
    id: "event_data_metrics_yoy_match",
    project,
    dataset,
    table: "event_data_metrics_yoy_match",
    description:
      "Year-over-year matched event metrics dataset. Use for YoY event comparisons with consistent matching across years.",
    pii_risk: "low",
    tags: ["events"],
    example_questions: [
      "event YoY growth by month",
      "which events grew most YoY",
      "YoY change in event counts",
    ],
    // date_field: "event_date",
    // date_field_type: "DATE",
    // date_expr: "event_date",
  },

  {
    id: "event_vs_participation_match_data",
    project,
    dataset,
    table: "event_vs_participation_match_data",
    description:
      "Matched dataset linking event records to participation records. Use to compare event supply vs participation demand and identify gaps.",
    pii_risk: "low",
    tags: ["events"],
    example_questions: [
      "events vs participation by region",
      "which events have high participation per event",
      "gaps between event counts and participation",
    ],
    // date_field: "event_date",
    // date_field_type: "DATE",
    // date_expr: "event_date",
  },

  // ---------------------------
  // REVENUE RECOGNITION
  // ---------------------------
  {
    id: "rev_recognition_base_data",
    project,
    dataset,
    table: "rev_recognition_base_data",
    description:
      "Revenue recognition base facts (membership revenue allocation inputs). Use for recognized revenue reporting and audit-style questions.",
    pii_risk: "medium",
    tags: ["rev_recognition", "revenue", "finance", "allocation"],
    example_questions: [
      "recognized revenue this month",
      "deferred vs recognized revenue",
      "revenue recognition by membership type",
    ],
    // date_field: "recognized_month",
    // date_field_type: "DATE",
    // date_expr: "recognized_month",
  },

  {
    id: "rev_recognition_allocation_data",
    project,
    dataset,
    table: "rev_recognition_allocation_data",
    description:
      "Revenue recognition monthly allocations (already allocated). Use for time series of recognized revenue and rollups.",
    pii_risk: "low",
    tags: ["rev_recognition", "allocation", "monthly", "revenue"],
    example_questions: [
      "recognized revenue by month",
      "recognized revenue by membership type by month",
    ],
    // date_field: "month",
    // date_field_type: "DATE",
    // date_expr: "month",
  },

  // ---------------------------
  // SALES GOALS / PERFORMANCE
  // ---------------------------
  {
    id: "sales_goals",
    project,
    dataset,
    table: "sales_goals",
    description:
      "Sales goals targets (plan). Use for goal benchmarks and target comparisons.",
    pii_risk: "low",
    tags: ["sales", "goals", "targets", "plan"],
    example_questions: [
      "what is the sales goal this month",
      "goals by membership type",
    ],
    // date_field: "goal_month",
    // date_field_type: "DATE",
    // date_expr: "goal_month",
  },

  {
    id: "sales_actual_vs_goal_data",
    project,
    dataset,
    table: "sales_actual_vs_goal_data",
    description:
      "Actual vs goal sales performance (reporting-ready). Use for goal attainment, variance, and performance tracking.",
    pii_risk: "low",
    tags: ["sales", "actual_vs_goal", "performance", "variance"],
    example_questions: [
      "actual vs goal this month",
      "goal attainment ytd",
      "variance vs goal by membership type",
    ],
    // date_field: "month",
    // date_field_type: "DATE",
    // date_expr: "month",
  },

  {
    id: "sales_year_over_year_data",
    project,
    dataset,
    table: "sales_year_over_year_data",
    description:
      "Year-over-year sales summary table (historical). Use for YoY comparisons and long-range trends.",
    pii_risk: "low",
    tags: ["sales", "yoy", "trend", "history"],
    example_questions: [
      "YoY sales change for this month",
      "sales trend over the past 5 years",
    ],
    // date_field: "month",
    // date_field_type: "DATE",
    // date_expr: "month",
  },

  {
    id: "sales_year_over_year_2026_data",
    project,
    dataset,
    table: "sales_year_over_year_2026_data",
    description:
      "Year-over-year sales summary table focused on 2026 reporting logic (if different). Prefer for 2026 dashboard parity questions.",
    pii_risk: "low",
    tags: ["sales", "yoy", "2026", "trend"],
    example_questions: [
      "YoY sales change for this month (2026 logic)",
      "2026 sales trend vs 2025",
    ],
    // date_field: "month",
    // date_field_type: "DATE",
    // date_expr: "month",
  },
];

module.exports = { CATALOG };
import pandas as pd
from rapidfuzz import fuzz, process

TRIFIND_XLSX = "/Users/stevecalla/usat/marketo_data/python_code/scrapper.py/js/tri_find/output/events/trifind_custom_search_2026_enriched_v4.xlsx"
USAT_CSV     = "/Users/stevecalla/usat/marketo_data/python_code/scrapper.py/js/membership_reporting_7.3_sanction_detail_table_020526.csv"
OUT_XLSX     = "/Users/stevecalla/usat/marketo_data/python_code/scrapper.py/js/tri_find/output/events/trifind_custom_search_2026_enriched_v4_with_internal_usat_match.xlsx"

SCORE_THRESHOLD = 90

us_state_to_abbrev = {
    "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE",
    "Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY",
    "Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
    "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC",
    "North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
    "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV",
    "Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC"
}

def truthy_yes(v) -> bool:
    s = str(v).strip().lower()
    return s in {"yes", "y", "true", "1"}

# -----------------------
# Load Trifind (try common sheet names)
# ---------------------
xl = pd.ExcelFile(TRIFIND_XLSX)
sheet = None
for candidate in ["Events (Enriched)", "All Events", "Events", xl.sheet_names[0]]:
    if candidate in xl.sheet_names:
        sheet = candidate
        break

tf = pd.read_excel(TRIFIND_XLSX, sheet_name=sheet)

# -----------------------
# Prep Trifind
# -----------------------
tf["state_abbrev"] = tf.get("state").map(us_state_to_abbrev).fillna("Other")

tf["parsed_date"] = pd.to_datetime(tf.get("date"), errors="coerce")
tf["tf_year"]  = tf["parsed_date"].dt.year
tf["tf_month"] = tf["parsed_date"].dt.month

tf["title_norm"] = tf.get("title").astype(str).str.lower().str.strip()

# Use your enriched flag column name (you mentioned triflag)
# In your enriched file it looks like is_usat_sanctioned exists; if not, this will just be False.
tf_flag_col = "is_usat_sanctioned" if "is_usat_sanctioned" in tf.columns else None

# -----------------------
# Load internal USAT sanctions CSV
# -----------------------
u = pd.read_csv(USAT_CSV)

# Parse internal date (your internal file has starts_events like "... , YYYY-MM-DD")
u["parsed_date"] = pd.to_datetime(u["starts_events"].astype(str).str.split(", ").str[-1], errors="coerce")
u["usat_year"] = u["parsed_date"].dt.year
u["usat_month"] = u["parsed_date"].dt.month
u["name_norm"] = u["name_events"].astype(str).str.lower().str.strip()

# Limit to 2026 to align with the Trifind file
u = u[u["usat_year"] == 2026].copy()

# Group by state for simple + fast matching
state_groups = {st: g.reset_index(drop=True) for st, g in u.groupby("region_state_code")}

# -----------------------
# Match loop
# -----------------------
rows = []

for _, r in tf.iterrows():
    st = r["state_abbrev"]
    title = r["title_norm"]
    tf_month = None if pd.isna(r["tf_month"]) else int(r["tf_month"])

    best = None
    score = 0
    method = None

    g = state_groups.get(st)
    if g is not None and len(g) and title:
        cand = g
        # Prefer same month (+/-1) if we have a month
        if tf_month is not None:
            cand = cand[(cand["usat_month"] >= tf_month - 1) & (cand["usat_month"] <= tf_month + 1)]
        if len(cand) == 0:
            cand = g
            method = "state_only"
        else:
            method = "state_month±1"

        m = process.extractOne(title, cand["name_norm"].tolist(), scorer=fuzz.ratio)
        if m:
            match_norm, score, _ = m
            best = cand[cand["name_norm"] == match_norm].iloc[0]

    # --- NEW: "Trifind flag counts as a match"
    trifind_flag = truthy_yes(r[tf_flag_col]) if tf_flag_col else False
    match_by_score = score >= SCORE_THRESHOLD
    match_by_flag = trifind_flag

    # This is the "match" now (flag OR score)
    matched_any = match_by_flag or match_by_score

    # Keep discrepancy logic: flag vs score disagree
    sanction_discrepancy_flag = (match_by_flag != match_by_score)

    # --- NEW: clearer reason labels (meaning matches name)
    if match_by_flag and match_by_score:
        reason = "flag_and_score"
    elif match_by_flag and not match_by_score:
        reason = "flag_only"
    elif (not match_by_flag) and match_by_score:
        reason = "score_only"
    else:
        reason = "neither"

    out = r.to_dict()

    # internal USAT match detail fields (if any)
    out.update({
        "usat_match_name": None if best is None else best.get("name_events"),
        "usat_match_state": None if best is None else best.get("region_state_code"),
        "usat_match_date": None if best is None else best.get("parsed_date"),
        "usat_match_month": None if best is None else best.get("usat_month"),
        "usat_match_year": None if best is None else best.get("usat_year"),

        "usat_sanction_id_internal": None if best is None else best.get("id_sanctioning_events"),
        "usat_status_internal": None if best is None else best.get("status_events"),
        "usat_event_type_internal": None if best is None else best.get("name_event_type"),
        "usat_race_type_internal": None if best is None else best.get("name_race_type"),

        "match_method": method,
        "match_score_internal": score,

        # explicit match signals
        "matched_by_flag": match_by_flag,
        "matched_by_score": match_by_score,

        # final (per your request: triflag counts as match)
        "matched_usat_sanctioned": matched_any,

        # keep discrepancy + reason
        "sanction_discrepancy_flag": sanction_discrepancy_flag,
        "reason_for_sanction": reason,
    })

    rows.append(out)

df = pd.DataFrame(rows)

# -----------------------
# Score bins
# -----------------------
bins = [0, 69, 79, 89, 94, 100]
labels = ["0–69", "70–79", "80–89", "90–94", "95–100"]
df["score_bin_internal"] = pd.cut(df["match_score_internal"], bins=bins, labels=labels, include_lowest=True)

score_summary = df["score_bin_internal"].value_counts().sort_index().reset_index()
score_summary.columns = ["match_score_bin_internal", "count"]

# -----------------------
# Flag / Match / Discrepancy summaries
# -----------------------
reason_summary = df["reason_for_sanction"].value_counts().reset_index()
reason_summary.columns = ["reason_for_sanction", "count"]

flag_summary = pd.DataFrame({
    "metric": ["matched_by_flag_TRUE", "matched_by_score_TRUE", "matched_usat_sanctioned_TRUE", "discrepancy_TRUE"],
    "count": [
        int(df["matched_by_flag"].sum()),
        int(df["matched_by_score"].sum()),
        int(df["matched_usat_sanctioned"].sum()),
        int(df["sanction_discrepancy_flag"].sum()),
    ]
})

discrepancy_breakdown = (
    df[df["sanction_discrepancy_flag"] == True]["reason_for_sanction"]
    .value_counts()
    .reset_index()
)
discrepancy_breakdown.columns = ["reason_for_sanction", "count"]

# -----------------------
# State summary (by final match flag)
# -----------------------
state_summary = (
    df.groupby(["state", "matched_usat_sanctioned"]).size()
      .unstack(fill_value=0)
      .rename(columns={True: "USAT", False: "Non-USAT"})
)
state_summary["Total"] = state_summary.sum(axis=1)
state_summary = state_summary.sort_values("Total", ascending=False).reset_index()

# -----------------------
# Overall summary (single-row quick glance)
# -----------------------
overall = pd.DataFrame([{
    "total_trifind_events": len(df),
    "usat_sanctioned_matched_usat_sanctioned_TRUE": int(df["matched_usat_sanctioned"].sum()),
    "usat_sanctioned_matched_usat_sanctioned_FALSE": int((~df["matched_usat_sanctioned"]).sum()),
    "flag_true": int(df["matched_by_flag"].sum()),
    "score_true": int(df["matched_by_score"].sum()),
    "discrepancy_true": int(df["sanction_discrepancy_flag"].sum()),
    "score_threshold": SCORE_THRESHOLD,
    "trifind_sheet_used": sheet,
}])

# -----------------------
# Write output with ALL tabs
# -----------------------
with pd.ExcelWriter(OUT_XLSX, engine="openpyxl") as writer:
    df.to_excel(writer, sheet_name="Enriched+USAT Match", index=False)
    score_summary.to_excel(writer, sheet_name="Score Summary", index=False)
    state_summary.to_excel(writer, sheet_name="State Summary", index=False)

    # new helpful tabs
    overall.to_excel(writer, sheet_name="Overall Summary", index=False)
    reason_summary.to_excel(writer, sheet_name="Reason Summary", index=False)
    flag_summary.to_excel(writer, sheet_name="Flag+Score Summary", index=False)
    discrepancy_breakdown.to_excel(writer, sheet_name="Discrepancy Breakdown", index=False)

print(f"✅ Wrote: {OUT_XLSX}")
print(overall.to_string(index=False))

// ============================================================================
// IRONMAN EVENT CLASSIFICATION — SINGLE SOURCE OF TRUTH
// ----------------------------------------------------------------------------
// Returns a SQL boolean predicate string that decides whether an event is an
// official IRONMAN race, given the event-name column reference `col`
// (e.g. 'e.name', 'name_events_rr', 'm.name_events_rr').
//
// Import this everywhere the rule is needed so the allow-list lives in ONE place.
//
// ----------------------------------------------------------------------------
// OLD (legacy "broad") rule — matched ANY 70.3 / 140.6 token in the name, which
// wrongly included independent half/full-distance races that are NOT IRONMAN
// (e.g. "Howlin Half 70.3", "Marthas Vineyard 70.3", "ShrineMan 70.3",
//  "White Mountains Triathlon 70.3", "Racing for Recovery ... 70.3"):
//
//     <col> LIKE '%IRONMAN%' OR <col> LIKE '%Ironman%'
//       OR <col> LIKE '%70.3%' OR <col> LIKE '%140.6%'
//
// ----------------------------------------------------------------------------
// NEW (curated) rule — name contains "ironman", PLUS an explicit allow-list of
// official IRONMAN races whose names omit "ironman". To add a newly-discovered
// official venue, add ONE line below — every consumer picks it up automatically.
// ============================================================================
function ironman_event_predicate(col) {
    return `(
            LOWER(${col}) LIKE '%ironman%'
         OR ${col} LIKE '%Augusta 70.3%'      -- IRONMAN 70.3 Augusta (2022, 2023, ...)
         OR ${col} LIKE '%IM 70.3 Maine%'     -- IRONMAN 70.3 Maine
         OR ${col} LIKE '%Steelhead 70.3%'    -- IRONMAN 70.3 Steelhead (Maytag)
        )`;
}

module.exports = {
    ironman_event_predicate,
};

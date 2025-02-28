// -- Section 2: KOZ Acception
// -- Purpose: KOZ was a series of event that had occurred where we had issues with the payments. Will be assigned either $10 or $15 based on membership type; KOZ handled registration outside of the api, but they sent us files to upload. they have not paid for these athletes yet so we have excluded the sales from our list until post-race documents are sent in and the money is paid.
// -- JAN2025CHANGES: No changes

const query_koz_acception_logic = 
`
    SELECT 
        st.id_membership_periods as id_membership_periods,
        st.source_2,
        st.purchase_on_year_membership_periods,
        ma.membership_period_id AS id_membership_periods_membership_applications,

        mp.origin_flag AS origin_flag_membership_periods,
        mp.origin_flag IN ("ADMIN_BULK_UPLOADER") AS is_origin_flag_membership_periods_admin_bulk,

        ev.id AS id_events,
        ev.sanctioning_event_id AS id_sanctioning_event,
        ev.sanctioning_event_id IN ("309904","309539","309234","309538","309537","309232") AS id_sanctioning_event_koz,

        CASE
            WHEN ev.sanctioning_event_id IN ("309232" , "309234", "309537", "309538", "309539", "309904")
                AND mp.origin_flag IN ("ADMIN_BULK_UPLOADER")
                AND st.source_2 IS NULL
            THEN 1
            ELSE 0
        END AS is_koz_acception

    FROM source_2_type AS st
        LEFT JOIN membership_applications AS ma ON st.id_membership_periods = ma.membership_period_id
        LEFT JOIN membership_periods AS mp ON st.id_membership_periods = mp.id
        LEFT JOIN events AS ev ON ma.event_id = ev.id

    -- WHERE
    --     ev.sanctioning_event_id IN ("309904","309539","309234","309538","309537","309232")
    --     AND 
    --     mp.origin_flag IN ("ADMIN_BULK_UPLOADER")
    --     AND 
    --     st.source_2 IS NULL
    
    GROUP BY st.id_membership_periods
`;
module.exports = { query_koz_acception_logic };
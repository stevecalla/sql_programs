// CODE AFTER 022825
function query_source_2_logic(year, start_date, end_date, operator, membership_period_ends, update_code, updated_at_date_mtn) {
    return `
        SELECT 
            membership_periods.id AS id_membership_periods,
            registration_audit.registration_company_id,
            order_products.order_id AS order_id_order_products,
            order_products.order_id IS NOT NULL AS is_order_id_not_null,
            membership_applications.payment_type AS payment_type_membership_applications,
            membership_applications.payment_type = 'chronotrack' AS is_payment_type_chronotrack,
            YEAR(membership_periods.purchased_on) AS purchase_on_year_membership_periods,

            -- JAN2025CHANGE Added below, smaller CASE statement
            CASE
                WHEN registration_companies.id IS NOT NULL THEN registration_companies.name
                WHEN order_products.order_id IS NOT NULL THEN 'Braintree'
                WHEN membership_applications.payment_type LIKE '%chronotrack%' THEN 'Chronotrack'
                ELSE NULL
            END AS source_2

        FROM membership_periods
            -- who the period belongs to
            LEFT JOIN members   ON members.id = membership_periods.member_id
            LEFT JOIN profiles  ON profiles.id = members.memberable_id
            LEFT JOIN users     ON users.id = profiles.user_id

            -- applications tied to the period
            LEFT JOIN membership_applications ON membership_applications.membership_period_id = membership_periods.id
                -- (optional, if you also want to enforce profile consistency)
                -- AND membership_applications.profile_id = profiles.id

            -- audits for the period, and the app↔audit bridge
            LEFT JOIN registration_audit_membership_application ON registration_audit_membership_application.membership_application_id = membership_applications.id
            LEFT JOIN registration_audit ON registration_audit_membership_application.audit_id = registration_audit.id

            -- commerce trail from an application
            LEFT JOIN order_products ON order_products.purchasable_id = membership_applications.id
            LEFT JOIN orders         ON orders.id = order_products.order_id
            LEFT JOIN transactions   ON transactions.order_id = orders.id

            -- app metadata
            LEFT JOIN membership_types ON membership_types.id = membership_applications.membership_type_id
            LEFT JOIN events          ON events.id = membership_applications.event_id

            -- JAN2025CHANGE Added Join
            LEFT JOIN registration_companies ON registration_companies.id = registration_audit.registration_company_id 
            
        WHERE 1 = 1
            -- AND YEAR(membership_periods.purchased_on) ${operator} ${year}

            -- AND membership_periods.purchased_on >= '${start_date}'
            -- AND membership_periods.purchased_on <= '${end_date}'
            ${update_code}

            AND membership_periods.ends >= '${membership_period_ends}'

            -- Excluding club memberships
            AND membership_periods.membership_type_id NOT IN (56, 58, 81, 105) 
            -- AND membership_periods.id NOT IN (4652554) -- JAN2025CHANGE Commented out. Sam inactivated.
            -- AND membership_periods.id IN (4242825, 4242826, 4242827, 4242828, 4242832)

            AND membership_periods.membership_type_id > 0
            AND membership_periods.terminated_on IS NULL

            -- REVIEW LOGIC
            -- AND order_products.order_id IS NOT NULL
            -- AND membership_applications.payment_type LIKE '%chronotrack%'
            -- AND membership_periods.id IN (3370681) -- check terminated on is not null

        GROUP BY membership_periods.id
        -- LIMIT 100
    `
};

// CODE PRIOR TO 022825
// function query_source_2_logic(year, start_date, end_date, operator, membership_period_ends) {
//     return `
//         SELECT 
//             membership_periods.id AS id_membership_periods,
//             registration_audit.registration_company_id,
//             order_products.order_id AS order_id_order_products,
//             order_products.order_id IS NOT NULL AS is_order_id_not_null,
//             membership_applications.payment_type AS payment_type_membership_applications,
//             membership_applications.payment_type = 'chronotrack' AS is_payment_type_chronotrack,
//             YEAR(membership_periods.purchased_on) AS purchase_on_year_membership_periods, -- added to summarize by year

//             -- source_2
//             CASE
//                 WHEN registration_audit.registration_company_id = 1 THEN 'Designsensory'
//                 WHEN registration_audit.registration_company_id = 2 THEN 'Active'
//                 WHEN registration_audit.registration_company_id = 3 THEN 'RunSignUp'
//                 WHEN registration_audit.registration_company_id = 4 THEN 'SignMeUp'
//                 WHEN registration_audit.registration_company_id = 5 THEN 'Chronotrack'
//                 WHEN registration_audit.registration_company_id = 6 THEN 'TriRegistration'
//                 WHEN registration_audit.registration_company_id = 7 THEN 'GetMeRegistered'
//                 WHEN registration_audit.registration_company_id = 8 THEN 'Ticket Socket'
//                 WHEN registration_audit.registration_company_id = 9 THEN 'Haku Sports'
//                 WHEN registration_audit.registration_company_id = 10 THEN 'Race Roster'
//                 WHEN registration_audit.registration_company_id = 11 THEN 'Technology Projects'
//                 WHEN registration_audit.registration_company_id = 12 THEN 'Test'
//                 WHEN registration_audit.registration_company_id = 13 THEN 'RaceEntry'
//                 WHEN registration_audit.registration_company_id = 14 THEN 'RaceReach'
//                 WHEN registration_audit.registration_company_id = 15 THEN 'AthleteReg'
//                 WHEN registration_audit.registration_company_id = 16 THEN 'USA Triathlon'
//                 WHEN registration_audit.registration_company_id = 17 THEN 'Events.com'
//                 WHEN registration_audit.registration_company_id = 18 THEN 'Athlete Guild'
//                 WHEN registration_audit.registration_company_id = 19 THEN 'imATHLETE'
//                 WHEN registration_audit.registration_company_id = 20 THEN 'The Driven'
//                 WHEN registration_audit.registration_company_id = 21 THEN 'Enmotive'
//                 WHEN registration_audit.registration_company_id = 22 THEN 'Event Dog'
//                 WHEN registration_audit.registration_company_id = 23 THEN 'Acme-Usat'
//                 WHEN registration_audit.registration_company_id = 24 THEN 'Webconnex'
//                 WHEN registration_audit.registration_company_id = 25 THEN 'Trifind'
//                 WHEN registration_audit.registration_company_id = 26 THEN "Let's Do This"
//                 WHEN registration_audit.registration_company_id = 27 THEN 'Zippy Reg'
//                 WHEN registration_audit.registration_company_id IS NOT NULL THEN registration_audit.registration_company_id

//                 WHEN order_products.order_id IS NOT NULL THEN "Braintree"
//                 WHEN membership_applications.payment_type LIKE '%chronotrack%' THEN 'Chronotrack'

//                 ELSE NULL
//             END AS source_2

//         FROM membership_applications
//             LEFT JOIN order_products ON membership_applications.id = order_products.purchasable_id
//             LEFT JOIN orders ON order_products.order_id = orders.id
//             LEFT JOIN registration_audit ON membership_applications.membership_period_id = registration_audit.membership_period_id
//             LEFT JOIN registration_audit_membership_application ON registration_audit.id = registration_audit_membership_application.audit_id
//             RIGHT JOIN membership_periods ON membership_applications.membership_period_id = membership_periods.id
//             LEFT JOIN membership_types ON membership_applications.membership_type_id = membership_types.id
//             RIGHT JOIN members ON membership_periods.member_id = members.id
//             RIGHT JOIN profiles ON members.memberable_id = profiles.id
//             LEFT JOIN users ON profiles.user_id = users.id
//             LEFT JOIN events ON membership_applications.event_id = events.id
//             LEFT JOIN transactions ON orders.id = transactions.order_id
            
//         WHERE 
//             membership_periods.membership_type_id NOT IN (56, 58, 81, 105)
//             AND membership_periods.id NOT IN (4652554)

//             -- YEAR(membership_periods.purchased_on) ${operator} ${year}

//             AND membership_periods.purchased_on >= '${start_date}'
//             AND membership_periods.purchased_on <= '${end_date}'

//             -- AND membership_periods.ends >= '2022-01-01'
//             AND membership_periods.ends >= '${membership_period_ends}'
//             AND membership_periods.membership_type_id > 0
//             AND membership_periods.terminated_on IS NULL

//             -- REVIEW LOGIC
//             -- AND order_products.order_id IS NOT NULL
//             -- AND membership_applications.payment_type LIKE '%chronotrack%'
//             -- AND membership_periods.id IN (3370681) -- check terminated on is not null
//         GROUP BY membership_periods.id
//         -- LIMIT 100
//     `
// }

module.exports = { query_source_2_logic };
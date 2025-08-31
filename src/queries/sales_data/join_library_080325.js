const join_members_profiles_users = `
    -- who the period belongs to

    -- membership_periods -- commented out but noted here as a reminder

        -- inner join ensures membership period has member else drops membership period
        INNER JOIN members    ON members.id = membership_periods.member_id 
            AND members.memberable_type = 'profiles'
            AND members.deleted_at IS NULL

        -- inner join ensures membership period has profile else drops membership period
        INNER JOIN profiles   ON profiles.id = members.memberable_id 
            AND profiles.deleted_at IS NULL

        LEFT JOIN users       ON users.id = profiles.user_id
`;

const join_membership_applications = `
    -- applications tied to the period
    LEFT JOIN membership_applications ON membership_applications.membership_period_id = membership_periods.id
        -- (optional, if you also want to enforce profile consistency)
        -- AND membership_applications.profile_id = profiles.id
`;

const join_orders_transactions = `
    -- commerce trail from an application
    LEFT JOIN order_products ON order_products.purchasable_id = membership_applications.id
    LEFT JOIN orders         ON orders.id = order_products.order_id
    LEFT JOIN transactions   ON transactions.order_id = orders.id
`;

const join_races = `
    LEFT JOIN races ON events.id = races.event_id
        AND races.deleted_at IS NULL
`;

const join_registration_audit = `
    -- audits for the period, and the app↔audit bridge
    LEFT JOIN registration_audit_membership_application ON registration_audit_membership_application.membership_application_id = membership_applications.id
    LEFT JOIN registration_audit ON registration_audit_membership_application.audit_id = registration_audit.id
`;

const join_metadata_addresses = `
    LEFT JOIN addresses ON profiles.primary_address_id = addresses.id
`;

const join_metadata_events = `
    LEFT JOIN events ON events.id = membership_applications.event_id
`;

const join_metadata_event_types = `
    LEFT JOIN event_types   ON events.event_type_id = event_types.id
`;

const join_metadata_membership_types = `
    -- app metadata
    LEFT JOIN membership_types ON membership_types.id = membership_applications.membership_type_id
`;

const join_metadata_registration_companies = `
    LEFT JOIN registration_companies ON registration_companies.id = registration_audit.registration_company_id 
`;

module.exports = {
    join_members_profiles_users,
    join_membership_applications,
    join_orders_transactions,
    join_races,
    join_registration_audit,
    join_metadata_addresses,
    join_metadata_events,
    join_metadata_event_types,
    join_metadata_membership_types,
    join_metadata_registration_companies,

};

// const membership_periods = `
//     FROM membership_periods
//     -- who the period belongs to
//     JOIN members    ON members.id = membership_periods.member_id
//         AND members.memberable_type = 'profiles'
//         AND members.deleted_at IS NULL
//     JOIN profiles   ON profiles.id = members.memberable_id
//         AND profiles.deleted_at IS NULL
//     LEFT JOIN users     ON users.id = profiles.user_id

//     -- applications tied to the period
//     LEFT JOIN membership_applications ON membership_applications.membership_period_id = membership_periods.id
//         -- (optional, if you also want to enforce profile consistency)
//         -- AND membership_applications.profile_id = profiles.id

//     -- audits for the period, and the app↔audit bridge
//     LEFT JOIN registration_audit_membership_application ON registration_audit_membership_application.membership_application_id = membership_applications.id
//     LEFT JOIN registration_audit ON registration_audit_membership_application.audit_id = registration_audit.id

//     -- commerce trail from an application
//     LEFT JOIN order_products ON order_products.purchasable_id = membership_applications.id
//     LEFT JOIN orders         ON orders.id = order_products.order_id
//     LEFT JOIN transactions   ON transactions.order_id = orders.id

//     -- app metadata
//     LEFT JOIN membership_types          ON membership_types.id = membership_applications.membership_type_id
//     LEFT JOIN events                    ON events.id = membership_applications.event_id
//     LEFT JOIN registration_companies    ON registration_companies.id = registration_audit.registration_company_id
// `;
-- REVISED CODE     
FROM profiles
        LEFT JOIN users users ON profiles.user_id = users.id
        LEFT JOIN members ON profiles.id = members.memberable_id
        LEFT JOIN membership_applications ON profiles.id = membership_applications.profile_id
        LEFT JOIN membership_periods ON membership_periods.id = membership_applications.membership_period_id
        LEFT JOIN registration_audit_membership_application ON membership_applications.id = registration_audit_membership_application.membership_application_id
        LEFT JOIN registration_audit ON registration_audit_membership_application.audit_id = registration_audit.id
        LEFT JOIN order_products ON membership_applications.id = order_products.purchasable_id
        LEFT JOIN orders ON order_products.order_id = orders.id
        LEFT JOIN transactions ON orders.id = transactions.order_id
        LEFT JOIN membership_types ON membership_applications.membership_type_id = membership_types.id
        LEFT JOIN events ON events.id = membership_applications.event_id

-- ORIGINAL 5a_sales_unit_logic_v2.js & 5a_sales_unit_logic.js
FROM membership_applications
        LEFT JOIN order_products ON (membership_applications.id = order_products.purchasable_id)
        LEFT JOIN orders ON (order_products.order_id = orders.id)
        LEFT JOIN registration_audit ON (membership_applications.membership_period_id = registration_audit.membership_period_id)
        LEFT JOIN registration_audit_membership_application ON (registration_audit.id = registration_audit_membership_application.audit_id)
        RIGHT JOIN membership_periods ON (membership_applications.membership_period_id = membership_periods.id)
        LEFT JOIN membership_types ON (membership_applications.membership_type_id = membership_types.id)
        RIGHT JOIN members ON (membership_periods.member_id = members.id)
        RIGHT JOIN profiles ON (members.memberable_id = profiles.id)
        LEFT JOIN users ON (profiles.user_id = users.id)
        LEFT JOIN events ON (membership_applications.event_id = events.id)
        LEFT JOIN transactions ON (orders.id = transactions.order_id)

-- ORIGINAL 1_source_2_logic_v2.js & 1_source_2_logic.js
FROM membership_applications
        LEFT JOIN order_products ON membership_applications.id = order_products.purchasable_id
        LEFT JOIN orders ON order_products.order_id = orders.id
        LEFT JOIN registration_audit ON membership_applications.membership_period_id = registration_audit.membership_period_id
        LEFT JOIN registration_audit_membership_application ON registration_audit.id = registration_audit_membership_application.audit_id
        RIGHT JOIN membership_periods ON membership_applications.membership_period_id = membership_periods.id
        LEFT JOIN membership_types ON membership_applications.membership_type_id = membership_types.id
        RIGHT JOIN members ON membership_periods.member_id = members.id
        RIGHT JOIN profiles ON members.memberable_id = profiles.id
        LEFT JOIN users ON profiles.user_id = users.id
        LEFT JOIN events ON membership_applications.event_id = events.id
        LEFT JOIN transactions ON orders.id = transactions.order_id
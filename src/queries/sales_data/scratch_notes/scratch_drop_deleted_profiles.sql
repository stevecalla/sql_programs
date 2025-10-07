SELECT
        p.id,
        p.updated_at,
        p.deleted_at,
        GROUP_CONCAT(mp.id)
        
FROM profiles AS p
        LEFT JOIN users users ON p.user_id = users.id
        LEFT JOIN members ON p.id = members.memberable_id
        LEFT JOIN membership_applications ON p.id = membership_applications.profile_id
        LEFT JOIN membership_periods AS mp ON mp.id = membership_applications.membership_period_id

WHERE 1 = 1
        -- AND p.id IN (2359515, 2868780)
        -- OR p.id IN ('2194283', '2868781')
        -- OR p.id IN (2520943,2868785)
        AND p.deleted_at > 2024-01-01
GROUP BY p.id, p.updated_at, p.deleted_at
;

-- UPDATED AT
SELECT 
        membership_periods.id,
        membership_periods.updated_at AS updated_at_profiles,

        members.memberable_type,
        members.updated_at AS updated_at_members,

        profiles.id,
        profiles.updated_at AS updated_at_profiles

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
        AND profiles.id IN (2359515, 2868780)
        AND (
                membership_periods.updated_at >= '2025-10-05'

                OR (
                members.updated_at > '2025-10-05'
                AND members.memberable_type = 'profiles'
                )

                OR profiles.updated_at > '2025-10-05'
        )
;
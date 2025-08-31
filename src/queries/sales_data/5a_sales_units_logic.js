const { query_is_allowable_logic } = require('./10_is_allowable_logic');
// const { query_is_allowable_logic_modified } = require('./10_is_allowable_logic_modified')
// -- ${query_is_allowable_logic} // original line 57
// ${query_is_allowable_logic_modified}

function query_sales_units_logic(year, start_date, end_date, membership_category_logic, operator, membership_periods_ends) {
    return `
        SELECT 
            members.member_number AS member_number_members,
            MAX(membership_periods.id) as max_membership_period_id,
            max_membership_fee_6_rule, -- todo: rule additional field
            -- todo: changed to real membership from prior table vs using case
            mc.real_membership_types,
            -- CASE
            --     WHEN membership_periods.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117) THEN 'adult_annual'
            --     WHEN membership_periods.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
            --     WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
            --     WHEN membership_periods.membership_type_id IN (56, 58, 81, 105) THEN 'club'
            --     WHEN membership_periods.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
            --     ELSE "other"
            -- END AS real_membership_types,
            
            mc.max_membership_fee_6 AS max_membership_fee_6,
            mc.new_member_category_6,
            mc.source_2, -- todo:
            mc.is_koz_acception, -- todo:

            DATE(membership_periods.created_at) AS created_at_membership_periods,

            YEAR(membership_periods.purchased_on) as purchased_on_year_membership_periods,

            membership_periods.starts AS starts,
            membership_periods.ends AS ends,
            membership_periods.membership_type_id AS membership_type_id_membership_periods,
            events.sanctioning_event_id AS sanctioning_event_id,
            membership_periods.origin_flag AS origin_flag_membership_periods,
            membership_applications.payment_type AS payment_type,
            membership_applications.race_type_id AS race_type_id,
            membership_applications.distance_type_id AS distance_type_id,
            order_products.order_id AS order_id,
            membership_applications.confirmation_code AS confirmation_code,
            membership_periods.membership_type_id
            
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
            
            LEFT JOIN new_member_category_6 AS mc ON membership_periods.id = mc.id_membership_periods   
        WHERE 1 = 1
            AND membership_periods.deleted_at IS NULL

            -- year(membership_periods.purchased_on) ${operator} ${year}
            AND membership_periods.purchased_on >= '${start_date}'
            AND membership_periods.purchased_on <= '${end_date}'
                     
            ${query_is_allowable_logic}
            ${membership_category_logic}

            AND membership_periods.id NOT IN (4652554) 
            -- AND membership_periods.id IN (4242825, 4242826, 4242827, 4242828, 4242832)

            AND membership_periods.membership_type_id NOT IN (56, 58, 81, 105) 

            AND membership_periods.membership_type_id > 0

            AND membership_periods.terminated_on IS NULL

            AND membership_periods.ends >= '${membership_periods_ends}'
            
        GROUP BY 
            members.member_number,
            Date(membership_periods.created_at),
            membership_periods.starts,
            membership_periods.ends,
            membership_periods.membership_type_id ,
            events.sanctioning_event_id,
            membership_periods.origin_flag ,
            membership_applications.payment_type ,
            membership_applications.race_type_id ,
            membership_applications.distance_type_id ,
            order_products.order_id ,
            membership_applications.confirmation_code,
            membership_periods.membership_type_id,
            CASE
                WHEN membership_periods.membership_type_id IN (1, 2, 3, 52, 55, 60, 62, 64, 65, 66, 67, 68, 70, 71, 73, 74, 75, 85, 89, 91, 93, 96, 98, 99, 101, 103, 104, 112, 113, 114, 117) THEN 'adult_annual'
                WHEN membership_periods.membership_type_id IN (4, 51, 54, 61, 94, 107) THEN 'youth_annual'
                WHEN membership_periods.membership_type_id IN (5, 46, 47, 72, 97, 100, 115, 118) THEN 'one_day'
                WHEN membership_periods.membership_type_id IN (56, 58, 81, 105) THEN 'club'
                WHEN membership_periods.membership_type_id IN (83, 84, 86, 87, 88, 90, 102) THEN 'elite'
                ELSE "other"
            END
        -- LIMIT 10
    `;
}

module.exports = { query_sales_units_logic };
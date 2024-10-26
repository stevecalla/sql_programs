// modification was to remove the rule membership_periods.created_at <= '2021-12-16 06:25:14'...
// ... at the bottom of this file

const query_is_allowable_logic_modified = 
`
    AND 
    (CASE
        WHEN 
            -- 'Source' = 'Membership System/RTAV Classic' 
            CASE
                WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                WHEN membership_types.name IS NOT NULL THEN 'Other'
                -- ELSE 'null' -- Optional, for cases where none of the conditions are met
            END = 'Membership System/RTAV Classic'
        --     AND 'Deleted' IS NULL 
            AND CASE
                    WHEN members.deleted_at IS NOT NULL OR 
                        membership_periods.deleted_at IS NOT NULL OR 
                        profiles.deleted_at IS NOT NULL OR 
                        users.deleted_at IS NOT NULL THEN 'deleted'
                    ELSE 'active'  -- You can use 'active' or another label based on your preference
                END = 'active'
        --     AND 'Captured and Processed' = 'C&P'           
            AND CASE
                    WHEN transactions.captured = 1 AND transactions.processed = 1 THEN 'C&P'
                    ELSE 'Other'  -- You can use 'Other' or another label based on your preference
                END = 'C&P'
        --     AND 'Deleted At (Order Products)' IS NULL  
            AND order_products.deleted_at IS NULL
        --     AND 'Purchasable Processed At' IS NOT NULL 
            AND order_products.purchasable_processed_at IS NOT NULL
        --     AND 'Purchasable Type' = 'membership-application'
            AND order_products.purchasable_type IN ('membership-application')
        THEN 'Allowable'

        WHEN 
            -- 'Source' = 'RTAV Batch'
            CASE
                WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                WHEN membership_types.name IS NOT NULL THEN 'Other'
                -- ELSE 'null' -- Optional, for cases where none of the conditions are met
            END = 'RTAV Batch'
            --     AND 'Deleted' IS NULL
            AND CASE
                    WHEN members.deleted_at IS NOT NULL OR 
                        membership_periods.deleted_at IS NOT NULL OR 
                        profiles.deleted_at IS NOT NULL OR 
                        users.deleted_at IS NOT NULL THEN 'deleted'
                    ELSE 'active'  -- You can use 'active' or another label based on your preference
                END = 'active'
        THEN 'Allowable'

        WHEN 
            -- 'Source' = 'Other' 
            CASE
                WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                WHEN membership_types.name IS NOT NULL THEN 'Other'
                -- ELSE 'null' -- Optional, for cases where none of the conditions are met
            END = 'Other'
        --     AND 'Deleted' IS NULL
            AND CASE
                    WHEN members.deleted_at IS NOT NULL OR 
                        membership_periods.deleted_at IS NOT NULL OR 
                        profiles.deleted_at IS NOT NULL OR 
                        users.deleted_at IS NOT NULL THEN 'deleted'
                    ELSE 'active'  -- You can use 'active' or another label based on your preference
                END = 'active'
        THEN 'Allowable'

        WHEN 
            -- 'Source' IS NULL
            CASE
                WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
                WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
                WHEN membership_types.name IS NOT NULL THEN 'Other'
                -- ELSE 'null' -- Optional, for cases where none of the conditions are met
            END IS NULL
            --     AND 'Deleted' IS NULL
            AND CASE
                    WHEN members.deleted_at IS NOT NULL OR 
                        membership_periods.deleted_at IS NOT NULL OR 
                        profiles.deleted_at IS NOT NULL OR 
                        users.deleted_at IS NOT NULL THEN 'deleted'
                    ELSE 'active'  -- You can use 'active' or another label based on your preference
                END = 'active'
        THEN 'Allowable'

        ELSE 'Not Allowable'
    END) = "Allowable"
   
`;

module.exports = { query_is_allowable_logic_modified };

// -- WHEN 'Created At (Membership Periods)' <= TIMESTAMP('2021-12-16 06:25:14') 
// WHEN membership_periods.created_at <= '2021-12-16 06:25:14'
//     -- AND Source = 'Membership System/RTAV Classic' 
//     AND CASE
//             WHEN order_products.cart_label IS NOT NULL THEN 'Membership System/RTAV Classic'
//             WHEN registration_audit_membership_application.price_paid IS NOT NULL THEN 'RTAV Batch'
//             WHEN membership_types.name IS NOT NULL THEN 'Other'
//             -- ELSE 'null' -- Optional, for cases where none of the conditions are met
//         END = 'Membership System/RTAV Classic'
//     -- AND Deleted IS NULL 
//     AND CASE
//             WHEN 
//                 members.deleted_at IS NOT NULL OR 
//                 membership_periods.deleted_at IS NOT NULL OR 
//                 profiles.deleted_at IS NOT NULL OR 
//                 users.deleted_at IS NOT NULL THEN 'deleted'
//             ELSE 'active'  -- You can use 'active' or another label based on your preference
//         END = 'active'
//     -- AND 'Captured and Processed' = 'C&P'            
//     AND CASE
//             WHEN transactions.captured = 1 AND transactions.processed = 1 THEN 'C&P'
//             ELSE 'Other'  -- You can use 'Other' or another label based on your preference
//         END = 'C&P'
//     -- AND 'Deleted At (Order Products)' IS NULL 
//     AND order_products.deleted_at IS NULL
//     -- AND 'Purchasable Type' = 'membership-application' 
//     AND order_products.purchasable_type IN ('membership-application')
// THEN 'Allowable'
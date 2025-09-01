// SOURCE?
// C:\Users\calla\development\usat\sql_code\6_create_key_stats\key_stats_query_cte_create_table_100524.sql

async function step_7_prior_purchase_query(FROM_STATEMENT, where_statement = '', ORDER_BY_STATEMENT = '') {

  // console.log(FROM_STATEMENT, where_statement, ORDER_BY_STATEMENT);

  return `
    SELECT
      am.id_profiles,
      am.id_membership_periods_sa,
      am.new_member_category_6_sa,
      am.purchased_on_adjusted_mp AS most_recent_purchase_date,
      am.ends_mp                  AS most_recent_mp_ends_date,

      -- Prior by purchase date
      LAG(am.purchased_on_adjusted_mp)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_date,

      -- Prior by ends date
      LAG(am.ends_mp)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.ends_mp)                         AS most_recent_prior_mp_ends_date,

      -- Prior membership type/category (based on purchase date ordering)
      LAG(am.real_membership_types_sa)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_membership_type,

      LAG(am.new_member_category_6_sa)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_membership_category

    -- FROM all_membership_sales_data_2015_left am
    ${FROM_STATEMENT} AS am
    ${where_statement}
    -- WHERE am.member_number_members_sa IN ('1001416','100181772','100142051','100853852')
    ${ORDER_BY_STATEMENT}
    -- LIMIT 100;
    -- *********************************************
  `;
}

async function step_7_prior_purchase_query_v2(FROM_STATEMENT, WHERE_STATEMENT = '', ORDER_BY_STATEMENT = '') {
  return `
    -- step_7_prior_purchase
    SELECT
      am.id_profiles,
      am.id_membership_periods_sa,
      am.new_member_category_6_sa,
      am.purchased_on_adjusted_mp AS most_recent_purchase_date,
      am.ends_mp                  AS most_recent_mp_ends_date,

      -- Prior by purchase date
      LAG(am.purchased_on_adjusted_mp)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_date,

      -- Prior by ends date
      LAG(am.ends_mp)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.ends_mp)                         AS most_recent_prior_mp_ends_date,

      -- Prior membership type/category (based on purchase date ordering)
      LAG(am.real_membership_types_sa)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_membership_type,

      LAG(am.new_member_category_6_sa)
        OVER (PARTITION BY am.member_number_members_sa
              ORDER BY am.purchased_on_adjusted_mp)        AS most_recent_prior_purchase_membership_category

    -- FROM all_membership_sales_data_2015_left am
    ${FROM_STATEMENT} AS am
    ${WHERE_STATEMENT}
    -- WHERE am.member_number_members_sa IN ('1001416','100181772','100142051','100853852')
    ${ORDER_BY_STATEMENT}
    -- LIMIT 100
    ;
  `;
}

module.exports = {
  step_7_prior_purchase_query,
  step_7_prior_purchase_query_v2,
}
const { query_source_2_logic } = require('./1_source_2_logic');
const { query_koz_acception_logic } = require('./2_koz_acception_logic');
const { query_actual_membership_fee_6_logic } = require('./3_actual_membership_fee_6_logic');
const { query_new_member_category_6_logic } = require('./4_new_member_category_6_logic');
const { query_all_fields_logic } = require('./6_all_fields_logic');

const { query_sales_units_logic } = require('./5a_sales_units_logic');

// const year = 2019;
// const membership_period_ends = '2019-01-01';

// const year = 2021; // todo:
// const membership_period_ends = '2022-01-01'; // todo:

const operator = '=';
// const operator = '>=';

// const query_get_sales_data = 
function query_get_sales_data(query_membership_category_logic, year, membership_period_ends) {
   return `
      -- STEP #1 - CREATE SOURCE 2
      WITH source_2_type AS (
         ${query_source_2_logic(year, operator)} -- TODO: SET YEAR, SET OPERATOR
      ),

      -- STEP #2 - CREATE KOZ ACCEPTION
      koz_acception AS (
         ${query_koz_acception_logic}
      ),

      -- STEP #3 - Actual Membership Fee 6
      actual_membership_fee_6 AS (
         ${query_actual_membership_fee_6_logic}
      ),

      -- STEP #4 - new_member_category_6
      new_member_category_6 AS (
         ${query_new_member_category_6_logic}
      ),

      -- STEP #5 - ONE DAY SALES ACTUAL MEMBER FEE
      one_day_sales_actual_member_fee AS (
         ${query_sales_units_logic(year, query_membership_category_logic, operator, membership_period_ends)} -- TODO: SET YEAR, SET MEMBERSHIP LOGIC, SET OPERATOR
      ),

      -- SELECT COUNT(*) FROM one_day_sales_actual_member_fee

      -- STEP #6: APPEND ALL DATA FIELDS
      append_all_fields AS (
         ${query_all_fields_logic}
      )
            
      SELECT * FROM append_all_fields
      -- SELECT * FROM append_all_fields LIMIT 1

      -- SELECT * FROM append_all_fields LIMIT 10

      -- GET COUNT BY YEAR
      -- SELECT
      --     purchased_on_year_mp,
      --     FORMAT(COUNT(*), 0) AS total_count,
      --     FORMAT(SUM(actual_membership_fee_6_sa), 0) AS total_revenue
      -- FROM append_all_fields
      -- GROUP BY purchased_on_year_mp WITH ROLLUP
      -- ORDER BY purchased_on_year_mp

      ;
   `
;
}

module.exports = { query_get_sales_data };
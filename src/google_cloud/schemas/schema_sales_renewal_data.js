const sales_renewal_schema = [

  {
    name: "query_label",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "report_year",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "period_type",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "period_start",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "period_end",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "id_profiles",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "member_number_members_sa",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "original_id_membership_periods_sa",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "original_purchased_on_adjusted_mp",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "original_start",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "original_end",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "original_type",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "original_category",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "original_origin_flag_category",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "original_origin_flag_ma",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  // 365 WINDOW

  {
    name: "next_purchased_on_date_mp_365",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_id_membership_periods_sa_365",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "next_start_365",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_end_365",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_type_365",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_category_365",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_category_365",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_ma_365",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "renewed_flag_365",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "days_to_renew_365",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "renewal_timing_category_365",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  // JAN31 WINDOW

  {
    name: "next_purchased_on_date_mp_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_id_membership_periods_sa_jan31",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "next_start_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_end_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_type_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_category_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_category_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_ma_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "renewed_flag_jan31",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "days_to_renew_jan31",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "renewal_timing_category_jan31",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  // PRIMARY WINDOW

  {
    name: "next_purchased_on_date_mp",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_id_membership_periods_sa",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "next_start",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_end",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "next_type",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_category",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_category",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "next_origin_flag_ma",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "renewed_flag",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "days_to_renew",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "renewal_timing_category",
    mode: "NULLABLE",
    type: "STRING",
    description: null,
    fields: []
  },

  {
    name: "original_seq",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  // ATOMIC METRICS

  {
    name: "ended_row_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_renew_row_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_count",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_renew_rate",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_rate",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "did_renew_row_count_365",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_count_365",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_renew_rate_365",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_rate_365",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "did_renew_row_count_jan31",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_count_jan31",
    mode: "NULLABLE",
    type: "INTEGER",
    description: null,
    fields: []
  },

  {
    name: "did_renew_rate_jan31",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "did_not_renew_rate_jan31",
    mode: "NULLABLE",
    type: "FLOAT",
    description: null,
    fields: []
  },

  {
    name: "created_at_mtn",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  },

  {
    name: "created_at_utc",
    mode: "NULLABLE",
    type: "STRING",
    description: "YYYY-MM-DD HH:MM:SS (from DATE_FORMAT)",
    fields: []
  }

];

module.exports = {
  sales_renewal_schema
};

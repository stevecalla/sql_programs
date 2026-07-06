-- indexes.sql — reproduce production indexes on a dev copy of
-- all_participation_data_with_membership_match (usat_sales_db), plus composites tuned for the
-- reporting aggregation. Run against the dev database:
--     mysql usat_sales_db < src/reporting/store/indexes.sql
-- Re-running errors with "Duplicate key name" on indexes that already exist — safe to ignore.

-- ============================================================================
-- Production single-column indexes (copied from prod so dev matches prod)
-- ============================================================================
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_city_events` (`city_events`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_ends_mp` (`ends_mp`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_gender_code_rr` (`gender_code`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_id_membership_periods_sa` (`id_membership_periods_sa`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_id_race_rr` (`id_race_rr`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_id_sanctioning_events` (`id_sanctioning_events`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_name_distance_types` (`name_distance_types`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_name_event_type` (`name_event_type`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_name_events` (`name_events`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_name_race_type` (`name_race_type`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_new_member_category_6_sa` (`new_member_category_6_sa`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_purchased_on_date_adjusted_mp` (`purchased_on_date_adjusted_mp`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_purchased_on_month_adjusted_mp` (`purchased_on_month_adjusted_mp`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_purchased_on_year_adjusted_mp` (`purchased_on_year_adjusted_mp`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_real_membership_types_sa` (`real_membership_types_sa`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_region_abbr` (`region_abbr`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_region_code` (`region_code`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_region_name` (`region_name`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_start_date_races` (`start_date_races`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_start_date_year_races` (`start_date_year_races`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_starts_mp` (`starts_mp`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_state_code` (`state_code`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_state_code_events` (`state_code_events`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_state_name` (`state_name`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_zip_events` (`zip_events`);

-- ============================================================================
-- Composites tuned for the reporting query (not in prod). The annual aggregate
-- filters on state_code_events and GROUPs BY (start_date_year_races, state_code_events);
-- the home/away split + flows read member_state_code_addresses. These make the group
-- an index-ordered scan instead of a full table scan.
-- ============================================================================
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_rpt_yr_evstate` (`start_date_year_races`, `state_code_events`);
ALTER TABLE all_participation_data_with_membership_match ADD KEY `idx_rpt_evstate_yr_home` (`state_code_events`, `start_date_year_races`, `member_state_code_addresses`);

-- Refresh optimizer statistics after adding indexes.
ANALYZE TABLE all_participation_data_with_membership_match;

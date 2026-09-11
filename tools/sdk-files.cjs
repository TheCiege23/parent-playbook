// Explicit release allowlist. Never traverse the repository to collect SDK files.
const SDK_FILES = Object.freeze([
  'body-section-worker.js','mesh-section.js','surface-section.js','body-surface-report.mjs','body-surface-repeat.mjs','body-sdk-report.mjs','body-sdk-record.mjs','body-sdk-supabase.mjs','body-sdk-reference-import.mjs','body-sdk-reference-supabase.mjs','body-sdk-reference-history.mjs','body-composition-contract.mjs','body-composition-validation.mjs','body-composition-record.mjs','body-composition-supabase.mjs','reference-cohort.mjs',
  'body-sdk.mjs','body-sdk-worker.js','body-sdk-surface.mjs','surface-review.mjs',
  'surface-worker.js','visual-hull.js','device-evidence.js','body-outputs.js','photo-identity.js',
  'photo-quality.js','pose-measure.js','photo-import.mjs','photo-import-worker.js','heic-decode.js',
]);
// The buyer handover package. An acquirer must be able to stand the database up from this alone,
// so the FULL migration set ships, in order. Shipping only the three company_* migrations was a
// defect: they reference public.teams, public.athletes, auth.users and six private.* helpers that
// earlier migrations create, and all three failed on a fresh database. Verified empirically on
// 2026-09-10 with `node tests/db/run.cjs --migrations-from <bundle>/supabase/migrations`.
const BUNDLE_MIGRATIONS = Object.freeze([
  'supabase/migrations/20260730143035_identity_and_access.sql','supabase/migrations/20260730143152_sports_and_athlete_data.sql',
  'supabase/migrations/20260730143302_teams_schedule_consent.sql','supabase/migrations/20260730143332_seed_football.sql',
  'supabase/migrations/20260730144508_harden_helper_functions.sql','supabase/migrations/20260731121405_athlete_invites_and_accept.sql',
  'supabase/migrations/20260731190502_athlete_journey_diary_tables.sql','supabase/migrations/20260731190552_athlete_media_storage_bucket.sql',
  'supabase/migrations/20260806143444_create_athlete_onboarding_fn.sql','supabase/migrations/20260806151518_rls_initplan_wrap_auth_uid.sql',
  'supabase/migrations/20260806151527_covering_indexes_on_foreign_keys.sql','supabase/migrations/20260806155000_create_app_admins_table.sql',
  'supabase/migrations/20260806160436_trainer_marketplace_enums_tables.sql','supabase/migrations/20260806160447_trainer_marketplace_helpers.sql',
  'supabase/migrations/20260806160517_trainer_marketplace_rls_policies.sql','supabase/migrations/20260806161316_trainer_onboarding_support.sql',
  'supabase/migrations/20260806161319_trainer_verification_docs_bucket.sql','supabase/migrations/20260806162827_bookings_child_shared_snapshot.sql',
  'supabase/migrations/20260806173442_push_and_payment_columns.sql','supabase/migrations/20260807040409_athlete_sports_parent_experience.sql',
  'supabase/migrations/20260812024312_add_practice_schedule_to_athlete_sports.sql','supabase/migrations/20260812030407_create_drills_library.sql',
  'supabase/migrations/20260812031355_create_sessions_completion_log.sql','supabase/migrations/20260812042940_add_season_window_and_schedule_exceptions.sql',
  'supabase/migrations/20260812111739_goal_and_level_targeting_plus_review_note.sql','supabase/migrations/20260812132629_b1_screening_enforcement.sql',
  'supabase/migrations/20260812134314_d1_published_drills_must_be_cited.sql','supabase/migrations/20260812142951_harden_guard_function_search_path.sql',
  'supabase/migrations/20260812162009_order_metrics_growth_first.sql','supabase/migrations/20260812164446_drill_step_images.sql',
  'supabase/migrations/20260812172050_team_join_codes.sql','supabase/migrations/20260812172846_football_pop_warner_levels.sql',
  'supabase/migrations/20260812174514_enable_cron_and_net.sql','supabase/migrations/20260812180602_schedule_weekly_push.sql',
  'supabase/migrations/20260813134712_add_season_state_to_athlete_sports.sql','supabase/migrations/20260813134719_add_sport_key_to_games.sql',
  'supabase/migrations/20260813144533_notification_prefs.sql','supabase/migrations/20260813150811_schedule_gameday_push.sql',
  'supabase/migrations/20260813152818_anon_read_reference_catalogue.sql','supabase/migrations/20260813163622_invite_preview_age_and_sport_v2.sql',
  'supabase/migrations/20260813171023_notification_log_and_cap.sql','supabase/migrations/20260813184739_athlete_owner_first_name.sql',
  'supabase/migrations/20260813192024_games_note_improve.sql','supabase/migrations/20260813192921_lock_down_definer_functions.sql',
  'supabase/migrations/20260813192936_accept_invite_authenticated_only.sql','supabase/migrations/20260813194052_drill_bucket_video_and_log_policy.sql',
  'supabase/migrations/20260813194111_week_plan_days.sql','supabase/migrations/20260813214236_clear_self_downgrade_access.sql',
  'supabase/migrations/20260904194434_growth_maturity_inputs.sql','supabase/migrations/20260905051625_guardian_birthdate_for_scan.sql',
  'supabase/migrations/20260905144851_biometric_consent_and_body_metrics.sql','supabase/migrations/20260905145010_invite_sms_and_confirmation_code.sql',
  'supabase/migrations/20260905152802_biometric_retention_sweep.sql','supabase/migrations/20260908120812_add_pw_ball_carrier_limit.sql',
  'supabase/migrations/20260908131247_add_video_measure_source.sql','supabase/migrations/20260908131402_extend_biometric_retention_sweep_to_video.sql',
  'supabase/migrations/20260908131450_fix_video_retention_correct_schema.sql','supabase/migrations/20260908152406_add_coach_access_role.sql',
  'supabase/migrations/20260908152418_scope_can_view_athlete_away_from_coach.sql','supabase/migrations/20260908152442_create_coach_updates.sql',
  'supabase/migrations/20260908152451_create_camps_directory.sql','supabase/migrations/20260908162547_create_usage_events.sql',
  'supabase/migrations/20260908164433_add_external_sync_columns_to_athlete_sports.sql','supabase/migrations/20260908170649_add_coach_update_moderation.sql',
  'supabase/migrations/20260908170754_add_coach_update_admin_review.sql','supabase/migrations/20260908174609_add_org_roster_access.sql',
  'supabase/migrations/20260908181318_fix_aa_select_org_security_definer.sql','supabase/migrations/20260908181446_add_teams_join_code_uniqueness.sql',
  'supabase/migrations/20260908193041_add_premium_subscriptions.sql','supabase/migrations/20260909120000_allow_org_admin_membership_reads.sql',
  'supabase/migrations/20260909193000_add_sitting_height_metric.sql','supabase/migrations/20260910001500_company_body_assessments.sql',
  'supabase/migrations/20260910010000_fix_company_body_policy_function_access.sql','supabase/migrations/20260910011500_fix_company_body_forbidden_key_tokens.sql',
  'supabase/migrations/20260910014500_company_body_active_consent_rpc.sql','supabase/migrations/20260910033000_company_adult_reference_assessments.sql',
  'supabase/migrations/20260910190000_company_composition_results.sql','supabase/migrations/20260910200000_least_privilege_public_table_grants.sql',
  'supabase/migrations/20260910210000_capture_rls_auto_enable_event_trigger.sql',
  'supabase/migrations/20260911160000_push_subscription_claim.sql',
  'supabase/migrations/20260911160500_service_value_constraints.sql',
]);

// Tooling the acquirer needs to verify what they were handed, not just run it.
// Contract suites that run against the shipped modules alone. A buyer can execute the
// contracts rather than read them. Membership here is checked by running them inside an
// extracted package: a suite that needs an unshipped file must not be listed, because a
// missing test file is silently reported as success by `node --test`.
const BUNDLE_CONTRACT_TESTS = Object.freeze([
  'tests/body-composition-contract.test.cjs',
  'tests/body-sdk-surface.test.cjs',
  'tests/body-sdk.test.cjs',
  'tests/body-surface-repeat.test.cjs',
  'tests/composition-authorization-races.test.cjs',
  'tests/heic-import.test.cjs',
  'tests/photo-identity.test.cjs',
  'tests/sdk-company-record.test.cjs',
  'tests/sdk-demo.test.cjs',
  'tests/sdk-measurement-report.test.cjs',
  'tests/sdk-reference-history.test.cjs',
  'tests/sdk-reference-import.test.cjs',
  'tests/sdk-reference-supabase.test.cjs',
  'tests/sdk-section.test.cjs',
  'tests/sdk-supabase-adapter.test.cjs',
  'tests/surface-location-report.test.cjs',
  'tests/surface-review.test.cjs',
]);

const BUNDLE_VERIFICATION = Object.freeze([
  'tools/sdk-files.cjs','tools/sdk-verify.cjs',
  'tools/sdk-sign.cjs','tools/sdk-host.cjs','tools/package-scan.cjs','tools/acceptance.cjs','tools/schema-parity.cjs','tools/operations-check.cjs',
  'tests/db/run.cjs','tests/db/replay.cjs','tests/db/inventory.sql','tests/db/posture.sql',
  'tests/db/00-preamble.sql','tests/db/05-post-identity-seed.sql','tests/db/10-fixtures.sql',
  'tests/db/security-tests.cjs','tests/db/restore-deletion.cjs','tests/db/README.md',
]);

const BUNDLE_FILES = Object.freeze([
  ...SDK_FILES.map(name=>'js/'+name),
  'tools/sdk-demo.cjs','tools/sdk-demo.html','tools/sdk-demo.mjs','company-persistence-demo.html','tools/company-persistence-demo.mjs',
  ...BUNDLE_VERIFICATION,
  ...BUNDLE_CONTRACT_TESTS,
  ...BUNDLE_MIGRATIONS,
  'HANDOVER.md','REFERENCE-COHORTS.md','BODY-SDK.md','HEIC-IMPORT.md','README.md',
]);
module.exports={SDK_FILES,BUNDLE_FILES,BUNDLE_MIGRATIONS,BUNDLE_VERIFICATION,BUNDLE_CONTRACT_TESTS};

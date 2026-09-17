-- Stage 0a — take the privileged RPC surface away from the anonymous key.
--
-- NOT APPLIED. Prepared for a separate, immediate approval decision.
-- Target: Supabase project hviqoaokxvlancmftwuo (the project every app defaults
-- to). Read-only catalogue verification performed 2026-09-18; no function below
-- was called, and no row was read or modified to produce this file.
--
-- WHAT THIS IS
-- `public` is exposed through PostgREST, so every function the `anon` role may
-- execute is an HTTP endpoint at /rest/v1/rpc/<name>, callable with the key that
-- is published in the website JavaScript. 150 of those functions are
-- SECURITY DEFINER: they run as their owner (postgres) and row-level security
-- does not apply to them, whatever stages 1–4 do to the tables.
--
-- The grant is explicit, not a PostgreSQL default: 148 of the 150 carry
-- `anon=X/postgres` in their ACL, i.e. someone granted them deliberately
-- (`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon` has this effect).
-- The remaining two, block_customer and unblock_customer, are reachable through
-- a PUBLIC grant instead, so each statement below revokes from both grantees.
--
-- The clearest case is public.exec_sql(query text): SECURITY DEFINER, owned by
-- postgres, no search_path, body `EXECUTE query`. With the published key that is
-- arbitrary SQL as the owner — read, write, schema change, grant. It makes every
-- other finding in docs/trax/db-isolation-remediation.md secondary.
-- The repository already knew: docs/CRON_SIMULATION_TESTING_DESIGN.md lists
-- "drop exec_sql" as footgun cleanup.
--
-- WHAT THIS IS NOT
-- It does not enable row-level security, does not remove any table privilege,
-- and does not close the anonymous read, insert or update paths. Those are
-- stages 0b, 1, 3 and 4. It removes one class of privilege escalation.
--
-- EVIDENCE THAT NOTHING LEGITIMATE DEPENDS ON THIS
--  * Every .rpc() call in apps/ and supabase/ was listed. The anonymous booking
--    path calls exactly two: generate_first_charge_for_rental and
--    backfill_rental_charges_first_month_only. Neither is SECURITY DEFINER, so
--    neither appears below.
--  * Portal and admin RPC calls (block_customer, approve_payment, dispose_vehicle,
--    cancel_installment_plan, …) run in a signed-in staff session as
--    `authenticated`. This file does not touch the authenticated grant.
--  * exec_sql is called only by supabase/functions/simulate-payg-timelapse, and
--    admin_revoke_user_sessions only by supabase/functions/admin-force-logout.
--    Edge functions use the service role, which keeps its grant.
--  * app_login is called by no application code; the grant comes from
--    supabase/migrations/20251219083413_remote_schema.sql:8462.
--
-- ROLLBACK: docs/trax/remediation/06-rollback-function-revokes.sql (restores the
-- grants exactly). Read §5 of db-isolation-remediation.md before using it: it
-- restores the exposure, so it is for isolated testing, not a resting state.

begin;

-- ── Group A: revoke now — 147 functions, no known anonymous caller ──

-- The one that matters most, first.
revoke execute on function public.exec_sql(query text) from anon;
revoke execute on function public.exec_sql(query text) from public;

revoke execute on function public.admin_revoke_user_sessions(p_user_ids text[]) from anon, public;
revoke execute on function public.app_login(p_username text, p_password text) from anon, public;
revoke execute on function public.apply_payment(payment_id uuid) from anon, public;
revoke execute on function public.apply_payment_fully(p_payment_id uuid) from anon, public;
revoke execute on function public.approve_booking_payment(p_payment_id uuid, p_approved_by uuid) from anon, public;
revoke execute on function public.approve_payment(p_payment_id uuid, p_approved_by uuid) from anon, public;
revoke execute on function public.auto_resolve_credits_test_requests() from anon, public;
revoke execute on function public.auto_resolve_go_live_requests() from anon, public;
revoke execute on function public.backfill_payment_rental_ids() from anon, public;
revoke execute on function public.block_customer(p_customer_id uuid, p_reason text, p_blocked_by uuid) from anon, public;
revoke execute on function public.calculate_vehicle_book_cost(p_vehicle_id uuid) from anon, public;
revoke execute on function public.cancel_installment_plan(p_plan_id uuid, p_reason text) from anon, public;
revoke execute on function public.check_and_update_global_blacklist(p_email text) from anon, public;
revoke execute on function public.check_policy_overlap(p_customer_id uuid, p_vehicle_id uuid, p_start_date date, p_expiry_date date, p_policy_id uuid) from anon, public;
revoke execute on function public.classify_audit_log_activity_source() from anon, public;
revoke execute on function public.create_chat_channel_for_customer() from anon, public;
revoke execute on function public.create_installment_plan(p_rental_id uuid, p_tenant_id uuid, p_customer_id uuid, p_plan_type text, p_total_installable_amount numeric, p_upfront_amount numeric, p_number_of_installments integer, p_start_date date, p_stripe_customer_id text, p_stripe_payment_method_id text) from anon, public;
revoke execute on function public.create_installment_plan(p_rental_id uuid, p_tenant_id uuid, p_customer_id uuid, p_plan_type text, p_total_installable_amount numeric, p_number_of_installments integer, p_upfront_amount numeric, p_stripe_customer_id text, p_start_date date) from anon, public;
revoke execute on function public.create_rental_charges() from anon, public;
revoke execute on function public.create_vehicle_pl() from anon, public;
revoke execute on function public.dispose_vehicle(p_vehicle_id uuid, p_disposal_date date, p_sale_proceeds numeric, p_buyer text, p_notes text) from anon, public;
revoke execute on function public.enforce_payment_target_categories() from anon, public;
revoke execute on function public.enqueue_financial_event(p_tenant_id uuid, p_event_type financial_event_type, p_amount_cents integer, p_currency text, p_rental_id uuid, p_customer_id uuid, p_vehicle_id uuid, p_tax_cents integer, p_occurred_at timestamp with time zone, p_source_table text, p_source_id uuid, p_description text, p_metadata jsonb) from anon, public;
revoke execute on function public.enqueue_financial_event_for_ledger_entry() from anon, public;
revoke execute on function public.ensure_lead_conversation() from anon, public;
revoke execute on function public.evaluate_tenant_health(p_trigger text, p_force boolean, p_evaluated_at timestamp with time zone) from anon, public;
revoke execute on function public.expire_subscription_link_session() from anon, public;
revoke execute on function public.finalize_rental_extension(p_extension_id uuid, p_payment_id uuid) from anon, public;
revoke execute on function public.fine_void_charge(f_id uuid) from anon, public;
revoke execute on function public.generate_daily_reminders() from anon, public;
revoke execute on function public.generate_monthly_charges(rental_id uuid) from anon, public;
revoke execute on function public.generate_next_invoice_number() from anon, public;
revoke execute on function public.get_chat_history(p_tenant_id uuid, p_conversation_id uuid, p_limit integer) from anon, public;
revoke execute on function public.get_current_user_role() from anon, public;
revoke execute on function public.get_customer_balance_with_status(customer_id_param uuid) from anon, public;
revoke execute on function public.get_customer_credit(customer_id_param uuid) from anon, public;
revoke execute on function public.get_customer_net_position(customer_id_param uuid) from anon, public;
revoke execute on function public.get_customer_rag_context(p_tenant_id uuid, p_customer_id uuid) from anon, public;
revoke execute on function public.get_customer_rag_context(p_customer_id uuid) from anon, public;
revoke execute on function public.get_customer_statement(p_customer_id uuid, p_from_date date, p_to_date date) from anon, public;
revoke execute on function public.get_due_installments(p_process_date date) from anon, public;
revoke execute on function public.get_effective_tenant_id() from anon, public;
revoke execute on function public.get_expiring_bookings() from anon, public;
revoke execute on function public.get_health_score_dashboard(p_history_days integer) from anon, public;
revoke execute on function public.get_installment_plan_summary(p_rental_id uuid) from anon, public;
revoke execute on function public.get_installments_for_reminder() from anon, public;
revoke execute on function public.get_installments_for_retry(p_process_date date) from anon, public;
revoke execute on function public.get_payment_remaining(payment_id_param uuid) from anon, public;
revoke execute on function public.get_pending_bookings_count() from anon, public;
revoke execute on function public.get_pending_charges_for_reminders() from anon, public;
revoke execute on function public.get_pending_payments_count() from anon, public;
revoke execute on function public.get_pending_rental_requests(p_tenant_id uuid) from anon, public;
revoke execute on function public.get_rag_metrics(p_tenant_id uuid) from anon, public;
revoke execute on function public.get_refunds_due_today() from anon, public;
revoke execute on function public.get_rental_credit(rental_id_param uuid) from anon, public;
revoke execute on function public.get_rental_insurance_documents(p_rental_id uuid) from anon, public;
revoke execute on function public.get_tenant_health_activity(p_tenant_id uuid, p_period_days integer, p_anchor timestamp with time zone) from anon, public;
revoke execute on function public.get_user_role(user_id uuid) from anon, public;
revoke execute on function public.get_user_tenant_id() from anon, public;
revoke execute on function public.guard_custom_site_toggle() from anon, public;
revoke execute on function public.handle_vehicle_expense_pnl() from anon, public;
revoke execute on function public.handover_stamp_vehicle() from anon, public;
revoke execute on function public.handover_to_odometer_reading() from anon, public;
revoke execute on function public.has_any_role(_user_id uuid, _roles text[]) from anon, public;
revoke execute on function public.has_role(_user_id uuid, _role text) from anon, public;
revoke execute on function public.hash_password(password text) from anon, public;
revoke execute on function public.increment_payg_reminder_count(p_rental_id uuid, p_last_sent_at timestamp with time zone) from anon, public;
revoke execute on function public.initialize_tenant_wallet() from anon, public;
revoke execute on function public.installment_settle_invoice(p_payment_id uuid, p_installment_id uuid) from anon, public;
revoke execute on function public.is_bonzah_partner() from anon, public;
revoke execute on function public.is_current_user_admin() from anon, public;
revoke execute on function public.is_global_master_admin() from anon, public;
revoke execute on function public.is_globally_blacklisted(p_email text) from anon, public;
revoke execute on function public.is_identity_blocked(p_identity_number text) from anon, public;
revoke execute on function public.is_identity_blocked_for_tenant(p_tenant_id uuid, p_identity_number text) from anon, public;
revoke execute on function public.is_portal_staff() from anon, public;
revoke execute on function public.is_portal_user() from anon, public;
revoke execute on function public.is_primary_super_admin() from anon, public;
revoke execute on function public.is_sales_agent() from anon, public;
revoke execute on function public.is_super_admin() from anon, public;
revoke execute on function public.knowledge_articles_rag_sync() from anon, public;
revoke execute on function public.landing_pricing_enabled() from anon, public;
revoke execute on function public.log_service_record_event() from anon, public;
revoke execute on function public.mark_installment_failed(p_installment_id uuid, p_failure_reason text, p_stripe_payment_intent_id text) from anon, public;
revoke execute on function public.mark_installment_paid(p_installment_id uuid, p_payment_id uuid, p_ledger_entry_id uuid, p_stripe_payment_intent_id text, p_stripe_charge_id text) from anon, public;
revoke execute on function public.mark_overdue_installments() from anon, public;
revoke execute on function public.match_documents(p_tenant_id uuid, query_embedding vector, match_threshold double precision, match_count integer, filter_tables text[]) from anon, public;
revoke execute on function public.notify_automation_event(p_event_type text, p_tenant_id uuid, p_entity_type text, p_entity_id uuid, p_payload jsonb) from anon, public;
revoke execute on function public.notify_customer_rental_status_change() from anon, public;
revoke execute on function public.notify_fine_new() from anon, public;
revoke execute on function public.notify_identity_verified() from anon, public;
revoke execute on function public.notify_new_chat_message() from anon, public;
revoke execute on function public.notify_new_rental() from anon, public;
revoke execute on function public.notify_operator_email_dispatch() from anon, public;
revoke execute on function public.notify_payment_received() from anon, public;
revoke execute on function public.notify_platform_activity() from anon, public;
revoke execute on function public.notify_refund_processed() from anon, public;
revoke execute on function public.notify_signing_completed() from anon, public;
revoke execute on function public.notify_subscription_of_invoice_change() from anon, public;
revoke execute on function public.payg_settle_invoice(p_payment_id uuid, p_accrual_id uuid) from anon, public;
revoke execute on function public.preview_tenant_health_settings(p_period_days integer, p_threshold_percent integer, p_minimum_baseline_events integer, p_new_tenant_grace_days integer, p_include_test_tenants boolean, p_evaluated_at timestamp with time zone) from anon, public;
revoke execute on function public.process_payment_transaction(p_payment_id uuid, p_customer_id uuid, p_rental_id uuid, p_vehicle_id uuid, p_amount numeric, p_payment_type text, p_payment_date date) from anon, public;
revoke execute on function public.queue_for_rag() from anon, public;
revoke execute on function public.recalculate_insurance_status() from anon, public;
revoke execute on function public.recalculate_vehicle_pl(p_vehicle_id uuid) from anon, public;
revoke execute on function public.reclassify_expense_pnl(p_tenant_id uuid, p_category text, p_bucket text) from anon, public;
revoke execute on function public.record_installment_notification(p_installment_id uuid, p_notification_type text, p_sent_at timestamp with time zone) from anon, public;
revoke execute on function public.reject_booking_payment(p_payment_id uuid, p_rejected_by uuid, p_reason text) from anon, public;
revoke execute on function public.reject_payment(p_payment_id uuid, p_rejected_by uuid, p_reason text) from anon, public;
revoke execute on function public.release_rental_sync_lock(p_tenant_id uuid, p_rental_id uuid, p_provider text, p_worker_id text) from anon, public;
revoke execute on function public.reset_lockbox_sent_on_reschedule() from anon, public;
revoke execute on function public.seed_cms_pages_for_tenant() from anon, public;
revoke execute on function public.seed_default_lead_templates(p_tenant_id uuid) from anon, public;
revoke execute on function public.session_is_active(p_session_id text, p_user_id text) from anon, public;
revoke execute on function public.swap_rental_vehicle(p_rental_id uuid, p_new_vehicle_id uuid, p_reason text, p_block_old_start date, p_block_old_end date) from anon, public;
revoke execute on function public.sync_verified_name_to_customer() from anon, public;
revoke execute on function public.touch_feedback_prompted_at() from anon, public;
revoke execute on function public.trax_price_suggest(p_vehicle_id uuid, p_tier text, p_make text, p_model text, p_year integer) from anon, public;
revoke execute on function public.trigger_apply_fifo_on_payment_completed() from anon, public;
revoke execute on function public.trigger_apply_fifo_on_payment_insert() from anon, public;
revoke execute on function public.trigger_auto_allocate_payments() from anon, public;
revoke execute on function public.trigger_create_fine_charge() from anon, public;
revoke execute on function public.trigger_generate_rental_charges() from anon, public;
revoke execute on function public.trigger_payg_settle_on_ledger_drain() from anon, public;
revoke execute on function public.trigger_post_acquisition() from anon, public;
revoke execute on function public.trigger_settle_ghost_paid_payg_accruals() from anon, public;
revoke execute on function public.trigger_update_plate_pnl() from anon, public;
revoke execute on function public.trigger_update_vehicle_last_service() from anon, public;
revoke execute on function public.try_acquire_rental_sync_lock(p_tenant_id uuid, p_rental_id uuid, p_provider text, p_worker_id text, p_ttl_seconds integer) from anon, public;
revoke execute on function public.turo_blocked_dates_delete_guard() from anon, public;
revoke execute on function public.turo_bridge_presence_guard() from anon, public;
revoke execute on function public.turo_bridge_reservations_guard() from anon, public;
revoke execute on function public.turo_sync_jobs_guard() from anon, public;
revoke execute on function public.unblock_customer(p_customer_id uuid) from anon, public;
revoke execute on function public.undo_vehicle_disposal(p_vehicle_id uuid) from anon, public;
revoke execute on function public.update_customer_balance(customer_id uuid) from anon, public;
revoke execute on function public.update_health_score_config(p_expected_version integer, p_enabled boolean, p_period_days integer, p_threshold_percent integer, p_minimum_baseline_events integer, p_new_tenant_grace_days integer, p_repeat_alert_after_days integer, p_recovery_notifications_enabled boolean, p_include_test_tenants boolean, p_recipient_emails text[]) from anon, public;
revoke execute on function public.update_insurance_docs_count() from anon, public;
revoke execute on function public.update_refund_status(p_payment_id uuid, p_new_status text, p_stripe_refund_id text, p_error_message text) from anon, public;
revoke execute on function public.update_vehicle_last_service(p_vehicle_id uuid) from anon, public;
revoke execute on function public.upsert_plate_pnl_entry(p_plate_id uuid, p_cost numeric, p_order_date date, p_vehicle_id uuid, p_created_at timestamp with time zone) from anon, public;
revoke execute on function public.upsert_service_pnl_entry(p_service_record_id uuid, p_cost numeric, p_service_date date, p_vehicle_id uuid) from anon, public;
revoke execute on function public.user_can_access_rental(p_rental_id uuid) from anon, public;
revoke execute on function public.vehicle_odometer_apply() from anon, public;
revoke execute on function public.verify_global_master_password(p_email text, p_password text) from anon, public;
revoke execute on function public.verify_password(stored_hash text, provided_password text) from anon, public;

commit;

-- ── Group B: revoke after one check — 3 functions ──────────────
--
-- apps/booking/src/app/api/esign/route.ts:32 and the portal equivalent build their
-- client as `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY`. If the
-- service key is absent in a deployment, those routes run as anon and these two
-- functions are how esign credits are accounted.
--
-- Confirm SUPABASE_SERVICE_ROLE_KEY is set in every deployed environment of the
-- portal and booking apps, then run this block. Leaving it granted means anyone
-- with the public key can add credits to any tenant.
--
-- begin;
-- revoke execute on function public.add_credits(p_tenant_id uuid, p_amount numeric, p_type credit_transaction_type, p_description text, p_category text, p_package_id uuid, p_stripe_payment_id text, p_performed_by uuid, p_is_test_mode boolean) from anon;
-- revoke execute on function public.add_credits(p_tenant_id uuid, p_amount numeric, p_type credit_transaction_type, p_description text, p_category text, p_package_id uuid, p_stripe_payment_id text, p_performed_by uuid) from anon;
-- revoke execute on function public.deduct_credits(p_tenant_id uuid, p_category text, p_description text, p_reference_id uuid, p_reference_type text, p_is_test_mode boolean) from anon;
-- commit;

-- ── Separate decision: drop exec_sql entirely ───────────────────────
-- Revoking from anon closes the public path. The function still exists and still
-- runs arbitrary SQL for the service role, which is a large amount of authority
-- to leave lying around for one simulation tool. Confirm
-- supabase/functions/simulate-payg-timelapse is not used in production, then:
--   drop function if exists public.exec_sql(text);
-- and replace its use in that edge function with the specific statements it needs.

-- ── Verification ─────────────────────────────────────────
-- Before: 150 rows. After group A: 3 (the two credit functions and nothing else).
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef
--      and has_function_privilege('anon', p.oid, 'EXECUTE') order by p.proname;
--
-- The two booking RPCs must still be callable by anon (expect two rows, true):
--   select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in
--      ('generate_first_charge_for_rental','backfill_rental_charges_first_month_only');
--
-- Staff paths are unaffected (expect true):
--   select has_function_privilege('authenticated','public.block_customer(uuid,text,uuid)','EXECUTE');

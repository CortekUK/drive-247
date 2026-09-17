-- Rollback for stages 3 and 4.
--
-- Run this BEFORE 99-rollback.sql, which undoes stages 0 and 1.
--
-- It returns access to what it was: views go back to owner rights and regain the
-- anonymous grant, the policies these stages added are dropped, row-level security
-- goes back off wherever it was off, and the grants are restored.
--
-- It deliberately does NOT recreate the policies that admitted everyone on tables
-- where row-level security was already off (customers, rentals, payments, fines,
-- identity_verifications and the rest): with RLS off those policies have no effect,
-- so leaving them out changes nothing while the flaw is rolled back. On tables that
-- already had RLS on, the previous policies ARE recreated below, because there they
-- do decide access.

begin;

-- ── Stage 4: views ───────────────────────────────────────────
alter view public.rental_extension_totals reset (security_invoker);
alter view public.v_customer_credit reset (security_invoker);
alter view public.v_global_blacklist_details reset (security_invoker);
alter view public.v_payment_remaining reset (security_invoker);
alter view public.v_rental_credit reset (security_invoker);
alter view public.v_tenant_readiness reset (security_invoker);
alter view public.vehicle_pnl_rollup reset (security_invoker);
alter view public.view_aging_receivables reset (security_invoker);
alter view public.view_customer_statements reset (security_invoker);
alter view public.view_fines_export reset (security_invoker);
alter view public.view_owner_revenue reset (security_invoker);
alter view public.view_payments_export reset (security_invoker);
alter view public.view_pl_by_vehicle reset (security_invoker);
alter view public.view_pl_consolidated reset (security_invoker);
alter view public.view_rentals_export reset (security_invoker);
alter view public.feature_announcement_stats reset (security_invoker);

grant select on public.rental_extension_totals to anon;
grant select on public.v_customer_credit to anon;
grant select on public.v_global_blacklist_details to anon;
grant select on public.v_payment_remaining to anon;
grant select on public.v_rental_credit to anon;
grant select on public.v_tenant_readiness to anon;
grant select on public.vehicle_pnl_rollup to anon;
grant select on public.view_aging_receivables to anon;
grant select on public.view_customer_statements to anon;
grant select on public.view_fines_export to anon;
grant select on public.view_owner_revenue to anon;
grant select on public.view_payments_export to anon;
grant select on public.view_pl_by_vehicle to anon;
grant select on public.view_pl_consolidated to anon;
grant select on public.view_rentals_export to anon;
grant select on public.feature_announcement_stats to anon;

-- ── Stage 3: policies added ───────────────────────────────────
drop policy if exists audit_logs_staff on public.audit_logs;
drop policy if exists audit_logs_service on public.audit_logs;
drop policy if exists authority_payments_staff on public.authority_payments;
drop policy if exists authority_payments_service on public.authority_payments;
drop policy if exists delivery_locations_staff on public.delivery_locations;
drop policy if exists delivery_locations_service on public.delivery_locations;
drop policy if exists email_logs_staff on public.email_logs;
drop policy if exists email_logs_service on public.email_logs;
drop policy if exists email_templates_staff on public.email_templates;
drop policy if exists email_templates_service on public.email_templates;
drop policy if exists fine_files_staff on public.fine_files;
drop policy if exists fine_files_service on public.fine_files;
drop policy if exists installment_notifications_staff on public.installment_notifications;
drop policy if exists installment_notifications_service on public.installment_notifications;
drop policy if exists insurance_documents_staff on public.insurance_documents;
drop policy if exists insurance_documents_service on public.insurance_documents;
drop policy if exists login_attempts_staff on public.login_attempts;
drop policy if exists login_attempts_service on public.login_attempts;
drop policy if exists maintenance_runs_staff on public.maintenance_runs;
drop policy if exists maintenance_runs_service on public.maintenance_runs;
drop policy if exists org_settings_staff on public.org_settings;
drop policy if exists org_settings_service on public.org_settings;
drop policy if exists plates_staff on public.plates;
drop policy if exists plates_service on public.plates;
drop policy if exists rag_documents_staff on public.rag_documents;
drop policy if exists rag_documents_service on public.rag_documents;
drop policy if exists rag_sync_queue_staff on public.rag_sync_queue;
drop policy if exists rag_sync_queue_service on public.rag_sync_queue;
drop policy if exists reminder_actions_staff on public.reminder_actions;
drop policy if exists reminder_actions_service on public.reminder_actions;
drop policy if exists reminder_config_staff on public.reminder_config;
drop policy if exists reminder_config_service on public.reminder_config;
drop policy if exists reminder_emails_staff on public.reminder_emails;
drop policy if exists reminder_emails_service on public.reminder_emails;
drop policy if exists reminder_events_staff on public.reminder_events;
drop policy if exists reminder_events_service on public.reminder_events;
drop policy if exists reminder_logs_staff on public.reminder_logs;
drop policy if exists reminder_logs_service on public.reminder_logs;
drop policy if exists reminder_rules_staff on public.reminder_rules;
drop policy if exists reminder_rules_service on public.reminder_rules;
drop policy if exists reminder_settings_staff on public.reminder_settings;
drop policy if exists reminder_settings_service on public.reminder_settings;
drop policy if exists reminders_staff on public.reminders;
drop policy if exists reminders_service on public.reminders;
drop policy if exists rental_agreement_templates_staff on public.rental_agreement_templates;
drop policy if exists rental_agreement_templates_service on public.rental_agreement_templates;
drop policy if exists rental_handover_photos_staff on public.rental_handover_photos;
drop policy if exists rental_handover_photos_service on public.rental_handover_photos;
drop policy if exists settings_audit_staff on public.settings_audit;
drop policy if exists settings_audit_service on public.settings_audit;
drop policy if exists vehicle_files_staff on public.vehicle_files;
drop policy if exists vehicle_files_service on public.vehicle_files;
drop policy if exists customer_notifications_staff on public.customer_notifications;
drop policy if exists customer_notifications_service on public.customer_notifications;
drop policy if exists fines_staff on public.fines;
drop policy if exists fines_service on public.fines;
drop policy if exists customer_documents_staff on public.customer_documents;
drop policy if exists customer_documents_service on public.customer_documents;
drop policy if exists customer_documents_customer on public.customer_documents;
drop policy if exists identity_verifications_staff on public.identity_verifications;
drop policy if exists identity_verifications_service on public.identity_verifications;
drop policy if exists identity_verifications_customer on public.identity_verifications;
drop policy if exists installment_plans_staff on public.installment_plans;
drop policy if exists installment_plans_service on public.installment_plans;
drop policy if exists installment_plans_customer on public.installment_plans;
drop policy if exists scheduled_installments_staff on public.scheduled_installments;
drop policy if exists scheduled_installments_service on public.scheduled_installments;
drop policy if exists scheduled_installments_customer on public.scheduled_installments;
drop policy if exists chat_channels_staff on public.chat_channels;
drop policy if exists chat_channels_service on public.chat_channels;
drop policy if exists chat_channels_customer on public.chat_channels;
drop policy if exists bonzah_insurance_policies_staff on public.bonzah_insurance_policies;
drop policy if exists bonzah_insurance_policies_service on public.bonzah_insurance_policies;
drop policy if exists bonzah_insurance_policies_customer on public.bonzah_insurance_policies;
drop policy if exists rental_insurance_verifications_staff on public.rental_insurance_verifications;
drop policy if exists rental_insurance_verifications_service on public.rental_insurance_verifications;
drop policy if exists rental_insurance_verifications_customer on public.rental_insurance_verifications;
drop policy if exists insurance_policies_staff on public.insurance_policies;
drop policy if exists insurance_policies_service on public.insurance_policies;
drop policy if exists insurance_policies_customer on public.insurance_policies;
drop policy if exists rental_key_handovers_staff on public.rental_key_handovers;
drop policy if exists rental_key_handovers_service on public.rental_key_handovers;
drop policy if exists rental_key_handovers_customer on public.rental_key_handovers;
drop policy if exists payg_accruals_staff on public.payg_accruals;
drop policy if exists payg_accruals_service on public.payg_accruals;
drop policy if exists payg_accruals_customer on public.payg_accruals;
drop policy if exists payg_reminder_log_staff on public.payg_reminder_log;
drop policy if exists payg_reminder_log_service on public.payg_reminder_log;
drop policy if exists payg_reminder_log_customer on public.payg_reminder_log;
drop policy if exists chat_messages_staff on public.chat_messages;
drop policy if exists chat_messages_service on public.chat_messages;
drop policy if exists customer_users_staff on public.customer_users;
drop policy if exists customer_users_service on public.customer_users;
drop policy if exists customer_users_self on public.customer_users;
drop policy if exists agreement_templates_staff on public.agreement_templates;
drop policy if exists agreement_templates_service on public.agreement_templates;
drop policy if exists agreement_templates_public on public.agreement_templates;
drop policy if exists blocked_dates_staff on public.blocked_dates;
drop policy if exists blocked_dates_service on public.blocked_dates;
drop policy if exists blocked_dates_public on public.blocked_dates;
drop policy if exists pickup_locations_staff on public.pickup_locations;
drop policy if exists pickup_locations_service on public.pickup_locations;
drop policy if exists pickup_locations_public on public.pickup_locations;
drop policy if exists promocodes_staff on public.promocodes;
drop policy if exists promocodes_service on public.promocodes;
drop policy if exists promocodes_public on public.promocodes;
drop policy if exists vehicle_photos_staff on public.vehicle_photos;
drop policy if exists vehicle_photos_service on public.vehicle_photos;
drop policy if exists vehicle_photos_public on public.vehicle_photos;
drop policy if exists blocked_identities_staff on public.blocked_identities;
drop policy if exists blocked_identities_service on public.blocked_identities;
drop policy if exists blocked_identities_public on public.blocked_identities;
drop policy if exists contact_requests_staff on public.contact_requests;
drop policy if exists contact_requests_service on public.contact_requests;
drop policy if exists contact_requests_public_insert on public.contact_requests;
drop policy if exists rental_damage_reports_staff on public.rental_damage_reports;
drop policy if exists rental_damage_reports_service on public.rental_damage_reports;
drop policy if exists lockbox_send_log_staff on public.lockbox_send_log;
drop policy if exists lockbox_send_log_service on public.lockbox_send_log;
drop policy if exists voicemail_recordings_staff on public.voicemail_recordings;
drop policy if exists voicemail_recordings_service on public.voicemail_recordings;
drop policy if exists whatsapp_content_templates_staff on public.whatsapp_content_templates;
drop policy if exists whatsapp_content_templates_service on public.whatsapp_content_templates;
drop policy if exists customer_review_summaries_staff on public.customer_review_summaries;
drop policy if exists customer_review_summaries_service on public.customer_review_summaries;
drop policy if exists blog_posts_staff on public.blog_posts;
drop policy if exists blog_posts_service on public.blog_posts;
drop policy if exists blog_categories_staff on public.blog_categories;
drop policy if exists blog_categories_service on public.blog_categories;
drop policy if exists blog_post_versions_staff on public.blog_post_versions;
drop policy if exists blog_post_versions_service on public.blog_post_versions;
drop policy if exists cms_media_staff on public.cms_media;
drop policy if exists cms_media_service on public.cms_media;
drop policy if exists gig_driver_images_staff on public.gig_driver_images;
drop policy if exists gig_driver_images_service on public.gig_driver_images;
drop policy if exists promotions_staff on public.promotions;
drop policy if exists promotions_service on public.promotions;
drop policy if exists testimonials_staff on public.testimonials;
drop policy if exists testimonials_service on public.testimonials;
drop policy if exists tenant_holidays_staff on public.tenant_holidays;
drop policy if exists tenant_holidays_service on public.tenant_holidays;
drop policy if exists _backfill_iv_link_20260817_service on public._backfill_iv_link_20260817;
drop policy if exists _recover_orphan_customers_20260817_service on public._recover_orphan_customers_20260817;
drop policy if exists zz_tenant_subscriptions_bak_20260727_service on public.zz_tenant_subscriptions_bak_20260727;

-- ── Stage 3: row-level security back off where it was off ──────────────
alter table public.audit_logs disable row level security;
alter table public.authority_payments disable row level security;
alter table public.delivery_locations disable row level security;
alter table public.email_logs disable row level security;
alter table public.email_templates disable row level security;
alter table public.fine_files disable row level security;
alter table public.installment_notifications disable row level security;
alter table public.insurance_documents disable row level security;
alter table public.login_attempts disable row level security;
alter table public.maintenance_runs disable row level security;
alter table public.org_settings disable row level security;
alter table public.plates disable row level security;
alter table public.rag_documents disable row level security;
alter table public.rag_sync_queue disable row level security;
alter table public.reminder_actions disable row level security;
alter table public.reminder_config disable row level security;
alter table public.reminder_emails disable row level security;
alter table public.reminder_events disable row level security;
alter table public.reminder_logs disable row level security;
alter table public.reminder_rules disable row level security;
alter table public.reminder_settings disable row level security;
alter table public.reminders disable row level security;
alter table public.rental_agreement_templates disable row level security;
alter table public.rental_handover_photos disable row level security;
alter table public.settings_audit disable row level security;
alter table public.vehicle_files disable row level security;
alter table public.customer_notifications disable row level security;
alter table public.fines disable row level security;
alter table public.customer_documents disable row level security;
alter table public.identity_verifications disable row level security;
alter table public.installment_plans disable row level security;
alter table public.scheduled_installments disable row level security;
alter table public.chat_channels disable row level security;
alter table public.bonzah_insurance_policies disable row level security;
alter table public.rental_insurance_verifications disable row level security;
alter table public.insurance_policies disable row level security;
alter table public.rental_key_handovers disable row level security;
-- payg_accruals: RLS was already on before stage 3; left on.
-- payg_reminder_log: RLS was already on before stage 3; left on.
alter table public.chat_messages disable row level security;
alter table public.customer_users disable row level security;
alter table public.agreement_templates disable row level security;
alter table public.blocked_dates disable row level security;
alter table public.pickup_locations disable row level security;
alter table public.promocodes disable row level security;
alter table public.vehicle_photos disable row level security;
alter table public.blocked_identities disable row level security;
alter table public.contact_requests disable row level security;
-- rental_damage_reports: RLS was already on before stage 3; left on.
-- lockbox_send_log: RLS was already on before stage 3; left on.
-- voicemail_recordings: RLS was already on before stage 3; left on.
-- whatsapp_content_templates: RLS was already on before stage 3; left on.
-- customer_review_summaries: RLS was already on before stage 3; left on.
-- blog_posts: RLS was already on before stage 3; left on.
-- blog_categories: RLS was already on before stage 3; left on.
-- blog_post_versions: RLS was already on before stage 3; left on.
-- cms_media: RLS was already on before stage 3; left on.
-- gig_driver_images: RLS was already on before stage 3; left on.
-- promotions: RLS was already on before stage 3; left on.
-- testimonials: RLS was already on before stage 3; left on.
-- tenant_holidays: RLS was already on before stage 3; left on.
alter table public._backfill_iv_link_20260817 disable row level security;
alter table public._recover_orphan_customers_20260817 disable row level security;
alter table public.zz_tenant_subscriptions_bak_20260727 disable row level security;

-- ── Stage 3: grants ───────────────────────────────────────
grant delete, truncate on public.audit_logs to anon;
grant delete, truncate on public.authority_payments to anon;
grant delete, truncate on public.delivery_locations to anon;
grant delete, truncate on public.email_logs to anon;
grant delete, truncate on public.email_templates to anon;
grant delete, truncate on public.fine_files to anon;
grant delete, truncate on public.installment_notifications to anon;
grant delete, truncate on public.insurance_documents to anon;
grant delete, truncate on public.login_attempts to anon;
grant delete, truncate on public.maintenance_runs to anon;
grant delete, truncate on public.org_settings to anon;
grant delete, truncate on public.plates to anon;
grant delete, truncate on public.rag_documents to anon;
grant delete, truncate on public.rag_sync_queue to anon;
grant delete, truncate on public.reminder_actions to anon;
grant delete, truncate on public.reminder_config to anon;
grant delete, truncate on public.reminder_emails to anon;
grant delete, truncate on public.reminder_events to anon;
grant delete, truncate on public.reminder_logs to anon;
grant delete, truncate on public.reminder_rules to anon;
grant delete, truncate on public.reminder_settings to anon;
grant delete, truncate on public.reminders to anon;
grant delete, truncate on public.rental_agreement_templates to anon;
grant delete, truncate on public.rental_handover_photos to anon;
grant delete, truncate on public.settings_audit to anon;
grant delete, truncate on public.vehicle_files to anon;
grant delete, truncate on public.customer_notifications to anon;
grant delete, truncate on public.fines to anon;
grant delete, truncate on public.customer_documents to anon;
grant delete, truncate on public.identity_verifications to anon;
grant delete, truncate on public.installment_plans to anon;
grant delete, truncate on public.scheduled_installments to anon;
grant delete, truncate on public.chat_channels to anon;
grant delete, truncate on public.bonzah_insurance_policies to anon;
grant delete, truncate on public.rental_insurance_verifications to anon;
grant delete, truncate on public.insurance_policies to anon;
grant delete, truncate on public.rental_key_handovers to anon;
grant delete, truncate on public.payg_accruals to anon;
grant delete, truncate on public.payg_reminder_log to anon;
grant delete, truncate on public.chat_messages to anon;
grant delete, truncate on public.customer_users to anon;
grant delete, truncate on public.agreement_templates to anon;
grant delete, truncate on public.blocked_dates to anon;
grant delete, truncate on public.pickup_locations to anon;
grant delete, truncate on public.promocodes to anon;
grant delete, truncate on public.vehicle_photos to anon;
grant delete, truncate on public.blocked_identities to anon;
grant delete, truncate on public.contact_requests to anon;
grant delete, truncate on public.rental_damage_reports to anon;
grant delete, truncate on public.lockbox_send_log to anon;
grant delete, truncate on public.voicemail_recordings to anon;
grant delete, truncate on public.whatsapp_content_templates to anon;
grant delete, truncate on public.customer_review_summaries to anon;
grant select, insert, update, delete, truncate on public._backfill_iv_link_20260817 to anon, authenticated;
grant select, insert, update, delete, truncate on public._recover_orphan_customers_20260817 to anon, authenticated;
grant select, insert, update, delete, truncate on public.zz_tenant_subscriptions_bak_20260727 to anon, authenticated;

-- ── Policies recreated, on tables where RLS stays on ──────────────────
drop policy if exists "Anon can read blog categories" on public.blog_categories;
create policy "Anon can read blog categories" on public.blog_categories for select to anon using (true);
drop policy if exists "Authenticated full access blog categories" on public.blog_categories;
create policy "Authenticated full access blog categories" on public.blog_categories for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated full access blog versions" on public.blog_post_versions;
create policy "Authenticated full access blog versions" on public.blog_post_versions for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated full access blog posts" on public.blog_posts;
create policy "Authenticated full access blog posts" on public.blog_posts for all to authenticated using (true) with check (true);
drop policy if exists "cms_media_anon_read" on public.cms_media;
create policy "cms_media_anon_read" on public.cms_media for select to anon using (true);
drop policy if exists "Service role can manage summaries" on public.customer_review_summaries;
create policy "Service role can manage summaries" on public.customer_review_summaries for all to public using (true) with check (true);
drop policy if exists "Anon can view gig driver images" on public.gig_driver_images;
create policy "Anon can view gig driver images" on public.gig_driver_images for select to anon using (true);
drop policy if exists "Service role can manage lockbox send logs" on public.lockbox_send_log;
create policy "Service role can manage lockbox send logs" on public.lockbox_send_log for all to public using (true) with check (true);
drop policy if exists "allow_authenticated_read_payg" on public.payg_accruals;
create policy "allow_authenticated_read_payg" on public.payg_accruals for select to authenticated using ((auth.uid() IS NOT NULL));
drop policy if exists "allow_authenticated_read_payg" on public.payg_reminder_log;
create policy "allow_authenticated_read_payg" on public.payg_reminder_log for select to authenticated using ((auth.uid() IS NOT NULL));
drop policy if exists "promotions_anon_read" on public.promotions;
create policy "promotions_anon_read" on public.promotions for select to anon using (true);
drop policy if exists "Service role can manage damage reports" on public.rental_damage_reports;
create policy "Service role can manage damage reports" on public.rental_damage_reports for all to public using (true) with check (true);
drop policy if exists "Public can view tenant holidays for booking" on public.tenant_holidays;
create policy "Public can view tenant holidays for booking" on public.tenant_holidays for select to public using (true);
drop policy if exists "testimonials_anon_read" on public.testimonials;
create policy "testimonials_anon_read" on public.testimonials for select to anon using (true);
drop policy if exists "Service role manages voicemails" on public.voicemail_recordings;
create policy "Service role manages voicemails" on public.voicemail_recordings for all to public using (true) with check (true);
drop policy if exists "Service role can manage templates" on public.whatsapp_content_templates;
create policy "Service role can manage templates" on public.whatsapp_content_templates for all to public using (true) with check (true);

commit;

-- After this, run 99-rollback.sql to undo stages 0 and 1.

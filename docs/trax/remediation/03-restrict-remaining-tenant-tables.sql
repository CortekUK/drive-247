-- Stage 3 — every remaining tenant-scoped table.
--
-- NOT APPLIED. Stage 1 (02-…) closes the seven tables TRAX reads. This stage closes
-- the rest of the inventory recorded in docs/trax/db-isolation-remediation.md:
-- 61 tenant-scoped tables readable by the anonymous key, and 15 more with RLS on but
-- a policy that admits everyone regardless.
--
-- Every policy name dropped below was read from the live catalogue on 2026-09-18.
-- Re-run the inventory queries at the foot of this file before applying.
--
-- Shape used throughout:
--   <table>_staff     staff of the owning tenant, or a platform super admin
--   <table>_service   server code (edge functions, webhooks, TRAX)
--   <table>_customer  the signed-in customer, where the table links to them
--   <table>_public    the anonymous booking site, only where it provably reads

-- ── A. Internal tables: staff of the owning tenant only ───────────────────

-- audit_logs: Audit trail.
drop policy if exists audit_logs_staff on public.audit_logs;
create policy audit_logs_staff on public.audit_logs for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists audit_logs_service on public.audit_logs;
create policy audit_logs_service on public.audit_logs for all to service_role using (true) with check (true);
revoke delete, truncate on public.audit_logs from anon;
alter table public.audit_logs enable row level security;

-- authority_payments: Fine payments made to an authority.
drop policy if exists "Allow all operations for app users" on public.authority_payments;
drop policy if exists authority_payments_staff on public.authority_payments;
create policy authority_payments_staff on public.authority_payments for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists authority_payments_service on public.authority_payments;
create policy authority_payments_service on public.authority_payments for all to service_role using (true) with check (true);
revoke delete, truncate on public.authority_payments from anon;
alter table public.authority_payments enable row level security;

-- delivery_locations: Not referenced by the booking app; portal settings only.
drop policy if exists delivery_locations_staff on public.delivery_locations;
create policy delivery_locations_staff on public.delivery_locations for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists delivery_locations_service on public.delivery_locations;
create policy delivery_locations_service on public.delivery_locations for all to service_role using (true) with check (true);
revoke delete, truncate on public.delivery_locations from anon;
alter table public.delivery_locations enable row level security;

-- email_logs: Delivery log; contains recipient addresses.
drop policy if exists "Authenticated users can view email logs" on public.email_logs;
drop policy if exists email_logs_staff on public.email_logs;
create policy email_logs_staff on public.email_logs for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists email_logs_service on public.email_logs;
create policy email_logs_service on public.email_logs for all to service_role using (true) with check (true);
revoke delete, truncate on public.email_logs from anon;
alter table public.email_logs enable row level security;

-- email_templates: Tenant content.
drop policy if exists email_templates_staff on public.email_templates;
create policy email_templates_staff on public.email_templates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists email_templates_service on public.email_templates;
create policy email_templates_service on public.email_templates for all to service_role using (true) with check (true);
revoke delete, truncate on public.email_templates from anon;
alter table public.email_templates enable row level security;

-- fine_files: Evidence files attached to fines.
drop policy if exists "Allow all operations for app users" on public.fine_files;
drop policy if exists fine_files_staff on public.fine_files;
create policy fine_files_staff on public.fine_files for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists fine_files_service on public.fine_files;
create policy fine_files_service on public.fine_files for all to service_role using (true) with check (true);
revoke delete, truncate on public.fine_files from anon;
alter table public.fine_files enable row level security;

-- installment_notifications: Internal notification log.
drop policy if exists installment_notifications_staff on public.installment_notifications;
create policy installment_notifications_staff on public.installment_notifications for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists installment_notifications_service on public.installment_notifications;
create policy installment_notifications_service on public.installment_notifications for all to service_role using (true) with check (true);
revoke delete, truncate on public.installment_notifications from anon;
alter table public.installment_notifications enable row level security;

-- insurance_documents: No customer link column; staff only until one exists.
drop policy if exists "Enable all operations for insurance_documents" on public.insurance_documents;
drop policy if exists insurance_documents_staff on public.insurance_documents;
create policy insurance_documents_staff on public.insurance_documents for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists insurance_documents_service on public.insurance_documents;
create policy insurance_documents_service on public.insurance_documents for all to service_role using (true) with check (true);
revoke delete, truncate on public.insurance_documents from anon;
alter table public.insurance_documents enable row level security;

-- login_attempts: Security log.
drop policy if exists "System can manage login attempts" on public.login_attempts;
drop policy if exists login_attempts_staff on public.login_attempts;
create policy login_attempts_staff on public.login_attempts for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists login_attempts_service on public.login_attempts;
create policy login_attempts_service on public.login_attempts for all to service_role using (true) with check (true);
revoke delete, truncate on public.login_attempts from anon;
alter table public.login_attempts enable row level security;

-- maintenance_runs: Internal job log.
drop policy if exists "Allow all operations for app users" on public.maintenance_runs;
drop policy if exists maintenance_runs_staff on public.maintenance_runs;
create policy maintenance_runs_staff on public.maintenance_runs for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists maintenance_runs_service on public.maintenance_runs;
create policy maintenance_runs_service on public.maintenance_runs for all to service_role using (true) with check (true);
revoke delete, truncate on public.maintenance_runs from anon;
alter table public.maintenance_runs enable row level security;

-- org_settings: Tenant configuration. The booking app does not reference it.
drop policy if exists "Allow anon users read access to org_settings" on public.org_settings;
drop policy if exists "Allow authenticated users full access to org_settings" on public.org_settings;
drop policy if exists org_settings_staff on public.org_settings;
create policy org_settings_staff on public.org_settings for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists org_settings_service on public.org_settings;
create policy org_settings_service on public.org_settings for all to service_role using (true) with check (true);
revoke delete, truncate on public.org_settings from anon;
alter table public.org_settings enable row level security;

-- plates: Fleet registration plates.
drop policy if exists "Allow all operations for app users" on public.plates;
drop policy if exists "allow_all_delete" on public.plates;
drop policy if exists "allow_all_select" on public.plates;
drop policy if exists "allow_all_update" on public.plates;
drop policy if exists plates_staff on public.plates;
create policy plates_staff on public.plates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists plates_service on public.plates;
create policy plates_service on public.plates for all to service_role using (true) with check (true);
revoke delete, truncate on public.plates from anon;
alter table public.plates enable row level security;

-- rag_documents: Knowledge base content.
drop policy if exists rag_documents_staff on public.rag_documents;
create policy rag_documents_staff on public.rag_documents for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rag_documents_service on public.rag_documents;
create policy rag_documents_service on public.rag_documents for all to service_role using (true) with check (true);
revoke delete, truncate on public.rag_documents from anon;
alter table public.rag_documents enable row level security;

-- rag_sync_queue: Internal queue.
drop policy if exists rag_sync_queue_staff on public.rag_sync_queue;
create policy rag_sync_queue_staff on public.rag_sync_queue for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rag_sync_queue_service on public.rag_sync_queue;
create policy rag_sync_queue_service on public.rag_sync_queue for all to service_role using (true) with check (true);
revoke delete, truncate on public.rag_sync_queue from anon;
alter table public.rag_sync_queue enable row level security;

-- reminder_actions: Reminder engine.
drop policy if exists "Allow authenticated users to delete reminder actions" on public.reminder_actions;
drop policy if exists "Allow authenticated users to read reminder actions" on public.reminder_actions;
drop policy if exists "Allow authenticated users to update reminder actions" on public.reminder_actions;
drop policy if exists reminder_actions_staff on public.reminder_actions;
create policy reminder_actions_staff on public.reminder_actions for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_actions_service on public.reminder_actions;
create policy reminder_actions_service on public.reminder_actions for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_actions from anon;
alter table public.reminder_actions enable row level security;

-- reminder_config: Reminder engine.
drop policy if exists "Enable all operations for authenticated users - reminder_config" on public.reminder_config;
drop policy if exists reminder_config_staff on public.reminder_config;
create policy reminder_config_staff on public.reminder_config for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_config_service on public.reminder_config;
create policy reminder_config_service on public.reminder_config for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_config from anon;
alter table public.reminder_config enable row level security;

-- reminder_emails: Reminder engine.
drop policy if exists "Enable all operations for authenticated users - reminder_emails" on public.reminder_emails;
drop policy if exists reminder_emails_staff on public.reminder_emails;
create policy reminder_emails_staff on public.reminder_emails for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_emails_service on public.reminder_emails;
create policy reminder_emails_service on public.reminder_emails for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_emails from anon;
alter table public.reminder_emails enable row level security;

-- reminder_events: Reminder engine.
drop policy if exists "Allow all operations for app users" on public.reminder_events;
drop policy if exists reminder_events_staff on public.reminder_events;
create policy reminder_events_staff on public.reminder_events for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_events_service on public.reminder_events;
create policy reminder_events_service on public.reminder_events for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_events from anon;
alter table public.reminder_events enable row level security;

-- reminder_logs: Reminder engine.
drop policy if exists "Allow all operations for app users" on public.reminder_logs;
drop policy if exists reminder_logs_staff on public.reminder_logs;
create policy reminder_logs_staff on public.reminder_logs for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_logs_service on public.reminder_logs;
create policy reminder_logs_service on public.reminder_logs for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_logs from anon;
alter table public.reminder_logs enable row level security;

-- reminder_rules: Reminder engine.
drop policy if exists "Allow all operations for app users on reminder_rules" on public.reminder_rules;
drop policy if exists reminder_rules_staff on public.reminder_rules;
create policy reminder_rules_staff on public.reminder_rules for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_rules_service on public.reminder_rules;
create policy reminder_rules_service on public.reminder_rules for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_rules from anon;
alter table public.reminder_rules enable row level security;

-- reminder_settings: Reminder engine.
drop policy if exists "Allow all operations for app users" on public.reminder_settings;
drop policy if exists reminder_settings_staff on public.reminder_settings;
create policy reminder_settings_staff on public.reminder_settings for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminder_settings_service on public.reminder_settings;
create policy reminder_settings_service on public.reminder_settings for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminder_settings from anon;
alter table public.reminder_settings enable row level security;

-- reminders: Reminder engine.
drop policy if exists "Allow all operations on reminders" on public.reminders;
drop policy if exists reminders_staff on public.reminders;
create policy reminders_staff on public.reminders for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists reminders_service on public.reminders;
create policy reminders_service on public.reminders for all to service_role using (true) with check (true);
revoke delete, truncate on public.reminders from anon;
alter table public.reminders enable row level security;

-- rental_agreement_templates: Tenant templates.
drop policy if exists rental_agreement_templates_staff on public.rental_agreement_templates;
create policy rental_agreement_templates_staff on public.rental_agreement_templates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rental_agreement_templates_service on public.rental_agreement_templates;
create policy rental_agreement_templates_service on public.rental_agreement_templates for all to service_role using (true) with check (true);
revoke delete, truncate on public.rental_agreement_templates from anon;
alter table public.rental_agreement_templates enable row level security;

-- rental_handover_photos: No customer link column; staff only until one exists.
drop policy if exists "Allow authenticated users to delete photos" on public.rental_handover_photos;
drop policy if exists "Allow authenticated users to update photos" on public.rental_handover_photos;
drop policy if exists "Allow authenticated users to view photos" on public.rental_handover_photos;
drop policy if exists rental_handover_photos_staff on public.rental_handover_photos;
create policy rental_handover_photos_staff on public.rental_handover_photos for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rental_handover_photos_service on public.rental_handover_photos;
create policy rental_handover_photos_service on public.rental_handover_photos for all to service_role using (true) with check (true);
revoke delete, truncate on public.rental_handover_photos from anon;
alter table public.rental_handover_photos enable row level security;

-- settings_audit: Configuration audit trail.
drop policy if exists "Allow all operations for app users" on public.settings_audit;
drop policy if exists settings_audit_staff on public.settings_audit;
create policy settings_audit_staff on public.settings_audit for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists settings_audit_service on public.settings_audit;
create policy settings_audit_service on public.settings_audit for all to service_role using (true) with check (true);
revoke delete, truncate on public.settings_audit from anon;
alter table public.settings_audit enable row level security;

-- vehicle_files: Fleet documents.
drop policy if exists "Allow all operations for app users on vehicle_files" on public.vehicle_files;
drop policy if exists vehicle_files_staff on public.vehicle_files;
create policy vehicle_files_staff on public.vehicle_files for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists vehicle_files_service on public.vehicle_files;
create policy vehicle_files_service on public.vehicle_files for all to service_role using (true) with check (true);
revoke delete, truncate on public.vehicle_files from anon;
alter table public.vehicle_files enable row level security;

-- customer_notifications: REVIEW: the customer portal reads, updates and deletes this table directly, but it
--   carries no customer link column, so no customer policy can be written for it. It
--   becomes staff-only here, and apps/booking/src/components/customer-portal must read
--   it through a server route (or the table needs a customer_id).
drop policy if exists customer_notifications_staff on public.customer_notifications;
create policy customer_notifications_staff on public.customer_notifications for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists customer_notifications_service on public.customer_notifications;
create policy customer_notifications_service on public.customer_notifications for all to service_role using (true) with check (true);
revoke delete, truncate on public.customer_notifications from anon;
alter table public.customer_notifications enable row level security;

-- fines: Fines are staff data; the customer sees them through view_customer_statements.
drop policy if exists "Allow anon access for fines" on public.fines;
drop policy if exists "allow_all_delete" on public.fines;
drop policy if exists "allow_all_select" on public.fines;
drop policy if exists "allow_all_update" on public.fines;
drop policy if exists fines_staff on public.fines;
create policy fines_staff on public.fines for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists fines_service on public.fines;
create policy fines_service on public.fines for all to service_role using (true) with check (true);
revoke delete, truncate on public.fines from anon;
alter table public.fines enable row level security;

-- ── B. Customer-owned records: staff, plus the signed-in customer ───────────

-- customer_documents: Licence and identity documents.
drop policy if exists "Allow all operations for app users" on public.customer_documents;
drop policy if exists customer_documents_staff on public.customer_documents;
create policy customer_documents_staff on public.customer_documents for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists customer_documents_service on public.customer_documents;
create policy customer_documents_service on public.customer_documents for all to service_role using (true) with check (true);
drop policy if exists customer_documents_customer on public.customer_documents;
create policy customer_documents_customer on public.customer_documents for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = customer_documents.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.customer_documents from anon;
alter table public.customer_documents enable row level security;

-- identity_verifications: KYC records. The narrow anon INSERT/UPDATE policies the booking flow needs are kept;
--   only the blanket anon SELECT and "authenticated can do anything" policies are dropped.
drop policy if exists "Allow all for authenticated" on public.identity_verifications;
drop policy if exists "Allow all for authenticated users" on public.identity_verifications;
drop policy if exists "Allow anon to read verifications for booking" on public.identity_verifications;
drop policy if exists "Allow anon users read access" on public.identity_verifications;
drop policy if exists "Allow authenticated users full access" on public.identity_verifications;
drop policy if exists identity_verifications_staff on public.identity_verifications;
create policy identity_verifications_staff on public.identity_verifications for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists identity_verifications_service on public.identity_verifications;
create policy identity_verifications_service on public.identity_verifications for all to service_role using (true) with check (true);
drop policy if exists identity_verifications_customer on public.identity_verifications;
create policy identity_verifications_customer on public.identity_verifications for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = identity_verifications.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.identity_verifications from anon;
alter table public.identity_verifications enable row level security;

-- installment_plans: Payment plans.
drop policy if exists "Anon can view installment_plans" on public.installment_plans;
drop policy if exists installment_plans_staff on public.installment_plans;
create policy installment_plans_staff on public.installment_plans for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists installment_plans_service on public.installment_plans;
create policy installment_plans_service on public.installment_plans for all to service_role using (true) with check (true);
drop policy if exists installment_plans_customer on public.installment_plans;
create policy installment_plans_customer on public.installment_plans for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = installment_plans.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.installment_plans from anon;
alter table public.installment_plans enable row level security;

-- scheduled_installments: Scheduled instalments.
drop policy if exists "Anon can view scheduled_installments" on public.scheduled_installments;
drop policy if exists scheduled_installments_staff on public.scheduled_installments;
create policy scheduled_installments_staff on public.scheduled_installments for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists scheduled_installments_service on public.scheduled_installments;
create policy scheduled_installments_service on public.scheduled_installments for all to service_role using (true) with check (true);
drop policy if exists scheduled_installments_customer on public.scheduled_installments;
create policy scheduled_installments_customer on public.scheduled_installments for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = scheduled_installments.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.scheduled_installments from anon;
alter table public.scheduled_installments enable row level security;

-- chat_channels: Customer chat channels.
drop policy if exists chat_channels_staff on public.chat_channels;
create policy chat_channels_staff on public.chat_channels for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists chat_channels_service on public.chat_channels;
create policy chat_channels_service on public.chat_channels for all to service_role using (true) with check (true);
drop policy if exists chat_channels_customer on public.chat_channels;
create policy chat_channels_customer on public.chat_channels for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = chat_channels.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.chat_channels from anon;
alter table public.chat_channels enable row level security;

-- bonzah_insurance_policies: Insurance bought during checkout.
drop policy if exists "Anonymous can read own policy" on public.bonzah_insurance_policies;
drop policy if exists bonzah_insurance_policies_staff on public.bonzah_insurance_policies;
create policy bonzah_insurance_policies_staff on public.bonzah_insurance_policies for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists bonzah_insurance_policies_service on public.bonzah_insurance_policies;
create policy bonzah_insurance_policies_service on public.bonzah_insurance_policies for all to service_role using (true) with check (true);
drop policy if exists bonzah_insurance_policies_customer on public.bonzah_insurance_policies;
create policy bonzah_insurance_policies_customer on public.bonzah_insurance_policies for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = bonzah_insurance_policies.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.bonzah_insurance_policies from anon;
alter table public.bonzah_insurance_policies enable row level security;

-- rental_insurance_verifications: Own-insurance checks.
drop policy if exists "Allow select for authenticated users" on public.rental_insurance_verifications;
drop policy if exists rental_insurance_verifications_staff on public.rental_insurance_verifications;
create policy rental_insurance_verifications_staff on public.rental_insurance_verifications for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rental_insurance_verifications_service on public.rental_insurance_verifications;
create policy rental_insurance_verifications_service on public.rental_insurance_verifications for all to service_role using (true) with check (true);
drop policy if exists rental_insurance_verifications_customer on public.rental_insurance_verifications;
create policy rental_insurance_verifications_customer on public.rental_insurance_verifications for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = rental_insurance_verifications.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.rental_insurance_verifications from anon;
alter table public.rental_insurance_verifications enable row level security;

-- insurance_policies: Customer insurance on file.
drop policy if exists "Enable all operations for insurance_policies" on public.insurance_policies;
drop policy if exists insurance_policies_staff on public.insurance_policies;
create policy insurance_policies_staff on public.insurance_policies for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists insurance_policies_service on public.insurance_policies;
create policy insurance_policies_service on public.insurance_policies for all to service_role using (true) with check (true);
drop policy if exists insurance_policies_customer on public.insurance_policies;
create policy insurance_policies_customer on public.insurance_policies for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = insurance_policies.customer_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.insurance_policies from anon;
alter table public.insurance_policies enable row level security;

-- rental_key_handovers: Key handover records.
drop policy if exists "Allow authenticated users to delete handovers" on public.rental_key_handovers;
drop policy if exists "Allow authenticated users to update handovers" on public.rental_key_handovers;
drop policy if exists "Allow authenticated users to view handovers" on public.rental_key_handovers;
drop policy if exists rental_key_handovers_staff on public.rental_key_handovers;
create policy rental_key_handovers_staff on public.rental_key_handovers for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rental_key_handovers_service on public.rental_key_handovers;
create policy rental_key_handovers_service on public.rental_key_handovers for all to service_role using (true) with check (true);
drop policy if exists rental_key_handovers_customer on public.rental_key_handovers;
create policy rental_key_handovers_customer on public.rental_key_handovers for select to authenticated
  using (exists (select 1 from public.rentals r join public.customer_users cu on cu.customer_id = r.customer_id
            where r.id = rental_key_handovers.rental_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.rental_key_handovers from anon;
alter table public.rental_key_handovers enable row level security;

-- payg_accruals: Pay-as-you-go accruals shown on the customer invoice page.
drop policy if exists "allow_authenticated_read_payg" on public.payg_accruals;
drop policy if exists payg_accruals_staff on public.payg_accruals;
create policy payg_accruals_staff on public.payg_accruals for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists payg_accruals_service on public.payg_accruals;
create policy payg_accruals_service on public.payg_accruals for all to service_role using (true) with check (true);
drop policy if exists payg_accruals_customer on public.payg_accruals;
create policy payg_accruals_customer on public.payg_accruals for select to authenticated
  using (exists (select 1 from public.rentals r join public.customer_users cu on cu.customer_id = r.customer_id
            where r.id = payg_accruals.rental_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.payg_accruals from anon;
alter table public.payg_accruals enable row level security;

-- payg_reminder_log: PAYG reminder log, read alongside the accruals.
drop policy if exists "allow_authenticated_read_payg" on public.payg_reminder_log;
drop policy if exists payg_reminder_log_staff on public.payg_reminder_log;
create policy payg_reminder_log_staff on public.payg_reminder_log for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists payg_reminder_log_service on public.payg_reminder_log;
create policy payg_reminder_log_service on public.payg_reminder_log for all to service_role using (true) with check (true);
drop policy if exists payg_reminder_log_customer on public.payg_reminder_log;
create policy payg_reminder_log_customer on public.payg_reminder_log for select to authenticated
  using (exists (select 1 from public.rentals r join public.customer_users cu on cu.customer_id = r.customer_id
            where r.id = payg_reminder_log.rental_id and cu.auth_user_id = auth.uid()));
revoke delete, truncate on public.payg_reminder_log from anon;
alter table public.payg_reminder_log enable row level security;

-- chat_messages: the existing "Users can read their own chat messages" policy is already
--   correct (user_id = auth.uid() and the tenant matches). It only needs RLS switched on.
drop policy if exists chat_messages_staff on public.chat_messages;
create policy chat_messages_staff on public.chat_messages for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists chat_messages_service on public.chat_messages;
create policy chat_messages_service on public.chat_messages for all to service_role using (true) with check (true);
revoke delete, truncate on public.chat_messages from anon;
alter table public.chat_messages enable row level security;

-- customer_users: a person may read only their own link row.
drop policy if exists customer_users_staff on public.customer_users;
create policy customer_users_staff on public.customer_users for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists customer_users_service on public.customer_users;
create policy customer_users_service on public.customer_users for all to service_role using (true) with check (true);
drop policy if exists customer_users_self on public.customer_users;
create policy customer_users_self on public.customer_users for select to authenticated
  using (auth_user_id = auth.uid());
revoke delete, truncate on public.customer_users from anon;
alter table public.customer_users enable row level security;

-- ── C. The public booking site: only the reads it provably performs ─────────

-- agreement_templates: The booking site renders the agreement before signing.
drop policy if exists agreement_templates_staff on public.agreement_templates;
create policy agreement_templates_staff on public.agreement_templates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists agreement_templates_service on public.agreement_templates;
create policy agreement_templates_service on public.agreement_templates for all to service_role using (true) with check (true);
drop policy if exists agreement_templates_public on public.agreement_templates;
create policy agreement_templates_public on public.agreement_templates for select to anon using (true);
revoke delete, truncate on public.agreement_templates from anon;
alter table public.agreement_templates enable row level security;

-- blocked_dates: Availability calendar on the public booking widget.
drop policy if exists "Allow authenticated users to manage blocked dates" on public.blocked_dates;
drop policy if exists "Allow authenticated users to view blocked dates" on public.blocked_dates;
drop policy if exists "Allow public to view blocked dates" on public.blocked_dates;
drop policy if exists blocked_dates_staff on public.blocked_dates;
create policy blocked_dates_staff on public.blocked_dates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists blocked_dates_service on public.blocked_dates;
create policy blocked_dates_service on public.blocked_dates for all to service_role using (true) with check (true);
drop policy if exists blocked_dates_public on public.blocked_dates;
create policy blocked_dates_public on public.blocked_dates for select to anon using (true);
revoke delete, truncate on public.blocked_dates from anon;
alter table public.blocked_dates enable row level security;

-- pickup_locations: Location picker on the public booking widget.
drop policy if exists "Authenticated users can delete locations" on public.pickup_locations;
drop policy if exists "Authenticated users can select locations" on public.pickup_locations;
drop policy if exists "Authenticated users can update locations" on public.pickup_locations;
drop policy if exists pickup_locations_staff on public.pickup_locations;
create policy pickup_locations_staff on public.pickup_locations for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists pickup_locations_service on public.pickup_locations;
create policy pickup_locations_service on public.pickup_locations for all to service_role using (true) with check (true);
drop policy if exists pickup_locations_public on public.pickup_locations;
create policy pickup_locations_public on public.pickup_locations for select to anon using (true);
revoke delete, truncate on public.pickup_locations from anon;
alter table public.pickup_locations enable row level security;

-- promocodes: Promo code validation during checkout.
drop policy if exists promocodes_staff on public.promocodes;
create policy promocodes_staff on public.promocodes for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists promocodes_service on public.promocodes;
create policy promocodes_service on public.promocodes for all to service_role using (true) with check (true);
drop policy if exists promocodes_public on public.promocodes;
create policy promocodes_public on public.promocodes for select to anon using (true);
revoke delete, truncate on public.promocodes from anon;
alter table public.promocodes enable row level security;

-- vehicle_photos: Public fleet gallery.
drop policy if exists "Anyone can delete vehicle photos" on public.vehicle_photos;
drop policy if exists "Anyone can update vehicle photos" on public.vehicle_photos;
drop policy if exists "Anyone can view vehicle photos" on public.vehicle_photos;
drop policy if exists vehicle_photos_staff on public.vehicle_photos;
create policy vehicle_photos_staff on public.vehicle_photos for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists vehicle_photos_service on public.vehicle_photos;
create policy vehicle_photos_service on public.vehicle_photos for all to service_role using (true) with check (true);
drop policy if exists vehicle_photos_public on public.vehicle_photos;
create policy vehicle_photos_public on public.vehicle_photos for select to anon using (true);
revoke delete, truncate on public.vehicle_photos from anon;
alter table public.vehicle_photos enable row level security;

-- blocked_identities: Checkout checks a licence against the block list.
--   REVIEW: this publishes the block list itself. Stage 2 should move the check to a
--   server route and drop this policy.
drop policy if exists "Anon can check blocked identities" on public.blocked_identities;
drop policy if exists blocked_identities_staff on public.blocked_identities;
create policy blocked_identities_staff on public.blocked_identities for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists blocked_identities_service on public.blocked_identities;
create policy blocked_identities_service on public.blocked_identities for all to service_role using (true) with check (true);
drop policy if exists blocked_identities_public on public.blocked_identities;
create policy blocked_identities_public on public.blocked_identities for select to anon using (true);
revoke delete, truncate on public.blocked_identities from anon;
alter table public.blocked_identities enable row level security;

-- contact_requests: the public form writes; nobody anonymous reads.
drop policy if exists "allow_authenticated_contact_select" on public.contact_requests;
drop policy if exists "allow_authenticated_contact_update" on public.contact_requests;
drop policy if exists contact_requests_staff on public.contact_requests;
create policy contact_requests_staff on public.contact_requests for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists contact_requests_service on public.contact_requests;
create policy contact_requests_service on public.contact_requests for all to service_role using (true) with check (true);
drop policy if exists contact_requests_public_insert on public.contact_requests;
create policy contact_requests_public_insert on public.contact_requests for insert to anon with check (true);
revoke delete, truncate on public.contact_requests from anon;
alter table public.contact_requests enable row level security;

-- ── D. Policies named for the service role but granted to everyone ──────────
-- Each reads USING (true) with roles = {public}: every caller passes, including anon.

-- rental_damage_reports: Policy is named for the service role but granted to {public} with USING (true).
drop policy if exists "Service role can manage damage reports" on public.rental_damage_reports;
drop policy if exists rental_damage_reports_staff on public.rental_damage_reports;
create policy rental_damage_reports_staff on public.rental_damage_reports for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists rental_damage_reports_service on public.rental_damage_reports;
create policy rental_damage_reports_service on public.rental_damage_reports for all to service_role using (true) with check (true);
revoke delete, truncate on public.rental_damage_reports from anon;
alter table public.rental_damage_reports enable row level security;

-- lockbox_send_log: Same.
drop policy if exists "Service role can manage lockbox send logs" on public.lockbox_send_log;
drop policy if exists lockbox_send_log_staff on public.lockbox_send_log;
create policy lockbox_send_log_staff on public.lockbox_send_log for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists lockbox_send_log_service on public.lockbox_send_log;
create policy lockbox_send_log_service on public.lockbox_send_log for all to service_role using (true) with check (true);
revoke delete, truncate on public.lockbox_send_log from anon;
alter table public.lockbox_send_log enable row level security;

-- voicemail_recordings: Same.
drop policy if exists "Service role manages voicemails" on public.voicemail_recordings;
drop policy if exists voicemail_recordings_staff on public.voicemail_recordings;
create policy voicemail_recordings_staff on public.voicemail_recordings for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists voicemail_recordings_service on public.voicemail_recordings;
create policy voicemail_recordings_service on public.voicemail_recordings for all to service_role using (true) with check (true);
revoke delete, truncate on public.voicemail_recordings from anon;
alter table public.voicemail_recordings enable row level security;

-- whatsapp_content_templates: Same.
drop policy if exists "Service role can manage templates" on public.whatsapp_content_templates;
drop policy if exists whatsapp_content_templates_staff on public.whatsapp_content_templates;
create policy whatsapp_content_templates_staff on public.whatsapp_content_templates for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists whatsapp_content_templates_service on public.whatsapp_content_templates;
create policy whatsapp_content_templates_service on public.whatsapp_content_templates for all to service_role using (true) with check (true);
revoke delete, truncate on public.whatsapp_content_templates from anon;
alter table public.whatsapp_content_templates enable row level security;

-- customer_review_summaries: Same.
drop policy if exists "Service role can manage summaries" on public.customer_review_summaries;
drop policy if exists customer_review_summaries_staff on public.customer_review_summaries;
create policy customer_review_summaries_staff on public.customer_review_summaries for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists customer_review_summaries_service on public.customer_review_summaries;
create policy customer_review_summaries_service on public.customer_review_summaries for all to service_role using (true) with check (true);
revoke delete, truncate on public.customer_review_summaries from anon;
alter table public.customer_review_summaries enable row level security;

-- ── E. Website content: RLS is on already, but writes are unscoped ──────────
-- Anonymous READ policies are deliberately left in place. Only the blanket
-- "any authenticated user can do anything" policies are replaced.

-- blog_posts: Today any signed-in user of any tenant can edit another account’s blog.
drop policy if exists "Authenticated full access blog posts" on public.blog_posts;
drop policy if exists blog_posts_staff on public.blog_posts;
create policy blog_posts_staff on public.blog_posts for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists blog_posts_service on public.blog_posts;
create policy blog_posts_service on public.blog_posts for all to service_role using (true) with check (true);
alter table public.blog_posts enable row level security;

-- blog_categories: Same.
-- kept: "Anon can read blog categories" (public read)
drop policy if exists "Authenticated full access blog categories" on public.blog_categories;
drop policy if exists blog_categories_staff on public.blog_categories;
create policy blog_categories_staff on public.blog_categories for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists blog_categories_service on public.blog_categories;
create policy blog_categories_service on public.blog_categories for all to service_role using (true) with check (true);
alter table public.blog_categories enable row level security;

-- blog_post_versions: Same.
drop policy if exists "Authenticated full access blog versions" on public.blog_post_versions;
drop policy if exists blog_post_versions_staff on public.blog_post_versions;
create policy blog_post_versions_staff on public.blog_post_versions for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists blog_post_versions_service on public.blog_post_versions;
create policy blog_post_versions_service on public.blog_post_versions for all to service_role using (true) with check (true);
alter table public.blog_post_versions enable row level security;

-- cms_media: Anonymous read kept; writes become tenant-scoped.
-- kept: "cms_media_anon_read" (public read)
drop policy if exists cms_media_staff on public.cms_media;
create policy cms_media_staff on public.cms_media for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists cms_media_service on public.cms_media;
create policy cms_media_service on public.cms_media for all to service_role using (true) with check (true);
alter table public.cms_media enable row level security;

-- gig_driver_images: Anonymous read kept; writes become tenant-scoped.
-- kept: "Anon can view gig driver images" (public read)
drop policy if exists gig_driver_images_staff on public.gig_driver_images;
create policy gig_driver_images_staff on public.gig_driver_images for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists gig_driver_images_service on public.gig_driver_images;
create policy gig_driver_images_service on public.gig_driver_images for all to service_role using (true) with check (true);
alter table public.gig_driver_images enable row level security;

-- promotions: Anonymous read kept; writes become tenant-scoped.
-- kept: "promotions_anon_read" (public read)
drop policy if exists promotions_staff on public.promotions;
create policy promotions_staff on public.promotions for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists promotions_service on public.promotions;
create policy promotions_service on public.promotions for all to service_role using (true) with check (true);
alter table public.promotions enable row level security;

-- testimonials: Anonymous read kept; writes become tenant-scoped.
-- kept: "testimonials_anon_read" (public read)
drop policy if exists testimonials_staff on public.testimonials;
create policy testimonials_staff on public.testimonials for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists testimonials_service on public.testimonials;
create policy testimonials_service on public.testimonials for all to service_role using (true) with check (true);
alter table public.testimonials enable row level security;

-- tenant_holidays: Public read kept; writes become tenant-scoped.
drop policy if exists "Public can view tenant holidays for booking" on public.tenant_holidays;
drop policy if exists tenant_holidays_staff on public.tenant_holidays;
create policy tenant_holidays_staff on public.tenant_holidays for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin()) with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists tenant_holidays_service on public.tenant_holidays;
create policy tenant_holidays_service on public.tenant_holidays for all to service_role using (true) with check (true);
alter table public.tenant_holidays enable row level security;

-- ── F. Leftover one-off tables: server access only ───────────────────
-- These hold copies of live rows and are readable by the anonymous key today.
-- Confirm they are obsolete and drop them; until then, close them.

-- _backfill_iv_link_20260817: One-off backfill table from 2026-08-17.
drop policy if exists _backfill_iv_link_20260817_service on public._backfill_iv_link_20260817;
create policy _backfill_iv_link_20260817_service on public._backfill_iv_link_20260817 for all to service_role using (true) with check (true);
revoke select, insert, update, delete, truncate on public._backfill_iv_link_20260817 from anon, authenticated;
alter table public._backfill_iv_link_20260817 enable row level security;

-- _recover_orphan_customers_20260817: One-off recovery table from 2026-08-17.
drop policy if exists _recover_orphan_customers_20260817_service on public._recover_orphan_customers_20260817;
create policy _recover_orphan_customers_20260817_service on public._recover_orphan_customers_20260817 for all to service_role using (true) with check (true);
revoke select, insert, update, delete, truncate on public._recover_orphan_customers_20260817 from anon, authenticated;
alter table public._recover_orphan_customers_20260817 enable row level security;

-- zz_tenant_subscriptions_bak_20260727: Backup copy of tenant_subscriptions from 2026-07-27.
drop policy if exists zz_tenant_subscriptions_bak_20260727_service on public.zz_tenant_subscriptions_bak_20260727;
create policy zz_tenant_subscriptions_bak_20260727_service on public.zz_tenant_subscriptions_bak_20260727 for all to service_role using (true) with check (true);
revoke select, insert, update, delete, truncate on public.zz_tenant_subscriptions_bak_20260727 from anon, authenticated;
alter table public.zz_tenant_subscriptions_bak_20260727 enable row level security;

-- ── Verification ───────────────────────────────────────────
-- No tenant-scoped table should be left with RLS off:
--   select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--     join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and a.attnum>0
--    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
-- No policy should admit everyone:
--   select tablename, policyname, roles::text from pg_policies where schemaname='public'
--     and (qual='true' or qual ilike '%auth.uid() IS NOT NULL%')
--     and roles::text not like '%service_role}%';

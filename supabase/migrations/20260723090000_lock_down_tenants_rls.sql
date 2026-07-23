-- Lock down public.tenants: close the unauthenticated read of secret columns.
--
-- ROOT CAUSE (Twilio suspension): RLS was DISABLED on tenants while the 'anon'
-- role held a TABLE-LEVEL SELECT grant. The anon key ships in every public client
-- bundle, so any website visitor could read plaintext secrets (twilio_auth_token,
-- twilio_api_key_secret, bonzah_password, etc.) via PostgREST. Scraped tokens were
-- used to abuse the Twilio accounts.
--
-- WHY column-level REVOKE alone is insufficient: in PostgreSQL a column read is
-- authorized by (table-level SELECT) OR (column-level SELECT). Revoking the column
-- grant while the table grant remains is a NO-OP. The only correct fix is to revoke
-- the table-level SELECT and re-grant SELECT on an explicit allow-list of the
-- non-secret columns. Verified in-transaction before applying.
--
-- NOTE: this hides secrets from 'anon' only. 'authenticated' still holds table SELECT
-- (revoking it breaks 5 select('*') sites in portal/admin — tracked as Phase 2).
BEGIN;

-- 1. anon read secrecy: drop table-level SELECT, re-grant the 225 non-secret columns.
REVOKE SELECT ON public.tenants FROM anon;
REVOKE SELECT (
  twilio_auth_token, twilio_api_key_secret, bonzah_password,
  meta_whatsapp_access_token, master_password_hash,
  tesla_fleet_api_token_secret_id, tesla_fleet_refresh_token_secret_id
) ON public.tenants FROM anon;
GRANT SELECT (id, slug, company_name, status, created_at, updated_at, contact_email, contact_phone, subscription_plan, trial_ends_at, app_name, primary_color, secondary_color, accent_color, light_primary_color, light_secondary_color, light_accent_color, light_background_color, dark_primary_color, dark_secondary_color, dark_accent_color, dark_background_color, light_header_footer_color, dark_header_footer_color, logo_url, favicon_url, meta_title, meta_description, og_image_url, hero_background_url, phone, address, business_hours, google_maps_url, facebook_url, instagram_url, twitter_url, linkedin_url, currency_code, timezone, date_format, min_rental_days, max_rental_days, booking_lead_time_hours, require_identity_verification, require_insurance_upload, payment_mode, stripe_account_id, stripe_onboarding_complete, stripe_account_status, admin_email, pickup_location_mode, return_location_mode, fixed_pickup_address, fixed_return_address, minimum_rental_age, tenant_type, admin_name, integration_canopy, integration_veriff, integration_bonzah, tax_enabled, tax_percentage, service_fee_enabled, service_fee_amount, deposit_mode, global_deposit_amount, pickup_area_radius_km, return_area_radius_km, area_center_lat, area_center_lon, working_hours_enabled, working_hours_open, working_hours_close, working_hours_always_open, service_fee_type, service_fee_value, stripe_mode, monday_enabled, monday_open, monday_close, tuesday_enabled, tuesday_open, tuesday_close, wednesday_enabled, wednesday_open, wednesday_close, thursday_enabled, thursday_open, thursday_close, friday_enabled, friday_open, friday_close, saturday_enabled, saturday_open, saturday_close, sunday_enabled, sunday_open, sunday_close, delivery_enabled, collection_enabled, installments_enabled, installment_config, fixed_address_enabled, multiple_locations_enabled, area_around_enabled, area_delivery_fee, pickup_fixed_enabled, return_fixed_enabled, pickup_multiple_locations_enabled, return_multiple_locations_enabled, pickup_area_enabled, return_area_enabled, bonzah_mode, bonzah_username, distance_unit, stripe_subscription_customer_id, subscription_stripe_mode, setup_completed_at, dark_logo_url, lockbox_enabled, lockbox_code_length, lockbox_notification_methods, booking_lead_time_unit, privacy_policy_version, terms_version, weekend_surcharge_percent, weekend_days, policies_accepted_at, boldsign_live_brand_id, lockbox_default_instructions, min_rental_hours, boldsign_mode, boldsign_test_brand_id, auth_logo_url, twilio_account_sid, twilio_phone_number, twilio_phone_number_sid, integration_twilio_sms, meta_whatsapp_waba_id, meta_whatsapp_phone_number_id, meta_whatsapp_phone_number, integration_whatsapp, maintenance_banner_enabled, maintenance_banner_message, accepted_verification_document, security_deposit_enabled, verification_document_type, monthly_tier_days, twilio_messaging_service_sid, custom_booking_domain, custom_portal_domain, integration_tesla_fleet, tesla_fleet_token_expires_at, lockbox_send_offset_minutes, buffer_time_minutes, return_reminder_enabled, return_reminder_hours, twilio_twiml_app_sid, twilio_api_key_sid, twilio_voice_enabled, twilio_voice_webhook_configured, pay_as_you_go_enabled, twilio_whatsapp_number, integration_twilio_whatsapp, twilio_whatsapp_lockbox_template_sid, bonzah_brochure_url, blog_enabled, twilio_connection_verified_at, payg_reminder_interval_days, payg_grace_period_days, payg_max_reminders, payg_preauth_days, payg_max_duration_days, call_forwarding_enabled, voicemail_enabled, voicemail_greeting_url, forwarding_number, call_recording_enabled, payg_auto_reminders_enabled, enquiries_enabled, forwarding_caller_id_mode, payg_accrual_window_seconds, payg_upfront_required, lead_management_enabled, automations_enabled, lead_stale_threshold_hours, lead_auto_lost_threshold_hours, communication_tone, ai_monthly_quota, cross_tenant_blacklist_enabled, vehicle_owners_enabled, integration_xero, integration_zoho_books, auto_extend_enabled, auto_extend_default_charge_mode, auto_extend_default_lead_hours, auto_extend_grace_hours, auto_extend_max_retries, revenue_optimiser_enabled, delivery_tiers_enabled, delivery_distance_tiers, subscription_gate_disabled, delivery_max_distance_km, gig_driver_enabled, payment_model, subscription_account, own_stripe_account_id, own_stripe_test_account_id, own_stripe_connected_at, own_stripe_test_connected_at, subscription_billing_anchor, email_notifications_enabled, notification_recipient_email, stack_surcharges, migration_blocker, migration_blocker_dismissed_at, migration_blocker_dismiss_count, migration_reward_granted_at, stripe_charges_enabled, stripe_payouts_enabled, stripe_account_disabled_reason, stripe_requirements_due, stripe_status_synced_at, uae_customer_id) ON public.tenants TO anon;

-- 2. anon has no legitimate write path to tenants; remove all write privileges.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.tenants FROM anon;
REVOKE TRUNCATE ON public.tenants FROM authenticated;

-- 3. Enable RLS (do NOT force -> service_role keeps bypassing).
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 4. Drop the "any logged-in user can insert/delete any tenant" holes.
--    super_admin_manage_tenants (ALL, is_super_admin) + tenants_update_own_or_super remain.
DROP POLICY IF EXISTS "allow_all_tenants_insert" ON public.tenants;
DROP POLICY IF EXISTS "allow_all_tenants_delete" ON public.tenants;

-- 5. Zero-regression row visibility (secrecy enforced by column grants, not row filter).
DROP POLICY IF EXISTS "tenants_public_select" ON public.tenants;
CREATE POLICY "tenants_public_select" ON public.tenants
  FOR SELECT TO anon, authenticated USING (true);

COMMIT;

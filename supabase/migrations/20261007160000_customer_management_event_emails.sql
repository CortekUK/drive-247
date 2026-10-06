-- =============================================================================
-- APPLIED to production 2026-10-07 via the Management API.
--
-- Two confirmation emails in the signup sequence, sent ONCE, within ~30s of
-- the thing happening (customer-management-run, EVENT_SEND_IF):
--
--   stripe_connected  "Stripe is connected — you can take payments"
--   bonzah_active     "Bonzah insurance is active"
--
-- Companies for which the condition is ALREADY true are filed as skipped
-- (`already_true_at_launch`) so the first tick does not congratulate every
-- operator who connected months ago. The send log's unique key
-- (tenant, automation, step_key, cycle_key) is what keeps them from ever being
-- sent; rehearsal sends use test-prefixed keys and are unaffected.
-- =============================================================================

BEGIN;

ALTER TABLE public.customer_management_steps
  DROP CONSTRAINT IF EXISTS customer_management_steps_send_if_check;
ALTER TABLE public.customer_management_steps
  ADD CONSTRAINT customer_management_steps_send_if_check
  CHECK (send_if IN ('stripe_not_connected', 'bonzah_form_not_submitted', 'stripe_connected', 'bonzah_active'));

INSERT INTO public.customer_management_steps
  (automation, step_key, label, offset_days, subject, body_html, enabled, sort_order, send_if, repeat_every_days)
VALUES
  ('signup', 'signup_stripe_connected', 'Stripe connected (sent when it happens)', 0,
   '{{tenant_name}}: Stripe is connected — you can take payments',
   E'Hi {{tenant_admin_name}},\n\nGood news: Stripe is now connected to {{tenant_name}}.\n\nYou can take payments from your customers when they book, and the money goes straight to your Stripe account.\n\nYour website, where customers book: {{booking_url}}\n\nYour portal: {{portal_url}}\n\nIf you need help, just reply to this email.\n\nThe Drive247 team',
   true, 23, 'stripe_connected', NULL),
  ('signup', 'signup_bonzah_active', 'Bonzah active (sent when it happens)', 0,
   '{{tenant_name}}: Bonzah insurance is active',
   E'Hi {{tenant_admin_name}},\n\nGood news: Bonzah insurance is now active for {{tenant_name}}.\n\nYour customers can add insurance to their rental when they book, right on your website: {{booking_url}}\n\nYou can see the policies in your portal: {{portal_url}}\n\nIf you need help, just reply to this email.\n\nThe Drive247 team',
   true, 24, 'bonzah_active', NULL)
ON CONFLICT DO NOTHING;

-- Already true today: file as skipped so they are never sent.
INSERT INTO public.customer_management_sends
  (tenant_id, automation, step_key, cycle_key, due_at, status, detail, test_mode)
SELECT t.id, 'signup', 'signup_stripe_connected', 'once', now(), 'skipped', 'already_true_at_launch', false
FROM public.tenants t
WHERE t.own_stripe_account_id IS NOT NULL
   OR t.own_stripe_test_account_id IS NOT NULL
   OR (t.stripe_onboarding_complete AND t.stripe_account_status = 'active')
ON CONFLICT DO NOTHING;

INSERT INTO public.customer_management_sends
  (tenant_id, automation, step_key, cycle_key, due_at, status, detail, test_mode)
SELECT t.id, 'signup', 'signup_bonzah_active', 'once', now(), 'skipped', 'already_true_at_launch', false
FROM public.tenants t
WHERE t.integration_bonzah AND t.bonzah_username IS NOT NULL AND t.bonzah_mode = 'live'
ON CONFLICT DO NOTHING;

COMMIT;

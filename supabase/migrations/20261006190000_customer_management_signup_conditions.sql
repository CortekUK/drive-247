-- Signup Sequences: setup-driven emails.
--
-- Day 0 welcomes the operator with their portal and website links and the two
-- things to do first: connect Stripe and submit the Bonzah form.
--
-- Day 7 is two emails, each sent only if that thing is still not done, checked
-- by the runner at the moment the step comes due:
--   stripe_not_connected       -> Stripe Connect is not connected
--   bonzah_form_not_submitted  -> no pending or approved Bonzah form
-- Submitting the Bonzah form is NOT the same as Bonzah being connected (that
-- happens after Bonzah approves it), and the day-7 email is only about the form.
--
-- The old generic "Day 7 — Check-in" is switched off, not deleted, so its send
-- history stays readable and it can be turned back on from the admin page.

ALTER TABLE public.customer_management_steps
  ADD COLUMN IF NOT EXISTS send_if text
  CHECK (send_if IN ('stripe_not_connected', 'bonzah_form_not_submitted'));

COMMENT ON COLUMN public.customer_management_steps.send_if IS
  'Optional condition checked when the step is due; the step is skipped (and logged) when it does not hold. NULL = always send.';

UPDATE public.customer_management_steps
SET subject = 'Welcome to Drive247, {{tenant_name}}',
    body_html = $body$Hi {{tenant_admin_name}},

Welcome to Drive247. Your account for {{tenant_name}} is ready.

Your portal (where you run your business): {{portal_url}}

Your website (share it with customers so they can book): {{booking_url}}

Two things to do first:
- Connect Stripe, so you can take payments from your customers: {{stripe_connect_url}}
- Fill in and submit the Bonzah form, so you can offer insurance on your rentals: {{bonzah_form_url}}

You sign in with {{sign_in_email}}. If you need help, just reply to this email.

The Drive247 team$body$,
    updated_at = now()
WHERE automation = 'signup' AND step_key = 'signup_day_0_welcome';

UPDATE public.customer_management_steps
SET enabled = false, updated_at = now()
WHERE automation = 'signup' AND step_key = 'signup_day_7_checkin';

INSERT INTO public.customer_management_steps
  (automation, step_key, label, offset_days, subject, body_html, enabled, sort_order, send_if)
VALUES
  ('signup', 'signup_day_7_connect_stripe', 'Day 7 — Connect Stripe (only if not connected)', 7,
   '{{tenant_name}}: connect Stripe to take payments',
   $body$Hi {{tenant_admin_name}},

It has been a week since you joined Drive247, and Stripe is not connected to {{tenant_name}} yet.

Until it is, you cannot take payments from your customers for their bookings.

Connect Stripe here — it takes a few minutes: {{stripe_connect_url}}

If you need help, just reply to this email.

The Drive247 team$body$,
   true, 21, 'stripe_not_connected'),
  ('signup', 'signup_day_7_bonzah_form', 'Day 7 — Submit Bonzah form (only if not submitted)', 7,
   '{{tenant_name}}: submit your Bonzah form',
   $body$Hi {{tenant_admin_name}},

It has been a week since you joined Drive247, and we have not received the Bonzah form for {{tenant_name}} yet.

Bonzah lets you offer insurance to your customers when they book. Once you submit the form, Bonzah reviews it and switches insurance on for you.

Fill in and submit the form here: {{bonzah_form_url}}

If you need help, just reply to this email.

The Drive247 team$body$,
   true, 22, 'bonzah_form_not_submitted')
ON CONFLICT (automation, step_key) DO NOTHING;

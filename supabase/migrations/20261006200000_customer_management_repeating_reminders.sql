-- Signup Sequences: the setup reminders repeat until the operator does them.
--
-- `repeat_every_days` on a conditional step: first on `offset_days`, then
-- every N days while the condition still holds — 3 and 3 give day 3, 6, 9, ...
-- NULL = send once. The runner ignores it on a step with no `send_if`, because
-- an unconditional repeat would never stop.
--
-- `created_at` lets the runner keep the reminders to companies that sign up
-- AFTER a reminder exists, so switching on "all tenants" does not start
-- mailing every older account every few days.
--
-- The "Day 7 — Check-in" and "Day 14 — Next steps" emails are removed. Their
-- rows in customer_management_sends stay as history (no foreign key).

ALTER TABLE public.customer_management_steps
  ADD COLUMN IF NOT EXISTS repeat_every_days integer
    CHECK (repeat_every_days IS NULL OR repeat_every_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.customer_management_steps.repeat_every_days IS
  'Conditional steps only: send again every N days until send_if stops holding. NULL = once.';

DELETE FROM public.customer_management_steps
WHERE automation = 'signup'
  AND step_key IN ('signup_day_7_checkin', 'signup_day_14_next_steps');

UPDATE public.customer_management_steps
SET label = 'Connect Stripe reminder (until connected)',
    offset_days = 3,
    repeat_every_days = 3,
    body_html = $body$Hi {{tenant_admin_name}},

Stripe is not connected to {{tenant_name}} yet.

Until it is, you cannot take payments from your customers for their bookings.

Connect Stripe here — it takes a few minutes: {{stripe_connect_url}}

If you need help, just reply to this email.

The Drive247 team$body$,
    updated_at = now()
WHERE automation = 'signup' AND step_key = 'signup_day_7_connect_stripe';

UPDATE public.customer_management_steps
SET label = 'Bonzah form reminder (until submitted)',
    offset_days = 3,
    repeat_every_days = 3,
    body_html = $body$Hi {{tenant_admin_name}},

We have not received the Bonzah form for {{tenant_name}} yet.

Bonzah lets you offer insurance to your customers when they book. Once you submit the form, Bonzah reviews it and switches insurance on for you.

Fill in and submit the form here: {{bonzah_form_url}}

If you need help, just reply to this email.

The Drive247 team$body$,
    updated_at = now()
WHERE automation = 'signup' AND step_key = 'signup_day_7_bonzah_form';

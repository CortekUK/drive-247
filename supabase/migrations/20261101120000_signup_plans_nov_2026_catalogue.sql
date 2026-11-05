-- APPLIED to production 2026-11-01.
-- The Nov 2026 self-serve catalogue: Starter / Growth (Most popular) / Scale,
-- each with a 14-day free trial, and the contact-only Enterprise card.
--
-- CONTENT ONLY. No amount_cents and no stripe_price_id is touched here: a price
-- change must mint a Stripe Price first (manage-signup-plans → update-price),
-- so Growth's move to $229 is done from the admin Signup Plans page.
-- Keyed by plan_key so it is a no-op on an environment without these rows.

BEGIN;

-- At most one highlighted row (signup_plans_one_highlighted): clear first.
UPDATE public.signup_plans SET is_highlighted = false
 WHERE is_highlighted AND plan_key <> 'growth_2';

UPDATE public.signup_plans SET
  name = 'Starter',
  fleet_band = '1–5 vehicles',
  max_vehicles = 5,
  tagline = 'Everything you need to launch your rental business.',
  bullets = jsonb_build_array(
    'Up to 5 vehicles',
    'Your own branded rental website',
    'Unlimited bookings and customer records',
    'Full rental management platform',
    'Unlimited staff accounts',
    'Free 30-minute onboarding session',
    'Standard support'
  ),
  trial_days = 14,
  sort_order = 4
WHERE plan_key = 'starter_2';

UPDATE public.signup_plans SET
  name = 'Growth',
  fleet_band = '6–20 vehicles',
  max_vehicles = 20,
  tagline = 'Built for growing rental businesses ready to take the next step.',
  bullets = jsonb_build_array(
    'Everything in Starter',
    'Up to 20 vehicles',
    'Unlimited bookings and customer records',
    'Unlimited staff accounts',
    'Free 30-minute onboarding session',
    'Priority customer support',
    'Dedicated Slack support available for $69/month'
  ),
  trial_days = 14,
  is_highlighted = true,
  sort_order = 5
WHERE plan_key = 'growth_2';

UPDATE public.signup_plans SET
  name = 'Scale',
  fleet_band = '21–50 vehicles',
  max_vehicles = 50,
  tagline = 'More vehicles. More support. Complete control.',
  bullets = jsonb_build_array(
    'Everything in Growth',
    'Up to 50 vehicles',
    'Unlimited bookings and customer records',
    'Unlimited staff accounts',
    'Free 30-minute onboarding session',
    'Priority customer support',
    'Dedicated private Slack support channel included'
  ),
  trial_days = 14,
  sort_order = 6
WHERE plan_key = 'scale_2';

-- Every admin_settings row, so whichever one a reader picks says the same.
UPDATE public.admin_settings SET enterprise_card = jsonb_build_object(
  'name', 'Enterprise',
  'fleet_band', '51+ vehicles',
  'price_label', 'Let''s talk',
  'tagline', 'Tailored solutions for larger rental operations.',
  'cta_label', 'Contact Sales',
  'cta_href', COALESCE(enterprise_card->>'cta_href', '/strategy-call'),
  'bullets', jsonb_build_array(
    '51+ vehicles',
    'Full Drive247 platform',
    'Custom pricing and contract terms',
    'Assisted onboarding and data migration',
    'Dedicated Slack support',
    'Named account contact'
  ),
  'is_visible', true
);

COMMIT;

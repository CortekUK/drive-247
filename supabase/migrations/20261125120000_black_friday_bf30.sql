-- Black Friday 2026: BF30, 30% off the first 3 monthly payments (Neema, 24 Nov 2026).
--
-- Set up like DRIVE20 / WELCOME20: a campaign code, percent, repeating 3 months.
-- signup-payment-intent-v2 mints its Stripe coupon per plan product on first
-- use (ensureCodeCoupon), stretched over the 14-day trial so the discount
-- starts on the first PAID invoice, and limited to new operators
-- (checkCodeUsable: anyone who ever held a real subscription is refused).
-- All three plans: no plan restriction, so it survives a plan switch.
--
-- Expires Mon 30 Nov 2026, 11:59:59pm Eastern = Tue 1 Dec 2026 04:59:59 UTC,
-- the same instant as BLACK_FRIDAY_END in apps/web/src/lib/black-friday.ts.
-- People who signed up before then keep their 30% for their 3 months: Stripe
-- holds the coupon on their subscription.
--
-- Idempotent: running it twice (staging, then production) adds one row.

insert into public.platform_promo_codes
  (code, kind, discount_type, discount_value, currency, duration, duration_months,
   max_redemptions, expires_at, restrict_signup_plan_keys, status, note)
select
  'BF30', 'campaign', 'percent', 30, 'usd', 'repeating', 3,
  null, '2026-12-01T04:59:59Z', null, 'active',
  'Black Friday 2026: 30% off the first 3 monthly payments, new accounts only. Auto-applied on drive-247.com 25 Nov to 30 Nov 11:59pm ET.'
where not exists (select 1 from public.platform_promo_codes where upper(code) = 'BF30');

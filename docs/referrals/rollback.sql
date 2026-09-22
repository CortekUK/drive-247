-- Undo the referral programme's database changes.
--
-- Only for backing the feature out: it deletes every code, referral, redemption
-- and saving. Discounts already attached to Stripe subscriptions stay on them
-- (remove those in Stripe, or with the admin discount tool, first).
--
-- The engine's cron job goes first so nothing runs mid-drop.

SELECT cron.unschedule('referral-engine');

ALTER TABLE public.subscription_links DROP COLUMN IF EXISTS promo_code_id;
ALTER TABLE public.contact_requests   DROP COLUMN IF EXISTS promo_code;

DROP TABLE IF EXISTS public.promo_code_lookup_attempts;
DROP TABLE IF EXISTS public.referral_claims;
DROP TABLE IF EXISTS public.referral_events;
DROP TABLE IF EXISTS public.referral_subscription_scans;
DROP TABLE IF EXISTS public.referral_savings;
DROP TABLE IF EXISTS public.referral_tier_state;
DROP TABLE IF EXISTS public.referrals;
DROP TABLE IF EXISTS public.promo_code_redemptions;
DROP TABLE IF EXISTS public.platform_promo_code_stripe;
DROP TABLE IF EXISTS public.platform_promo_codes;
DROP TABLE IF EXISTS public.tenant_referral_settings;
DROP TABLE IF EXISTS public.referral_tiers;
DROP TABLE IF EXISTS public.referral_program_settings;

DROP TYPE IF EXISTS public.referral_claim_status;
DROP TYPE IF EXISTS public.stripe_mode_t;
DROP TYPE IF EXISTS public.stripe_platform_acct;
DROP TYPE IF EXISTS public.referral_status;
DROP TYPE IF EXISTS public.referral_source;
DROP TYPE IF EXISTS public.promo_code_status;
DROP TYPE IF EXISTS public.promo_duration;
DROP TYPE IF EXISTS public.promo_discount_type;
DROP TYPE IF EXISTS public.promo_code_kind;

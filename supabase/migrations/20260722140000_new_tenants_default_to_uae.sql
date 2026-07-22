-- New clients are born on the UAE account, on the Own Stripe model.
--
-- Segment 1 of the migration: anyone signing up from now on should never touch
-- the legacy platform at all. Changing the column DEFAULTs only affects rows
-- inserted from here on — every existing tenant keeps its current values, so
-- segments 2 (not yet trading) and 3 (already live) are untouched and continue
-- to be migrated deliberately, one at a time.
--
--   subscription_account: 'uk'      -> 'uae'   (SaaS billing + credits)
--   payment_model:        'managed' -> 'own'   (operator connects their own
--                                               Stripe via OAuth instead of us
--                                               creating an Express account)

ALTER TABLE public.tenants
  ALTER COLUMN subscription_account SET DEFAULT 'uae',
  ALTER COLUMN payment_model SET DEFAULT 'own';

COMMENT ON COLUMN public.tenants.subscription_account IS 'Platform Stripe account billing this tenant''s SaaS subscription: uae (default for new tenants) or uk (legacy, being migrated)';
COMMENT ON COLUMN public.tenants.payment_model IS 'own = operator-owned Standard account via OAuth (default for new tenants); managed = legacy platform-created Express account';

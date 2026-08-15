-- Per-platform-account Stripe Customer ids (Own Stripe / UAE migration)
--
-- `customers.stripe_customer_id` is a single shared column, but a Stripe
-- Customer is scoped to ONE platform account (uk vs uae). The old code
-- re-minted and overwrote that column on the first charge under a tenant's new
-- account, clobbering the id for the account they still had live rentals on.
-- Split the id per account so uk and uae ids coexist and neither clobbers the
-- other. Resolution/validation is self-healing at runtime (see
-- supabase/functions/_shared/customer-account.ts), so this backfill only has to
-- cover the deterministically-safe case.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS stripe_customer_id_uk  text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id_uae text;

-- Deterministic backfill: every customer under a tenant that is STILL on the
-- managed (UK) model has only ever transacted on the UK account, so its stored
-- id is a UK id. Customers under 'own' tenants are ambiguous (the id may have
-- been minted on UK before the flip or on UAE after) and are deliberately left
-- for the runtime resolver to validate-and-adopt on first use.
UPDATE public.customers c
SET stripe_customer_id_uk = c.stripe_customer_id
FROM public.tenants t
WHERE t.id = c.tenant_id
  AND t.payment_model = 'managed'
  AND c.stripe_customer_id IS NOT NULL
  AND c.stripe_customer_id_uk IS NULL;

COMMENT ON COLUMN public.customers.stripe_customer_id_uk  IS 'Stripe Customer id on the legacy UK ("Cortek US") platform account.';
COMMENT ON COLUMN public.customers.stripe_customer_id_uae IS 'Stripe Customer id on the self-owned UAE ("CORTEKIA") platform account.';
COMMENT ON COLUMN public.customers.stripe_customer_id IS 'DEPRECATED shared id, frozen. Use stripe_customer_id_uk / _uae via _shared/customer-account.ts.';

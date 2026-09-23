-- ============================================================================
-- Drive247 platform promo codes — where a code rides along before checkout.
--
-- Two NULLABLE columns on existing tables (V2_PLAN §4: allowed — v1's inserts
-- never mention them, so they keep succeeding). No default, no NOT NULL, no
-- trigger, no change to any existing column.
--
--   subscription_links.promo_code_id
--       The code sales pre-applied when creating a payment link. Part of the
--       link's frozen snapshot: redemption uses exactly this code.
--
--   contact_requests.promo_code
--       The code a lead arrived with (from the referral link's cookie), so
--       sales sees "Came via SUNSET-4821" and it pre-fills the payment link.
--       Plain text on purpose: it is what the visitor carried, recorded before
--       anyone has checked it, and a lead must still save if the code is bad.
--
-- Apply after 20260922120000_platform_promo_codes.sql, via the Supabase MCP /
-- Management API. NEVER `supabase db push`.
-- ============================================================================

ALTER TABLE public.subscription_links
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES public.platform_promo_codes(id);

ALTER TABLE public.contact_requests
  ADD COLUMN IF NOT EXISTS promo_code text;

NOTIFY pgrst, 'reload schema';

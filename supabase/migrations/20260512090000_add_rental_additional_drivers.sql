-- Additional drivers on rentals.
--
-- Some rentals (typically long-term) authorise a second driver — often a
-- spouse or family member. They appear on the agreement (insurance only
-- covers drivers listed on it), and they sign as a secondary signer in
-- BoldSign. Their ID is verified the same way as the primary customer
-- (Veriff or local AI upload) but the row is per-rental, NOT promoted to
-- a `customers` row — they are a driver on this rental, not a tenant
-- customer in their own right.
--
-- One additional driver per email per rental is enforced via the unique
-- partial index. The CHECK ensures we always have at least one contact
-- channel for sending verification + signing links.

CREATE TABLE IF NOT EXISTS public.rental_additional_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),

  -- Identity
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  license_number TEXT,  -- filled by the driver via the verification flow

  -- Verification
  identity_verification_id UUID REFERENCES public.identity_verifications(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  verification_url TEXT,  -- cached Veriff session URL for resend convenience

  -- Signing
  signing_status TEXT NOT NULL DEFAULT 'not_sent'
    CHECK (signing_status IN ('not_sent', 'sent', 'signed', 'declined')),
  boldsign_signer_email TEXT,  -- echoed back for webhook matching
  signed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT must_have_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_rental_additional_drivers_rental
  ON public.rental_additional_drivers(rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_additional_drivers_tenant
  ON public.rental_additional_drivers(tenant_id);
-- Same email cannot be added twice to the same rental; NULL emails are
-- not constrained (an additional driver with phone-only is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_additional_drivers_unique_email_per_rental
  ON public.rental_additional_drivers(rental_id, email)
  WHERE email IS NOT NULL;

-- Keep updated_at in sync with row mutations.
CREATE OR REPLACE FUNCTION public.set_rental_additional_drivers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rental_additional_drivers_updated_at
  ON public.rental_additional_drivers;
CREATE TRIGGER trg_rental_additional_drivers_updated_at
  BEFORE UPDATE ON public.rental_additional_drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_rental_additional_drivers_updated_at();

-- RLS: portal staff in the same tenant can read; super admins read everything;
-- all mutations go through edge functions running as service_role.
ALTER TABLE public.rental_additional_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY rental_additional_drivers_select_tenant
  ON public.rental_additional_drivers
  FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- Customers can read their own rental's additional drivers via the customer
-- portal. We match on the rental row's customer_id rather than on this row
-- (additional drivers are not Drive247 customers).
CREATE POLICY rental_additional_drivers_select_customer
  ON public.rental_additional_drivers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.rentals r
      JOIN public.customer_users cu ON cu.customer_id = r.customer_id
      WHERE r.id = rental_additional_drivers.rental_id
        AND cu.auth_user_id = auth.uid()
    )
  );

-- Mutations are service_role only — there is no INSERT/UPDATE/DELETE policy
-- for authenticated users, so they cannot write directly.

COMMENT ON TABLE public.rental_additional_drivers IS
  'Per-rental authorised additional drivers (e.g., spouse, family member). Each row has its own ID-verification flow and signs the agreement as a secondary BoldSign signer. NOT promoted to the customers table — these are drivers on a specific rental, not standalone Drive247 customers.';

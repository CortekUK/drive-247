-- Magic-link tokens for unauthenticated installment payment.
-- Customer (guest or registered) clicks a link in a reminder email →
-- our edge function looks up the plan, computes the current cumulative
-- outstanding, generates a fresh Stripe Checkout session and redirects.

CREATE TABLE IF NOT EXISTS public.installment_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  installment_plan_id uuid NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  last_used_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installment_payment_links_token
  ON public.installment_payment_links(token);

CREATE INDEX IF NOT EXISTS idx_installment_payment_links_plan
  ON public.installment_payment_links(installment_plan_id);

ALTER TABLE public.installment_payment_links ENABLE ROW LEVEL SECURITY;

-- service_role manages everything (edge fns)
CREATE POLICY installment_payment_links_service_all
  ON public.installment_payment_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Tenant staff can read their own tenant's links (for debugging)
CREATE POLICY installment_payment_links_tenant_read
  ON public.installment_payment_links
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

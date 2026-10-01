-- Agreements v2: a staff member's saved signatures, several each, one primary
-- (Template Studio → "Manage signatures"). Applied to prod 2026-10-01 via the
-- Management API.
--
-- ADDITIVE ONLY (V2_PLAN §4): a new table; v1 does not know it exists. It
-- supersedes the one-per-person agreement_operator_signatures_v2 (empty when
-- this was applied), which is left in place untouched.
--
-- Same access rule as that table: a signed-in, active staff member reads and
-- writes only their own rows, inside their own tenant (super admins in any);
-- service_role manages everything.

CREATE TABLE IF NOT EXISTS public.operator_signatures_v2 (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label       text CHECK (label IS NULL OR char_length(label) <= 60),
  source      text NOT NULL CHECK (source IN ('drawn', 'uploaded')),
  image_data  text NOT NULL
              CHECK (char_length(image_data) <= 512000
                     AND image_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'),
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_signatures_v2_owner_idx
  ON public.operator_signatures_v2 (app_user_id, tenant_id);

-- At most one primary per person per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS operator_signatures_v2_one_primary
  ON public.operator_signatures_v2 (app_user_id, tenant_id) WHERE is_primary;

DROP TRIGGER IF EXISTS operator_signatures_v2_updated_at ON public.operator_signatures_v2;
CREATE TRIGGER operator_signatures_v2_updated_at
  BEFORE UPDATE ON public.operator_signatures_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.operator_signatures_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_signatures_v2_owner ON public.operator_signatures_v2;
CREATE POLICY operator_signatures_v2_owner ON public.operator_signatures_v2
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.id = operator_signatures_v2.app_user_id AND au.auth_user_id = auth.uid() AND au.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_users au
                      WHERE au.id = operator_signatures_v2.app_user_id AND au.auth_user_id = auth.uid() AND au.is_active)
              AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin()));

DROP POLICY IF EXISTS operator_signatures_v2_service ON public.operator_signatures_v2;
CREATE POLICY operator_signatures_v2_service ON public.operator_signatures_v2
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_signatures_v2 TO authenticated;

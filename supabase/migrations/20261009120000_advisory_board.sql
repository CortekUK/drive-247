-- APPLIED to production 2026-10-09
--
-- Client Advisory Board — the 8–15 operators (v1 and v2) who help shape the
-- product. Super Admin → Customer management → Advisory Board lists every
-- tenant with how long they have been with us and a one-click "Put in
-- Advisory Board" / "Remove" button. Membership is a plain tag: nothing is
-- sent or automated when a tenant is added.
--
--   advisory_board_members   one row per tenant on the board.

CREATE TABLE IF NOT EXISTS public.advisory_board_members (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500)
);

ALTER TABLE public.advisory_board_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage advisory board" ON public.advisory_board_members;
CREATE POLICY "super admins manage advisory board" ON public.advisory_board_members
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

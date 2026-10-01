-- Agreements v2: template lifecycle status (applied to prod 2026-10-01 via the Management API).
-- Additive only (V2_PLAN §4): every existing row becomes 'active'; v1 never reads or writes it.
ALTER TABLE public.agreement_templates
  ADD COLUMN IF NOT EXISTS template_status text NOT NULL DEFAULT 'active'
  CONSTRAINT agreement_templates_template_status_check
  CHECK (template_status IN ('draft', 'active', 'archived'));
COMMENT ON COLUMN public.agreement_templates.template_status IS
  'v2 lifecycle: draft | active | archived. Only active templates can be sent or be the default (is_active). v1 ignores it.';

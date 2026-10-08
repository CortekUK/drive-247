-- Sunday Newsletter (v2 only) — a weekly email from Drive 247 to v2 operators,
-- written and scheduled by a super admin under Customer management → Sunday
-- Newsletter, sent by the `sunday-newsletter-run` edge function every Sunday.
--
--   newsletter_settings      ONE row: dispatcher on/off, send hour (in each
--                            tenant's own time zone), and the audience — every
--                            v2 tenant minus exclusions, or only the selected.
--   newsletter_issues        one per Sunday (send_date is always a Sunday, and
--                            at most one issue is scheduled for it). Sections
--                            live in `sections` (jsonb): growth_tip,
--                            drive247_tip, webinar, product_update, spotlight.
--   newsletter_deliveries    one row per (issue, tenant) once handled — unique,
--                            so an issue reaches each tenant ONCE.
--   newsletter_unsubscribes  tenants who used the email's unsubscribe link.
--
-- WHO: v2 tenants (portal_experience 'v2', or the northwind canary), active,
-- not tenant_type 'test', in the audience, not unsubscribed.
-- Runner: hourly pg_cron → sunday-newsletter-run (cron applied separately so
-- the service key never lands in this file). It only sends on the issue's
-- Sunday, from send_hour in the tenant's time zone until that day ends.

CREATE TABLE IF NOT EXISTS public.newsletter_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  send_hour smallint NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'selected')),
  target_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.newsletter_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.newsletter_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  preheader text CHECK (preheader IS NULL OR char_length(preheader) <= 200),
  intro text CHECK (intro IS NULL OR char_length(intro) <= 5000),
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_date date NOT NULL CHECK (extract(isodow FROM send_date) = 7),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One scheduled issue per Sunday.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_issues_one_per_sunday
  ON public.newsletter_issues (send_date) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.newsletter_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.newsletter_issues(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  to_email text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_deliveries_once UNIQUE (issue_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_issue ON public.newsletter_deliveries (issue_id);

CREATE TABLE IF NOT EXISTS public.newsletter_unsubscribes (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text,
  unsubscribed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.newsletter_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage newsletter settings" ON public.newsletter_settings;
CREATE POLICY "super admins manage newsletter settings" ON public.newsletter_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS "super admins manage newsletter issues" ON public.newsletter_issues;
CREATE POLICY "super admins manage newsletter issues" ON public.newsletter_issues
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS "super admins read newsletter deliveries" ON public.newsletter_deliveries;
CREATE POLICY "super admins read newsletter deliveries" ON public.newsletter_deliveries
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS "super admins manage newsletter unsubscribes" ON public.newsletter_unsubscribes;
CREATE POLICY "super admins manage newsletter unsubscribes" ON public.newsletter_unsubscribes
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.newsletter_issues_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_newsletter_issues_touch ON public.newsletter_issues;
CREATE TRIGGER trg_newsletter_issues_touch BEFORE UPDATE ON public.newsletter_issues
  FOR EACH ROW EXECUTE FUNCTION public.newsletter_issues_touch();

-- Live delivery tracking in the admin tab (RLS keeps it to super admins).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.newsletter_deliveries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Hourly runner: cron.schedule('sunday-newsletter-run', '7 * * * *', <net.http_post to /functions/v1/sunday-newsletter-run with the service-role bearer>), applied separately.

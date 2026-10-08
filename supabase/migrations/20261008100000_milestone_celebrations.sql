-- APPLIED to production 2026-10-08 via the Management API; cron `milestones-run` (*/15) scheduled.
--
-- Milestone celebrations: congratulate v2 operators when they hit a milestone
-- (10 bookings, 5 cars, ...). A super admin sets the milestones under
-- Customer management → Milestone Celebrations.
--
--   milestones              what to celebrate: a metric, a threshold, the email
--   milestone_achievements  one row per (milestone, tenant) once reached —
--                           unique, so every milestone is celebrated ONCE, even
--                           if the count dips and climbs past it again
--
-- WHO: v2 tenants only (portal_experience = 'v2', or the northwind canary),
-- production, active. A tenant that was ALREADY past a milestone when it was
-- switched on is logged as "already reached" and not emailed — nobody wants
-- "congrats on 10 bookings" when they have 400.
-- Runner: the `milestones-run` edge function, every 15 minutes (cron applied
-- separately so the service key never lands in this file).

CREATE TABLE IF NOT EXISTS public.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric text NOT NULL CHECK (metric IN ('bookings', 'completed_rentals', 'fleet_size', 'customers')),
  threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 1000000),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  enabled boolean NOT NULL DEFAULT false,
  active_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestones_metric_threshold_unique UNIQUE (metric, threshold)
);

CREATE TABLE IF NOT EXISTS public.milestone_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES public.milestones(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric_value integer NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  to_email text,
  subject text,
  detail text,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  CONSTRAINT milestone_achievements_once UNIQUE (milestone_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_milestone_achievements_achieved ON public.milestone_achievements (achieved_at DESC);

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestone_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage milestones" ON public.milestones;
CREATE POLICY "super admins manage milestones" ON public.milestones
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read milestone achievements" ON public.milestone_achievements;
CREATE POLICY "super admins read milestone achievements" ON public.milestone_achievements
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Every off→on resets active_since, so switching on never backfills the
-- tenants who crossed the line while it was paused.
CREATE OR REPLACE FUNCTION public.milestones_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN
    NEW.active_since := now();
  ELSIF NOT NEW.enabled THEN
    NEW.active_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_milestones_stamp ON public.milestones;
CREATE TRIGGER trg_milestones_stamp BEFORE INSERT OR UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.milestones_stamp();

-- The counts, per tenant. With p_before, only rows created before then — that
-- is how the runner tells "crossed it now" from "was already past it".
--   bookings           rentals that were not cancelled or rejected
--   completed_rentals  rentals closed out
--   fleet_size         vehicles not disposed
--   customers          customer records
CREATE OR REPLACE FUNCTION public.milestone_metric_counts(p_tenant_ids uuid[], p_before timestamptz DEFAULT NULL)
RETURNS TABLE (tenant_id uuid, bookings integer, completed_rentals integer, fleet_size integer, customers integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    (SELECT count(*)::int FROM rentals r
       WHERE r.tenant_id = t.id AND coalesce(r.status, '') NOT IN ('Cancelled', 'Rejected')
         AND (p_before IS NULL OR r.created_at < p_before)),
    (SELECT count(*)::int FROM rentals r
       WHERE r.tenant_id = t.id AND r.status = 'Closed'
         AND (p_before IS NULL OR r.created_at < p_before)),
    (SELECT count(*)::int FROM vehicles v
       WHERE v.tenant_id = t.id AND coalesce(v.is_disposed, false) = false AND coalesce(v.status, '') <> 'Disposed'
         AND (p_before IS NULL OR v.created_at < p_before)),
    (SELECT count(*)::int FROM customers c
       WHERE c.tenant_id = t.id
         AND (p_before IS NULL OR c.created_at < p_before))
  FROM unnest(p_tenant_ids) AS t(id);
$$;
REVOKE ALL ON FUNCTION public.milestone_metric_counts(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.milestone_metric_counts(uuid[], timestamptz) TO service_role;

-- Default milestones, OFF until a super admin has read them.
INSERT INTO public.milestones (metric, threshold, label, subject, body)
SELECT * FROM (VALUES
  ('bookings', 1, 'First booking',
   'Your first booking on Drive 247!',
   E'Hi {{tenant_name}},\n\nYou just took your first booking on Drive 247. That''s the hardest one, and it''s done.\n\n- Make sure the car is clean and ready for pickup.\n- After the rental, ask your customer for a review.\n\nSee it in your portal: {{portal_url}}\n\nHere''s to the next one.\n\nThe Drive 247 team'),
  ('bookings', 10, '10 bookings',
   '10 bookings, {{tenant_name}}!',
   E'Hi {{tenant_name}},\n\nYou''ve reached {{milestone_value}} bookings on Drive 247. Congratulations!\n\nTen bookings means renters are finding you and trusting you. A few things that help the next ten come faster:\n\n- Share your booking site on social media: {{booking_url}}\n- Thank your repeat customers with a small discount.\n\nThe Drive 247 team'),
  ('bookings', 50, '50 bookings',
   '50 bookings — you''re on a roll',
   E'Hi {{tenant_name}},\n\n{{milestone_value}} bookings. That''s a real rental business.\n\nThanks for growing with Drive 247. If there''s anything that would help you reach 100, just reply and tell us.\n\nThe Drive 247 team'),
  ('bookings', 100, '100 bookings',
   '100 bookings! 🎉',
   E'Hi {{tenant_name}},\n\nOne hundred bookings on Drive 247. Congratulations to you and your team.\n\nYour portal: {{portal_url}}\n\nThe Drive 247 team'),
  ('fleet_size', 5, '5 cars in the fleet',
   'Your fleet just reached 5 cars',
   E'Hi {{tenant_name}},\n\nYou now have {{milestone_value}} cars on Drive 247. Growing fleet, growing business.\n\nTip: give each car clear photos and a one-line description on your booking site: {{booking_url}}\n\nThe Drive 247 team'),
  ('fleet_size', 10, '10 cars in the fleet',
   '10 cars! Your fleet is growing',
   E'Hi {{tenant_name}},\n\nTen cars on Drive 247. Congratulations!\n\nWith a bigger fleet, weekend and holiday pricing can make a real difference. Set it up in your portal: {{portal_url}}\n\nThe Drive 247 team')
) AS seed(metric, threshold, label, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM public.milestones);
-- Runner: cron.schedule('milestones-run', '*/15 * * * *', <net.http_post to /functions/v1/milestones-run with the service-role bearer>), applied separately.

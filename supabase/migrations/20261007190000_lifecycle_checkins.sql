-- APPLIED to production 2026-10-07 via the Management API.
--
-- Lifecycle check-ins (14 / 30 / 60 / 90) — planned touch-points over a new
-- operator's first months, set by a super admin under Customer management.
--
--   lifecycle_checkins       the plan: "day N after signup → send this email"
--                            or "→ make this task for our team"
--   lifecycle_checkin_runs   one row per (check-in, tenant) once handled; the
--                            unique key is what makes every step happen ONCE
--
-- NEW TENANTS ONLY: a tenant gets a check-in only if it signed up AFTER that
-- check-in was created. Adding a "day 30" step today never mails the operators
-- who joined last year.
--
-- The runner is the `lifecycle-checkins-run` edge function, hourly (cron job
-- below, applied separately so the service key never lands in this file).
-- Team tasks become rows in admin_todos, with the tenant attached.

CREATE TABLE IF NOT EXISTS public.lifecycle_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_offset integer NOT NULL CHECK (day_offset BETWEEN 1 AND 365),
  kind text NOT NULL CHECK (kind IN ('email', 'task')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  subject text,
  body text,
  task_note text CHECK (task_note IS NULL OR char_length(task_note) <= 5000),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_checkins_email_has_content CHECK (
    kind <> 'email' OR (coalesce(btrim(subject), '') <> '' AND coalesce(btrim(body), '') <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.lifecycle_checkin_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id uuid NOT NULL REFERENCES public.lifecycle_checkins(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'task_created', 'skipped')),
  to_email text,
  subject text,
  detail text,
  todo_id uuid REFERENCES public.admin_todos(id) ON DELETE SET NULL,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_checkin_runs_once UNIQUE (checkin_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_checkin_runs_created ON public.lifecycle_checkin_runs (created_at DESC);

ALTER TABLE public.lifecycle_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lifecycle_checkin_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage lifecycle checkins" ON public.lifecycle_checkins;
CREATE POLICY "super admins manage lifecycle checkins" ON public.lifecycle_checkins
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read lifecycle runs" ON public.lifecycle_checkin_runs;
CREATE POLICY "super admins read lifecycle runs" ON public.lifecycle_checkin_runs
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- The four check-ins from the brief, OFF until a super admin has read them.
INSERT INTO public.lifecycle_checkins (day_offset, kind, label, subject, body, task_note)
SELECT * FROM (VALUES
  (14, 'email', 'How''s it going? survey',
   'How are your first two weeks with Drive 247?',
   E'Hi {{tenant_name}},\n\nYou''ve been on Drive 247 for two weeks now, and we''d love to know how it''s going.\n\nJust reply to this email with a line or two:\n- What''s working well?\n- What''s getting in your way?\n- Is there anything you expected to find and couldn''t?\n\nEvery reply is read by a person on our team.\n\nYour portal: {{portal_url}}\n\nThe Drive 247 team',
   NULL),
  (30, 'email', 'Value review',
   'Your first month on Drive 247',
   E'Hi {{tenant_name}},\n\nIt''s been a month since you joined Drive 247. Your portal home now shows what the platform did for you this month: bookings, money taken in rentals, repeat customers and the messages we sent on your behalf.\n\nTake a look: {{portal_url}}\n\nIf the numbers aren''t where you want them, reply and we''ll go through it with you.\n\nThe Drive 247 team',
   NULL),
  (60, 'email', 'Have you tried auto-extensions?',
   'Have you tried auto-extensions?',
   E'Hi {{tenant_name}},\n\nA feature many operators wish they''d switched on sooner: auto-extensions.\n\nWhen a customer keeps the car past the end of their rental, Drive 247 can extend the booking and charge them automatically, with reminders before it happens, so you don''t have to chase anyone.\n\nYou''ll find it in your portal: {{portal_url}}\n\nWant a hand setting it up? Just reply.\n\nThe Drive 247 team',
   NULL),
  (90, 'task', 'Call with our team',
   NULL, NULL,
   'Book a 20-minute call with this operator: how the first 3 months went, what they use, what''s missing, and whether they''re on the right plan.')
) AS seed(day_offset, kind, label, subject, body, task_note)
WHERE NOT EXISTS (SELECT 1 FROM public.lifecycle_checkins);

-- Hourly runner (applied separately, header copied from customer-management-run):
--   SELECT cron.schedule('lifecycle-checkins-run', '17 * * * *', <net.http_post to
--     /functions/v1/lifecycle-checkins-run with the service-role bearer>);

-- "New tenants" means tenants who signed up after the check-in was SWITCHED ON
-- (not merely drafted). Every off→on resets it, so pausing a step and turning
-- it back on never catches up on the operators who joined while it was off.
ALTER TABLE public.lifecycle_checkins ADD COLUMN IF NOT EXISTS active_since timestamptz;

CREATE OR REPLACE FUNCTION public.lifecycle_checkins_stamp()
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

DROP TRIGGER IF EXISTS trg_lifecycle_checkins_stamp ON public.lifecycle_checkins;
CREATE TRIGGER trg_lifecycle_checkins_stamp
  BEFORE INSERT OR UPDATE ON public.lifecycle_checkins
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_checkins_stamp();

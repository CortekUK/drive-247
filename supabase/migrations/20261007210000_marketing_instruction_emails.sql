-- APPLIED to production 2026-10-07 via the Management API.
--
-- Marketing instruction emails — a drip "course" for new v2 operators: weekly
-- lessons on getting more bookings, set by a super admin under Customer
-- management → Marketing Instructions Emails.
--
--   marketing_emails       the lessons: day N after signup, optionally moved to
--                          the next chosen weekday (e.g. "first Monday on or
--                          after day 7"), sent at 9:00 in the tenant's time zone
--   marketing_email_runs   one row per (lesson, tenant) once handled — unique,
--                          so every lesson goes out ONCE
--
-- WHO: v2 tenants only (portal_experience = 'v2', or the northwind canary),
-- production, active, who signed up AFTER the lesson was switched on.
-- Runner: the `marketing-emails-run` edge function, hourly (cron applied
-- separately so the service key never lands in this file).

CREATE TABLE IF NOT EXISTS public.marketing_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_offset integer NOT NULL CHECK (day_offset BETWEEN 0 AND 365),
  send_weekday smallint CHECK (send_weekday IS NULL OR send_weekday BETWEEN 0 AND 6),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  enabled boolean NOT NULL DEFAULT false,
  active_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketing_email_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.marketing_emails(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  to_email text,
  subject text,
  detail text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_email_runs_once UNIQUE (email_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_email_runs_created ON public.marketing_email_runs (created_at DESC);

ALTER TABLE public.marketing_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_email_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage marketing emails" ON public.marketing_emails;
CREATE POLICY "super admins manage marketing emails" ON public.marketing_emails
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read marketing email runs" ON public.marketing_email_runs;
CREATE POLICY "super admins read marketing email runs" ON public.marketing_email_runs
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- "New tenants" = signed up after the lesson was switched ON. Every off→on
-- resets it, so pausing never catches up on the operators who joined meanwhile.
CREATE OR REPLACE FUNCTION public.marketing_emails_stamp()
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
DROP TRIGGER IF EXISTS trg_marketing_emails_stamp ON public.marketing_emails;
CREATE TRIGGER trg_marketing_emails_stamp BEFORE INSERT OR UPDATE ON public.marketing_emails
  FOR EACH ROW EXECUTE FUNCTION public.marketing_emails_stamp();

-- Default course: six plain-text lessons, OFF until a super admin has read them.
INSERT INTO public.marketing_emails (day_offset, send_weekday, label, subject, body)
SELECT * FROM (VALUES
  (2, NULL::smallint, 'Lesson 1 — Your booking site is your shop window',
   'Lesson 1: make your booking site work for you',
   E'Hi {{tenant_name}},\n\nWelcome to your Drive 247 marketing course. Over the next few weeks we''ll send you one short lesson at a time on getting more direct bookings.\n\nLesson 1: your booking site is your shop window.\n\n- Add clear photos of every car: front, side, interior.\n- Write one honest line per car: who it suits and why.\n- Check your prices and minimum rental days are right.\n\nYour booking site: {{booking_url}}\nEdit it in your portal: {{portal_url}}\n\nNext week: getting your first reviews.\n\nThe Drive 247 team'),
  (7, 1::smallint, 'Lesson 2 — Get your first reviews',
   'Lesson 2: reviews win bookings',
   E'Hi {{tenant_name}},\n\nLesson 2: reviews win bookings.\n\nMost renters read reviews before they book. A handful of good ones does more than any ad.\n\n- After every rental, ask the customer for a review while the trip is fresh.\n- Make it easy: send the link, don''t ask them to search.\n- Reply to every review, good or bad. Future customers read your replies.\n\nNext week: your Google Business Profile.\n\nThe Drive 247 team'),
  (14, 1::smallint, 'Lesson 3 — Show up on Google',
   'Lesson 3: show up when people search for you',
   E'Hi {{tenant_name}},\n\nLesson 3: show up on Google.\n\nWhen someone searches "car rental near me", your Google Business Profile is what they see first.\n\n- Claim or create your profile at google.com/business.\n- Add your booking site as the website: {{booking_url}}\n- Add photos of your cars and your pickup location.\n- Keep your opening hours accurate.\n\nNext week: turning one-time renters into repeat customers.\n\nThe Drive 247 team'),
  (21, 1::smallint, 'Lesson 4 — Bring customers back',
   'Lesson 4: your best customers are your past customers',
   E'Hi {{tenant_name}},\n\nLesson 4: bring customers back.\n\nA returning customer costs nothing to find and already trusts you.\n\n- Thank every customer after their rental.\n- Offer returning customers a small discount or a free extra day.\n- Remind regulars before busy periods: holidays, summer, long weekends.\n\nYour portal home shows how many repeat customers you had this month: {{portal_url}}\n\nNext week: social media that actually brings bookings.\n\nThe Drive 247 team'),
  (28, 1::smallint, 'Lesson 5 — Social media that brings bookings',
   'Lesson 5: social media, the simple version',
   E'Hi {{tenant_name}},\n\nLesson 5: social media that brings bookings.\n\nYou don''t need to post every day. You need to post the right things.\n\n- One good photo of a car, with the price per day and your booking link.\n- Share customer moments (with permission): road trips, weddings, airport pickups.\n- Always end with where to book: {{booking_url}}\n\nNext week: pricing for busy and quiet weeks.\n\nThe Drive 247 team'),
  (35, 1::smallint, 'Lesson 6 — Price for busy and quiet weeks',
   'Lesson 6: smart pricing',
   E'Hi {{tenant_name}},\n\nLesson 6, the last one: price for busy and quiet weeks.\n\n- Charge a little more on weekends and holidays. Drive 247 can add weekend and holiday surcharges for you.\n- Offer weekly and monthly rates so longer rentals choose you.\n- In quiet weeks, a small discount keeps cars earning instead of parked.\n\nSet it up in your portal: {{portal_url}}\n\nThat''s the course. Reply any time if you''d like help with any of it.\n\nThe Drive 247 team')
) AS seed(day_offset, send_weekday, label, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM public.marketing_emails);
-- Hourly runner: cron.schedule('marketing-emails-run', '23 * * * *', <net.http_post to /functions/v1/marketing-emails-run with the service-role bearer>), applied separately.

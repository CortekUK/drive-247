-- NPS Program — "How likely are you to recommend Drive247?" (0–10), asked of
-- rental operators inside their portal (v1 and v2), on a schedule the super
-- admin sets under Customer management → NPS Program.
--
--   nps_settings    ONE row: on/off, the schedule (days after the tenant
--                   started: 14, 30, 90 …), which staff roles are asked, and
--                   the audience — every tenant minus exclusions, or only the
--                   selected ones.
--   nps_responses   one per staff user per schedule day: a score (and an
--                   optional reason), or "dismissed" when they chose Not now.
--
-- "Started" = the tenant's first subscription (trial or paid), else the day
-- the account was created. When several days are due at once — a tenant who
-- is 200 days in when the program is switched on — only the latest is asked,
-- once; earlier ones are never asked after a later one was answered. Two asks
-- are always at least 7 days apart.
--
-- The portal reads and writes ONLY through get_my_nps_prompt() and
-- submit_nps_response(), which apply all of that for the caller. Super admins
-- read everything directly (RLS).

CREATE TABLE IF NOT EXISTS public.nps_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  -- Days after the tenant started, ascending, each 1–3650.
  schedule_days integer[] NOT NULL DEFAULT '{14,30,90}',
  roles text[] NOT NULL DEFAULT '{head_admin,admin}',
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'selected')),
  target_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.nps_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nps_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  schedule_day integer NOT NULL,
  status text NOT NULL CHECK (status IN ('answered', 'dismissed')),
  score integer CHECK (score BETWEEN 0 AND 10),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 2000),
  -- Which portal they were using when asked.
  portal text CHECK (portal IN ('v1', 'v2')),
  -- Days since the tenant started, at the moment of answering.
  tenant_age_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nps_responses_score_when_answered CHECK ((status = 'answered') = (score IS NOT NULL)),
  CONSTRAINT nps_responses_once UNIQUE (app_user_id, schedule_day)
);
CREATE INDEX IF NOT EXISTS idx_nps_responses_tenant ON public.nps_responses (tenant_id, created_at DESC);

ALTER TABLE public.nps_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nps_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage nps settings" ON public.nps_settings;
CREATE POLICY "super admins manage nps settings" ON public.nps_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS "super admins read nps responses" ON public.nps_responses;
CREATE POLICY "super admins read nps responses" ON public.nps_responses
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS "super admins delete nps responses" ON public.nps_responses;
CREATE POLICY "super admins delete nps responses" ON public.nps_responses
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- Live score tracking in the admin tab (RLS keeps it to super admins).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.nps_responses;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The schedule day the CALLER should be asked about right now, or NULL.
-- Shared by get_my_nps_prompt() and submit_nps_response() so the popup and
-- the write can never disagree.
CREATE OR REPLACE FUNCTION public.nps_due_day_for_caller()
RETURNS TABLE (app_user_id uuid, tenant_id uuid, schedule_day integer, tenant_age_days integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT u.id, u.tenant_id, u.role
    FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id IS NOT NULL
      AND coalesce(u.is_active, true)
      AND NOT coalesce(u.is_super_admin, false)
    LIMIT 1
  ),
  s AS (SELECT * FROM nps_settings WHERE id = 1),
  t AS (
    SELECT me.id AS app_user_id, me.tenant_id, me.role,
           floor(extract(epoch FROM now() - coalesce(
             (SELECT min(ts.created_at) FROM tenant_subscriptions ts WHERE ts.tenant_id = me.tenant_id),
             tn.created_at
           )) / 86400)::integer AS age
    FROM me JOIN tenants tn ON tn.id = me.tenant_id
    WHERE tn.status = 'active'
  )
  SELECT t.app_user_id, t.tenant_id, d.day, t.age
  FROM t, s,
       LATERAL (
         SELECT max(x) AS day FROM unnest(s.schedule_days) x WHERE x <= t.age
       ) d
  WHERE s.enabled
    AND t.role = ANY (s.roles)
    AND CASE s.audience
          WHEN 'selected' THEN t.tenant_id = ANY (s.target_tenant_ids)
          ELSE NOT (t.tenant_id = ANY (s.excluded_tenant_ids))
        END
    AND d.day IS NOT NULL
    -- Not asked about this day or a later one already.
    AND NOT EXISTS (
      SELECT 1 FROM nps_responses r
      WHERE r.app_user_id = t.app_user_id AND r.schedule_day >= d.day
    )
    -- At least a week since they were last asked.
    AND NOT EXISTS (
      SELECT 1 FROM nps_responses r
      WHERE r.app_user_id = t.app_user_id AND r.created_at > now() - interval '7 days'
    );
$$;
REVOKE ALL ON FUNCTION public.nps_due_day_for_caller() FROM public, anon, authenticated;

-- What the portal popup needs: the day being asked about, or null.
CREATE OR REPLACE FUNCTION public.get_my_nps_prompt()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('schedule_day', d.schedule_day)
  FROM public.nps_due_day_for_caller() d
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_nps_prompt() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_nps_prompt() TO authenticated;

-- Record the caller's answer (score 0–10, optional reason) or their "Not now".
-- Accepted only for the day that is due for them right now.
CREATE OR REPLACE FUNCTION public.submit_nps_response(
  p_schedule_day integer,
  p_score integer,
  p_comment text,
  p_dismissed boolean,
  p_portal text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d record;
BEGIN
  SELECT * INTO d FROM public.nps_due_day_for_caller() LIMIT 1;
  IF d IS NULL OR d.schedule_day IS DISTINCT FROM p_schedule_day THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_due');
  END IF;
  IF NOT coalesce(p_dismissed, false) AND (p_score IS NULL OR p_score < 0 OR p_score > 10) THEN
    RAISE EXCEPTION 'Score must be between 0 and 10' USING ERRCODE = '22023';
  END IF;

  INSERT INTO nps_responses (tenant_id, app_user_id, schedule_day, status, score, comment, portal, tenant_age_days)
  VALUES (
    d.tenant_id,
    d.app_user_id,
    d.schedule_day,
    CASE WHEN coalesce(p_dismissed, false) THEN 'dismissed' ELSE 'answered' END,
    CASE WHEN coalesce(p_dismissed, false) THEN NULL ELSE p_score END,
    CASE WHEN coalesce(p_dismissed, false) THEN NULL ELSE nullif(left(btrim(coalesce(p_comment, '')), 2000), '') END,
    CASE WHEN p_portal IN ('v1', 'v2') THEN p_portal ELSE NULL END,
    d.tenant_age_days
  )
  ON CONFLICT (app_user_id, schedule_day) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_nps_response(integer, integer, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_nps_response(integer, integer, text, boolean, text) TO authenticated;

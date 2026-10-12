-- APPLIED to production 2026-10-12
--
-- Creator Rewards Programme (v2 tenants only).
--
-- An operator posts a video about Drive247 on social media, pastes the link in
-- the portal's Rewards page, and Drive247 reviews it. Approved → a discount on
-- their next Drive247 invoice (a free month = 100% off once, or N% off once);
-- rejected → the reviewer's message shows on the operator's Rewards page and in
-- their notification bell.
--
--   creator_reward_settings      one row (id = 1): on/off, rules, limits
--   creator_reward_submissions   one row per submitted link
--
-- WRITES:
--   operators   only through `submit_creator_reward()` (security definer), which
--               enforces every limit below server-side. There is no INSERT
--               policy, so a direct insert from the browser is refused.
--   reviewers   approve / reject / apply through the `creator-reward-review`
--               edge function (service role; it checks is_super_admin and
--               attaches the Stripe coupon). Super admins may also edit rows
--               directly under RLS.
--
-- ANTI-ABUSE (all configurable in Super Admin → Customer management → Rewards):
--   * submissions per tenant per calendar month (UTC)
--   * pending submissions per tenant at once
--   * approved rewards per tenant per month and across the platform per month
--     (checked by the edge function at approval time)
--   * a link can only ever be submitted once, by anyone (normalized URL unique,
--     rejected ones included, so a fake link cannot be re-tried)
--   * links must be https on an allowed platform host
--
-- The submissions table is in the supabase_realtime publication so a review
-- appears on the operator's screen at once. RLS is ENABLED on it, and realtime
-- postgres_changes honours RLS, so a tenant only ever receives its own rows.

-- ── settings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.creator_reward_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  monthly_submission_limit integer NOT NULL DEFAULT 2 CHECK (monthly_submission_limit BETWEEN 1 AND 100),
  max_pending_per_tenant integer NOT NULL DEFAULT 2 CHECK (max_pending_per_tenant BETWEEN 1 AND 100),
  monthly_reward_limit_per_tenant integer NOT NULL DEFAULT 1 CHECK (monthly_reward_limit_per_tenant BETWEEN 0 AND 100),
  monthly_reward_limit_global integer NOT NULL DEFAULT 20 CHECK (monthly_reward_limit_global BETWEEN 0 AND 10000),
  allowed_platforms text[] NOT NULL DEFAULT ARRAY['tiktok','instagram','youtube','facebook','x','linkedin'],
  default_reward_type text NOT NULL DEFAULT 'percent' CHECK (default_reward_type IN ('free_month','percent')),
  default_reward_percent integer NOT NULL DEFAULT 25 CHECK (default_reward_percent BETWEEN 1 AND 100),
  rules text NOT NULL DEFAULT
    'Post an original video about your experience with Drive247 on a public account.' || chr(10) ||
    'Tag @drive247 and keep the post public for at least 30 days.' || chr(10) ||
    'One link per post — reposts, duplicates and private links are rejected.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

INSERT INTO public.creator_reward_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.creator_reward_settings ENABLE ROW LEVEL SECURITY;

-- Operators read the rules and limits shown on their Rewards page.
DROP POLICY IF EXISTS "signed-in users read creator reward settings" ON public.creator_reward_settings;
CREATE POLICY "signed-in users read creator reward settings" ON public.creator_reward_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "super admins edit creator reward settings" ON public.creator_reward_settings;
CREATE POLICY "super admins edit creator reward settings" ON public.creator_reward_settings
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

GRANT SELECT, UPDATE ON public.creator_reward_settings TO authenticated;

-- ── submissions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.creator_reward_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  url text NOT NULL CHECK (char_length(url) <= 2000),
  url_normalized text NOT NULL,
  platform text NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_message text CHECK (admin_message IS NULL OR char_length(admin_message) <= 1000),
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reward_type text CHECK (reward_type IS NULL OR reward_type IN ('free_month','percent')),
  reward_percent integer CHECK (reward_percent IS NULL OR reward_percent BETWEEN 1 AND 100),
  -- applied: coupon is on the Stripe subscription; pending: no active
  -- subscription yet, apply later; failed: Stripe refused (see reward_error).
  reward_status text CHECK (reward_status IS NULL OR reward_status IN ('applied','pending','failed')),
  reward_error text,
  stripe_coupon_id text,
  reward_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS creator_reward_submissions_url_uniq
  ON public.creator_reward_submissions (url_normalized);
CREATE INDEX IF NOT EXISTS creator_reward_submissions_tenant_idx
  ON public.creator_reward_submissions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creator_reward_submissions_status_idx
  ON public.creator_reward_submissions (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.creator_reward_submissions_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creator_reward_submissions_touch ON public.creator_reward_submissions;
CREATE TRIGGER creator_reward_submissions_touch
  BEFORE UPDATE ON public.creator_reward_submissions
  FOR EACH ROW EXECUTE FUNCTION public.creator_reward_submissions_touch();

ALTER TABLE public.creator_reward_submissions ENABLE ROW LEVEL SECURITY;
-- Realtime UPDATE events carry the full old row only with REPLICA IDENTITY
-- FULL; the portal only needs "something changed", so the default is enough.

DROP POLICY IF EXISTS "tenants read own creator submissions" ON public.creator_reward_submissions;
CREATE POLICY "tenants read own creator submissions" ON public.creator_reward_submissions
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "super admins manage creator submissions" ON public.creator_reward_submissions;
CREATE POLICY "super admins manage creator submissions" ON public.creator_reward_submissions
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

GRANT SELECT, UPDATE, DELETE ON public.creator_reward_submissions TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'creator_reward_submissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_reward_submissions;
  END IF;
END $$;

-- ── URL helpers ─────────────────────────────────────────────────────────────

-- Which platform a link belongs to, from its host. NULL = not a supported host.
CREATE OR REPLACE FUNCTION public.creator_reward_platform(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH h AS (
    SELECT regexp_replace(lower(substring(p_url from '^https://([^/?#:]+)')), '^(www\.|m\.|mobile\.)', '') AS host
  )
  SELECT CASE
    WHEN host IN ('tiktok.com','vm.tiktok.com','vt.tiktok.com') THEN 'tiktok'
    WHEN host IN ('instagram.com') THEN 'instagram'
    WHEN host IN ('youtube.com','youtu.be') THEN 'youtube'
    WHEN host IN ('facebook.com','fb.watch','fb.com') THEN 'facebook'
    WHEN host IN ('x.com','twitter.com') THEN 'x'
    WHEN host IN ('linkedin.com') THEN 'linkedin'
    ELSE NULL
  END
  FROM h;
$$;

-- One canonical form per post, so the same video cannot be submitted twice by
-- adding "www.", a trailing slash, tracking params or different casing.
-- YouTube keeps its `v` parameter (the video id lives there); everything else
-- drops the query string and fragment.
CREATE OR REPLACE FUNCTION public.creator_reward_normalize_url(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH parts AS (
    SELECT
      regexp_replace(lower(substring(btrim(p_url) from '^https?://([^/?#:]+)')), '^(www\.|m\.|mobile\.)', '') AS host,
      coalesce(substring(btrim(p_url) from '^https?://[^/?#]+(/[^?#]*)'), '') AS path,
      substring(btrim(p_url) from '[?&]v=([A-Za-z0-9_-]+)') AS yt_v
  )
  SELECT CASE
    -- youtu.be/ID, youtube.com/shorts/ID and youtube.com/watch?v=ID are one video.
    WHEN host = 'youtu.be' AND path ~ '^/[A-Za-z0-9_-]+'
      THEN 'youtube.com/watch?v=' || substring(path from '^/([A-Za-z0-9_-]+)')
    WHEN host = 'youtube.com' AND path ~ '^/(shorts|live|embed)/[A-Za-z0-9_-]+'
      THEN 'youtube.com/watch?v=' || substring(path from '^/(?:shorts|live|embed)/([A-Za-z0-9_-]+)')
    WHEN host = 'youtube.com' AND yt_v IS NOT NULL
      THEN 'youtube.com/watch?v=' || yt_v
    ELSE CASE WHEN host = 'twitter.com' THEN 'x.com' ELSE host END || regexp_replace(path, '/+$', '')
  END
  FROM parts;
$$;

-- ── submit ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_creator_reward(p_url text, p_note text DEFAULT NULL)
RETURNS public.creator_reward_submissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.app_users%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_cfg public.creator_reward_settings%ROWTYPE;
  v_url text := btrim(coalesce(p_url, ''));
  v_platform text;
  v_norm text;
  v_month_count integer;
  v_pending integer;
  v_row public.creator_reward_submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.app_users
   WHERE auth_user_id = auth.uid() AND tenant_id IS NOT NULL AND coalesce(is_active, true)
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign in to your portal account to submit a video.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_user.tenant_id;
  IF v_tenant.portal_experience IS DISTINCT FROM 'v2' AND v_tenant.slug <> 'northwind' THEN
    RAISE EXCEPTION 'The Creator Rewards Programme is not available on your account yet.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cfg FROM public.creator_reward_settings WHERE id = 1;
  IF NOT coalesce(v_cfg.enabled, false) THEN
    RAISE EXCEPTION 'The Creator Rewards Programme is paused right now. Please check back soon.' USING ERRCODE = 'P0001';
  END IF;

  IF v_url !~* '^https://' THEN
    RAISE EXCEPTION 'Paste the full link to your post, starting with https://' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_url) > 2000 THEN
    RAISE EXCEPTION 'That link is too long.' USING ERRCODE = '22023';
  END IF;

  v_platform := public.creator_reward_platform(v_url);
  IF v_platform IS NULL OR NOT (v_platform = ANY (v_cfg.allowed_platforms)) THEN
    RAISE EXCEPTION 'That link is not from a supported platform (%).', array_to_string(v_cfg.allowed_platforms, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_norm := public.creator_reward_normalize_url(v_url);
  -- A bare home page is not a post. (Whether it is really a video about
  -- Drive247 is the reviewer's call.)
  IF position('/' in v_norm) = 0 THEN
    RAISE EXCEPTION 'Paste the link to the post itself.' USING ERRCODE = '22023';
  END IF;

  -- Serialise this tenant's submissions so two quick clicks can't both pass the limits.
  PERFORM pg_advisory_xact_lock(hashtext('creator_reward:' || v_user.tenant_id::text));

  IF EXISTS (SELECT 1 FROM public.creator_reward_submissions WHERE url_normalized = v_norm) THEN
    RAISE EXCEPTION 'This link has already been submitted.' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_month_count FROM public.creator_reward_submissions
   WHERE tenant_id = v_user.tenant_id
     AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF v_month_count >= v_cfg.monthly_submission_limit THEN
    RAISE EXCEPTION 'You have reached this month''s limit of % submission(s). You can submit again next month.', v_cfg.monthly_submission_limit
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_pending FROM public.creator_reward_submissions
   WHERE tenant_id = v_user.tenant_id AND status = 'pending';
  IF v_pending >= v_cfg.max_pending_per_tenant THEN
    RAISE EXCEPTION 'You already have % video(s) waiting for review. You can submit another once they are reviewed.', v_pending
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.creator_reward_submissions (tenant_id, submitted_by, url, url_normalized, platform, note)
  VALUES (v_user.tenant_id, v_user.id, v_url, v_norm, v_platform, nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_creator_reward(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_creator_reward(text, text) TO authenticated;

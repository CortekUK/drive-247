-- APPLIED to production 2026-10-12
--
-- Creator Rewards: ONE reward per tenant, ever.
--
-- An operator may submit several links, but only one can be approved (=
-- rewarded). Enforced in three places:
--   1. this unique index — the database itself refuses a second approved row,
--      whatever path the write takes
--   2. creator-reward-review refuses to approve when the tenant already has an
--      approved submission (no override)
--   3. submit_creator_reward() stops accepting new links once a tenant has been
--      rewarded, so there is nothing left to review

CREATE UNIQUE INDEX IF NOT EXISTS creator_reward_submissions_one_reward_per_tenant
  ON public.creator_reward_submissions (tenant_id) WHERE status = 'approved';

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

  -- One reward per account, ever.
  IF EXISTS (SELECT 1 FROM public.creator_reward_submissions
             WHERE tenant_id = v_user.tenant_id AND status = 'approved') THEN
    RAISE EXCEPTION 'You''ve already received your creator reward — it''s one per account. Thank you for sharing Drive247!'
      USING ERRCODE = 'P0001';
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

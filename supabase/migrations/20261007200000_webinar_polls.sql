-- APPLIED to production 2026-10-07 via the Management API.
--
-- Webinar polls — super admin asks operators a question (single choice,
-- multiple choice, or a typed answer); it appears at the bottom of the v2
-- portal home; results are read live in Customer management → Webinar Poll.
--
--   webinar_polls            the questions. `options` is [{id, label}], empty
--                            for a text question. Published to every tenant
--                            except `excluded_tenant_ids`. Several can be
--                            active at once.
--   webinar_poll_responses   ONE answer per tenant per poll (unique key).
--
-- The portal never reads these tables directly: get_my_webinar_polls() and
-- submit_webinar_poll_response() answer only for the caller's own tenant, and
-- check exclusion, status and the options server-side.

CREATE TABLE IF NOT EXISTS public.webinar_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 1 AND 500),
  kind text NOT NULL CHECK (kind IN ('single', 'multi', 'text')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  excluded_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinar_polls_choice_has_options CHECK (kind = 'text' OR jsonb_array_length(options) >= 2)
);

CREATE TABLE IF NOT EXISTS public.webinar_poll_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.webinar_polls(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  option_ids text[] NOT NULL DEFAULT '{}',
  text_answer text CHECK (text_answer IS NULL OR char_length(text_answer) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinar_poll_responses_once UNIQUE (poll_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_webinar_poll_responses_poll ON public.webinar_poll_responses (poll_id, created_at DESC);

ALTER TABLE public.webinar_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_poll_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage webinar polls" ON public.webinar_polls;
CREATE POLICY "super admins manage webinar polls" ON public.webinar_polls
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins read webinar poll responses" ON public.webinar_poll_responses;
CREATE POLICY "super admins read webinar poll responses" ON public.webinar_poll_responses
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS "super admins delete webinar poll responses" ON public.webinar_poll_responses;
CREATE POLICY "super admins delete webinar poll responses" ON public.webinar_poll_responses
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- Status timestamps, so the admin list can say when a poll went live / closed.
CREATE OR REPLACE FUNCTION public.webinar_polls_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    NEW.published_at := now();
    NEW.closed_at := NULL;
  ELSIF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status <> 'closed') THEN
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_webinar_polls_stamp ON public.webinar_polls;
CREATE TRIGGER trg_webinar_polls_stamp BEFORE INSERT OR UPDATE ON public.webinar_polls
  FOR EACH ROW EXECUTE FUNCTION public.webinar_polls_stamp();

-- Live results in the admin tab. Realtime honours RLS, so only super admins
-- receive these rows.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_poll_responses;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_polls;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The active polls for the caller's tenant, oldest first, with the tenant's
-- answer when it has already voted.
CREATE OR REPLACE FUNCTION public.get_my_webinar_polls()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'question', p.question,
      'kind', p.kind,
      'options', p.options,
      'response', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'option_ids', to_jsonb(r.option_ids), 'text_answer', r.text_answer, 'created_at', r.created_at
      ) END
    ) ORDER BY p.published_at NULLS LAST, p.created_at)
    FROM webinar_polls p
    LEFT JOIN webinar_poll_responses r ON r.poll_id = p.id AND r.tenant_id = v_tenant
    WHERE p.status = 'active' AND NOT (v_tenant = ANY (p.excluded_tenant_ids))
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_webinar_poll_response(p_poll_id uuid, p_option_ids text[], p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_user uuid;
  p webinar_polls;
  v_ids text[] := coalesce(p_option_ids, '{}');
  v_valid text[];
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sign in to your company account to vote' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM webinar_polls WHERE id = p_poll_id;
  IF p.id IS NULL OR p.status <> 'active' OR v_tenant = ANY (p.excluded_tenant_ids) THEN
    RAISE EXCEPTION 'This poll is no longer open' USING ERRCODE = 'P0001';
  END IF;

  IF p.kind = 'text' THEN
    IF coalesce(btrim(p_text), '') = '' THEN
      RAISE EXCEPTION 'Type an answer first' USING ERRCODE = 'P0001';
    END IF;
    v_ids := '{}';
  ELSE
    SELECT array_agg(o->>'id') INTO v_valid FROM jsonb_array_elements(p.options) o;
    v_ids := ARRAY(SELECT DISTINCT unnest(v_ids));
    IF cardinality(v_ids) = 0 OR NOT (v_ids <@ v_valid) THEN
      RAISE EXCEPTION 'Choose an option first' USING ERRCODE = 'P0001';
    END IF;
    IF p.kind = 'single' AND cardinality(v_ids) > 1 THEN
      RAISE EXCEPTION 'Choose one option' USING ERRCODE = 'P0001';
    END IF;
    p_text := NULL;
  END IF;

  SELECT id INTO v_user FROM app_users WHERE auth_user_id = auth.uid() AND tenant_id = v_tenant LIMIT 1;

  INSERT INTO webinar_poll_responses (poll_id, tenant_id, app_user_id, option_ids, text_answer)
  VALUES (p.id, v_tenant, v_user, v_ids, nullif(btrim(p_text), ''));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Your company has already answered this poll' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_webinar_polls() FROM public, anon;
REVOKE ALL ON FUNCTION public.submit_webinar_poll_response(uuid, text[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_webinar_polls() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_webinar_poll_response(uuid, text[], text) TO authenticated;

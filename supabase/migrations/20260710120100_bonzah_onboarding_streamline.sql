-- =============================================================================
-- Bonzah Onboarding Streamline — Phase 0 schema
--   * training/quiz + AI verdict + partner-review columns on submissions
--   * bonzah_submission_events audit timeline
--   * bonzah_quiz_questions / bonzah_training_videos (+ answer-hiding view)
--   * app_users.is_bonzah_partner + relaxed check_tenant_id + is_bonzah_partner()
-- Follows the DB gold standard: UUID PK, NOT NULL where sensible, checks/enums,
-- timestamptz, FKs, one concern per table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend bonzah_onboarding_submissions (training / quiz / AI / partner review)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bonzah_onboarding_submissions
  ADD COLUMN IF NOT EXISTS quiz_score           integer,
  ADD COLUMN IF NOT EXISTS quiz_total           integer,
  ADD COLUMN IF NOT EXISTS quiz_passed          boolean,
  ADD COLUMN IF NOT EXISTS training_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_summary           text,
  ADD COLUMN IF NOT EXISTS ai_recommendation    text,
  ADD COLUMN IF NOT EXISTS ai_confidence        numeric,
  ADD COLUMN IF NOT EXISTS ai_reasons           jsonb,
  ADD COLUMN IF NOT EXISTS ai_red_flags         jsonb,
  ADD COLUMN IF NOT EXISTS ai_generated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS partner_message      text,
  ADD COLUMN IF NOT EXISTS reject_reason        text,
  ADD COLUMN IF NOT EXISTS activated_at         timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bonzah_onboarding_submissions'::regclass
      AND conname = 'bonzah_onb_ai_recommendation_check'
  ) THEN
    ALTER TABLE public.bonzah_onboarding_submissions
      ADD CONSTRAINT bonzah_onb_ai_recommendation_check
      CHECK (ai_recommendation IS NULL
             OR ai_recommendation IN ('approve', 'disapprove', 'uncertain'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. is_bonzah_partner column, helper, and relaxed check_tenant_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS is_bonzah_partner boolean NOT NULL DEFAULT false;

-- SECURITY DEFINER helper mirroring is_super_admin()
CREATE OR REPLACE FUNCTION public.is_bonzah_partner()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT is_bonzah_partner FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$function$;

-- Relax check_tenant_id: super admins AND bonzah partners carry tenant_id NULL;
-- every other (regular) user must have a tenant_id.
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS check_tenant_id;
ALTER TABLE public.app_users
  ADD CONSTRAINT check_tenant_id CHECK (
       (is_super_admin = true  AND tenant_id IS NULL)
    OR (is_bonzah_partner = true AND is_super_admin = false AND tenant_id IS NULL)
    OR (is_super_admin = false AND is_bonzah_partner = false AND tenant_id IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 3. bonzah_submission_events — append-only audit timeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonzah_submission_events (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  submission_id uuid        NOT NULL,
  tenant_id     uuid        NOT NULL,
  actor_type    text        NOT NULL,
  actor_id      uuid,
  event_type    text        NOT NULL,
  note          text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonzah_submission_events_pkey PRIMARY KEY (id),
  CONSTRAINT bonzah_submission_events_actor_type_check
    CHECK (actor_type IN ('customer', 'partner', 'system')),
  CONSTRAINT bonzah_submission_events_submission_id_fkey
    FOREIGN KEY (submission_id) REFERENCES public.bonzah_onboarding_submissions(id) ON DELETE CASCADE,
  CONSTRAINT bonzah_submission_events_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT bonzah_submission_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bonzah_events_submission ON public.bonzah_submission_events (submission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bonzah_events_tenant     ON public.bonzah_submission_events (tenant_id);

ALTER TABLE public.bonzah_submission_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonzah_events_select ON public.bonzah_submission_events;
CREATE POLICY bonzah_events_select
  ON public.bonzah_submission_events FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin() OR is_bonzah_partner());
-- writes are service_role only (edge functions); no INSERT/UPDATE/DELETE policy
-- for authenticated => blocked by RLS.

-- ---------------------------------------------------------------------------
-- 4. bonzah_quiz_questions (+ answer-hiding public view) and bonzah_training_videos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonzah_quiz_questions (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  question             text        NOT NULL,
  options              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  correct_option_index integer     NOT NULL,
  sort_order           integer     NOT NULL DEFAULT 0,
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonzah_quiz_questions_pkey PRIMARY KEY (id),
  CONSTRAINT bonzah_quiz_questions_correct_idx_check CHECK (correct_option_index >= 0)
);

CREATE TABLE IF NOT EXISTS public.bonzah_training_videos (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  description text,
  loom_url    text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonzah_training_videos_pkey PRIMARY KEY (id)
);

DROP TRIGGER IF EXISTS set_updated_at_bonzah_quiz_questions ON public.bonzah_quiz_questions;
CREATE TRIGGER set_updated_at_bonzah_quiz_questions
  BEFORE UPDATE ON public.bonzah_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_bonzah_training_videos ON public.bonzah_training_videos;
CREATE TRIGGER set_updated_at_bonzah_training_videos
  BEFORE UPDATE ON public.bonzah_training_videos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quiz questions: answers must never reach the client. RLS gives base-table
-- SELECT only to super admins / partners (for the admin editor). Regular
-- authenticated users get zero rows from the base table; they read questions
-- through the answer-omitting view below.
ALTER TABLE public.bonzah_quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonzah_quiz_admin_select ON public.bonzah_quiz_questions;
CREATE POLICY bonzah_quiz_admin_select
  ON public.bonzah_quiz_questions FOR SELECT TO authenticated
  USING (is_super_admin() OR is_bonzah_partner());
-- mutations are service_role only.

-- Training videos are not secret: any authenticated user may read active rows.
ALTER TABLE public.bonzah_training_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bonzah_training_select ON public.bonzah_training_videos;
CREATE POLICY bonzah_training_select
  ON public.bonzah_training_videos FOR SELECT TO authenticated
  USING (is_active = true OR is_super_admin() OR is_bonzah_partner());

-- Answer-omitting view. security_invoker = false (default) => runs as owner and
-- bypasses the base table's row policy, exposing only the safe columns.
CREATE OR REPLACE VIEW public.bonzah_quiz_questions_public
  WITH (security_invoker = false) AS
  SELECT id, question, options, sort_order
  FROM public.bonzah_quiz_questions
  WHERE is_active = true;

REVOKE ALL ON public.bonzah_quiz_questions_public FROM anon;
GRANT SELECT ON public.bonzah_quiz_questions_public TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seed dummy content (idempotent — only when tables are empty)
-- ---------------------------------------------------------------------------
INSERT INTO public.bonzah_training_videos (title, description, loom_url, sort_order)
SELECT * FROM (VALUES
  ('Welcome to Bonzah Insurance', 'Overview of how Bonzah protection works for your rentals.', 'https://www.loom.com/embed/00000000000000000000000000000000', 1),
  ('Offering Insurance at Checkout', 'How customers see and buy coverage during booking.', 'https://www.loom.com/embed/11111111111111111111111111111111', 2)
) AS v(title, description, loom_url, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.bonzah_training_videos);

INSERT INTO public.bonzah_quiz_questions (question, options, correct_option_index, sort_order)
SELECT * FROM (VALUES
  ('What does Bonzah provide to your renters?', '["Optional insurance coverage","Free car washes","Fuel discounts","Loyalty points"]'::jsonb, 0, 1),
  ('When is Bonzah coverage offered to the customer?', '["Never","During the booking checkout","Only after the rental ends","At vehicle return"]'::jsonb, 1, 2),
  ('Who underwrites the Bonzah policy?', '["The renter","The rental operator","A licensed insurance carrier","The DMV"]'::jsonb, 2, 3),
  ('Is Bonzah coverage mandatory for every booking?', '["Yes, always","No, it is optional for the customer","Only on weekends","Only for trucks"]'::jsonb, 1, 4),
  ('What should you do if a customer has a claim?', '["Ignore it","Direct them through the Bonzah claims process","Pay them cash","Cancel their account"]'::jsonb, 1, 5)
) AS v(question, options, correct_option_index, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.bonzah_quiz_questions);

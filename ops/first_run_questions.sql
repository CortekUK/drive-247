-- first_run_questions — the onboarding wizard's questions, editable by a super
-- admin instead of shipped as a hardcoded TypeScript array.
--
-- NOT APPLIED BY THE CODE THAT ACCOMPANIES IT. Same reasoning as
-- ops/platform_legal_documents.sql: schema changes go through the Supabase MCP
-- tools, and that server was unreachable in the session that wrote this. Apply
-- it deliberately, then delete this note.
--
-- Shipping the code first is safe. `useFirstRunQuestions()` falls back to
-- `FIRST_RUN_QUESTIONS` in apps/portal/src/lib/first-run-questions.ts on ANY
-- failure — missing table included — so until this runs the wizard asks exactly
-- the five questions it asks today.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE COLUMNS MIRROR THE TS TYPE, DELIBERATELY
--
-- `FirstRunQuestion` in first-run-questions.ts is the shape the wizard already
-- renders. Every column here maps 1:1 onto a field of it, so the row -> object
-- mapping is a rename and nothing more. The one rename is `required` ->
-- `is_required`, to match the `is_published` convention on the other tables.
--
-- `question_key` is `FirstRunQuestion.id` — the key answers are STORED under in
-- `tenant_first_run.answers`. Its own doc comment says "Treat it as permanent
-- once shipped — renaming an id orphans every answer already collected under
-- the old one", which is why it is UNIQUE here and why the admin UI must not
-- offer to edit it after creation.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS IS NOT
--
-- It is NOT per-tenant. These questions are asked of every new operator, so
-- there is no tenant_id — and therefore no tenant filter to get wrong (V2_PLAN
-- §5). Answers are per-tenant and live in `tenant_first_run`, which is a
-- different table with a different lifetime.
--
-- There is deliberately NO read surface over those answers. The team lead ruled
-- it out explicitly ("I don't need to see their submissions"), and not building
-- it means this admin page never reads another operator's onboarding answers.

CREATE TABLE IF NOT EXISTS public.first_run_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable answer key. Permanent once shipped — see above.
  question_key  text NOT NULL UNIQUE,

  -- Matches the `kind` discriminant of `FirstRunQuestion`. Constrained because
  -- the wizard switches on it exhaustively; an unknown value renders nothing.
  kind          text NOT NULL CHECK (kind IN ('single', 'multi', 'text')),

  prompt        text NOT NULL,
  help          text,
  placeholder   text,

  -- `[{ value, label, hint? }]`, matching `FirstRunOption`. Empty for 'text'.
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- The lead's "which questions they can skip and which they cannot", stored
  -- the way the code already reads it. `isAnswered()` opens with
  -- `if (!question.required) return true;` — so this is that same flag, and
  -- nothing in the wizard's logic needs to change.
  is_required   boolean NOT NULL DEFAULT true,

  -- Order is a column, not array position: an admin reordering questions must
  -- not depend on how PostgREST happens to return rows.
  sort_order    integer NOT NULL DEFAULT 0,

  -- Lets a question be drafted without it appearing in a live operator's wizard.
  is_published  boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS first_run_questions_order
  ON public.first_run_questions (sort_order)
  WHERE is_published;

ALTER TABLE public.first_run_questions ENABLE ROW LEVEL SECURITY;

-- Read: any signed-in portal user, published rows only. Unlike the legal
-- documents this needs NO anon grant — the wizard runs inside the portal,
-- behind auth, and is never shown to a logged-out visitor.
DROP POLICY IF EXISTS first_run_questions_read ON public.first_run_questions;
CREATE POLICY first_run_questions_read
  ON public.first_run_questions FOR SELECT TO authenticated
  USING (is_published OR public.is_super_admin());

DROP POLICY IF EXISTS first_run_questions_admin ON public.first_run_questions;
CREATE POLICY first_run_questions_admin
  ON public.first_run_questions FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS first_run_questions_service ON public.first_run_questions;
CREATE POLICY first_run_questions_service
  ON public.first_run_questions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.first_run_questions IS
  'Questions asked by the portal first-run onboarding wizard, authored by super admins in apps/admin. Platform-wide, not per-tenant. Answers live in tenant_first_run.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: the five questions the wizard asks today, so applying this migration
-- changes nothing visible. Copied verbatim from FIRST_RUN_QUESTIONS.
-- `ON CONFLICT DO NOTHING` keeps a re-run harmless.

INSERT INTO public.first_run_questions
  (question_key, kind, prompt, help, placeholder, options, is_required, sort_order)
VALUES
  ('fleet_size', 'single',
   'How many vehicles are you starting with?',
   'You can add or remove vehicles at any time — this just helps us set the right defaults.',
   NULL,
   '[{"value":"1-2","label":"1 – 2 vehicles"},{"value":"3-5","label":"3 – 5 vehicles"},{"value":"6-10","label":"6 – 10 vehicles"},{"value":"11-25","label":"11 – 25 vehicles"},{"value":"25+","label":"More than 25"}]'::jsonb,
   true, 10),

  ('primary_location', 'text',
   'Where do you rent from?',
   'The city or airport most of your pickups happen in.',
   'e.g. Denver, CO',
   '[]'::jsonb,
   true, 20),

  ('vehicle_types', 'multi',
   'What kind of vehicles do you rent?',
   'Pick everything that applies.',
   NULL,
   '[{"value":"economy","label":"Economy & compact"},{"value":"sedan","label":"Sedans"},{"value":"suv","label":"SUVs & crossovers"},{"value":"luxury","label":"Luxury & exotic"},{"value":"ev","label":"Electric vehicles"},{"value":"van","label":"Vans & minibuses"},{"value":"truck","label":"Trucks & commercial"}]'::jsonb,
   true, 30),

  ('takes_payments_today', 'single',
   'How do you take payment today?',
   'Tells us how much of the payments setup to walk you through.',
   NULL,
   '[{"value":"stripe","label":"Card payments, through Stripe"},{"value":"other_processor","label":"Card payments, through another processor"},{"value":"manual","label":"Cash, bank transfer or in person"},{"value":"not_yet","label":"I''m not taking bookings yet"}]'::jsonb,
   true, 40),

  ('referral_source', 'single',
   'How did you hear about Drive247?',
   'Optional — but it genuinely helps us.',
   NULL,
   '[{"value":"search","label":"Google or another search engine"},{"value":"social","label":"Social media"},{"value":"word_of_mouth","label":"Another operator told me"},{"value":"event","label":"An industry event"},{"value":"other","label":"Somewhere else"}]'::jsonb,
   false, 50)
ON CONFLICT (question_key) DO NOTHING;

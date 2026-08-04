-- ============================================
-- Portal Feedback Channel — hardening follow-up to 20260803120000
--
-- Three defects found by a post-ship audit of the original migration:
--   1. storage read was tenant-wide while the row read was own-rows-only, so
--      the screenshot (the part actually holding customer PII) leaked to every
--      colleague the row policy was written to exclude
--   2. the prompt throttle was written straight from the browser into
--      app_users, which only worked because of an unrestricted self-UPDATE
--      policy — making that policy permanently load-bearing and un-closable
--   3. `source` (which trigger produced the submission) had nowhere to go, so
--      it was being smuggled into page_path and corrupting it
-- ============================================

-- ── 1. tenant_feedback.source ───────────────────────────────────────────────
-- Which entry point produced this submission. Previously concatenated into
-- page_path as "/rentals/abc (forced-login)", which corrupted the one
-- reproduction field the schema captures: any filter or GROUP BY on page_path
-- silently missed every prompted submission.
ALTER TABLE public.tenant_feedback
  ADD COLUMN IF NOT EXISTS source TEXT
  CHECK (source IS NULL OR source IN ('sidebar', 'rental_close', 'forced'));

COMMENT ON COLUMN public.tenant_feedback.source IS
  'Entry point that produced this submission. Lets us measure which trigger actually works instead of guessing.';

CREATE INDEX IF NOT EXISTS idx_tenant_feedback_source ON public.tenant_feedback(source);


-- ── 2. Storage read: own-rows, matching the row policy ──────────────────────
-- The original policy granted the whole tenant folder. Because the path is
-- `{tenant_id}/{uuid}.{ext}`, any authenticated staff member could
-- `.list('<their tenant id>')` and sign every object in it — including a
-- screenshot of the Payments page taken by a head admin, by a `manager` whose
-- permissions deny them /payments entirely. That contradicted the row policy
-- directly above it, which was deliberately narrowed to own-rows.
--
-- The original justification for the wide grant was "so the preview works
-- right after upload". It never needed a storage read: the dialog previews
-- from an in-memory URL.createObjectURL(File), before any upload happens.
DROP POLICY IF EXISTS "Tenant staff and super admins read feedback screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Submitters and super admins read feedback screenshots" ON storage.objects;
CREATE POLICY "Submitters and super admins read feedback screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.tenant_feedback f
        JOIN public.app_users u ON u.id = f.app_user_id
        WHERE f.screenshot_path = storage.objects.name
          AND u.auth_user_id = auth.uid()
      )
    )
  );


-- ── 3. Throttle stamp via SECURITY DEFINER, not a direct table write ────────
-- The portal wrote `app_users.feedback_last_prompted_at` directly from the
-- browser. The only thing authorising that was `p_update_own_password_flag`
-- (FOR UPDATE USING auth_user_id = auth.uid()) which carries NO column list —
-- so the same policy also lets any portal user set their own `is_super_admin`.
-- Routing the stamp through this function means that policy can be narrowed
-- to `must_change_password` without silently breaking the feedback cooldown.
--
-- Touches exactly one column on exactly the caller's own row, so it grants no
-- capability the browser did not already have.
CREATE OR REPLACE FUNCTION public.touch_feedback_prompted_at()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.app_users
     SET feedback_last_prompted_at = now()
   WHERE auth_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.touch_feedback_prompted_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_feedback_prompted_at() TO authenticated;

COMMENT ON FUNCTION public.touch_feedback_prompted_at() IS
  'Stamps feedback_last_prompted_at on the calling user''s own app_users row. Exists so the portal never needs a direct UPDATE grant on app_users.';

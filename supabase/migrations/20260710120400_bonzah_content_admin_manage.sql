-- Phase 6: let super admins manage Bonzah training/quiz content directly from the
-- admin app (content is swappable without a redeploy). RLS is enabled on both
-- tables; mutations were previously service_role-only. Add a super-admin ALL
-- policy alongside the existing SELECT policies (permissive OR). The quiz answer
-- column stays hidden from operators via the answer-omitting public view.
DROP POLICY IF EXISTS bonzah_quiz_admin_manage ON public.bonzah_quiz_questions;
CREATE POLICY bonzah_quiz_admin_manage
  ON public.bonzah_quiz_questions FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS bonzah_training_admin_manage ON public.bonzah_training_videos;
CREATE POLICY bonzah_training_admin_manage
  ON public.bonzah_training_videos FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

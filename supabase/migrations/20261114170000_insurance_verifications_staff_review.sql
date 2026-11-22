-- APPLIED to production 2026-11-14 (QA I3.9 / I3.10, branch Insurance-testing)
--
-- AI Verifications had no way for staff to settle a check: "Flagged" means a
-- person should look, but nobody could record the answer. Staff can now
-- Approve or Reject (with a reason) a check.
--
-- The browser writes only review_decision (+ review_reason). This trigger stamps
-- who and when from the signed-in user and sets the status, so neither can be
-- forged. Writing needs the writers-only policies from 20261114160000 (no viewers).
-- Clearing review_decision (Re-run AI does) clears the stamp.
--
-- Rollback:
--   DROP TRIGGER trg_insurance_verifications_stamp_review ON public.insurance_verifications;
--   DROP FUNCTION public.insurance_verifications_stamp_review();
--   ALTER TABLE public.insurance_verifications
--     DROP COLUMN review_decision, DROP COLUMN review_reason,
--     DROP COLUMN reviewed_by, DROP COLUMN reviewed_at;

ALTER TABLE public.insurance_verifications
  ADD COLUMN IF NOT EXISTS review_decision text CHECK (review_decision IN ('approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.insurance_verifications_stamp_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.review_decision := NULL; NEW.review_reason := NULL;
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.review_decision IS DISTINCT FROM OLD.review_decision
     OR NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
    IF NEW.review_decision IS NULL THEN
      NEW.review_reason := NULL; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    ELSE
      IF NEW.review_decision = 'rejected' AND coalesce(btrim(NEW.review_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is needed to reject a check' USING ERRCODE = '23514';
      END IF;
      IF NEW.review_decision = 'approved' THEN NEW.review_reason := nullif(btrim(coalesce(NEW.review_reason, '')), ''); END IF;
      NEW.reviewed_at := now();
      NEW.reviewed_by := (SELECT id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1);
      NEW.status := CASE NEW.review_decision WHEN 'approved' THEN 'verified' ELSE 'rejected' END;
    END IF;
  ELSE
    -- Nobody may hand-edit the stamp.
    NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_verifications_stamp_review ON public.insurance_verifications;
CREATE TRIGGER trg_insurance_verifications_stamp_review
  BEFORE INSERT OR UPDATE ON public.insurance_verifications
  FOR EACH ROW EXECUTE FUNCTION public.insurance_verifications_stamp_review();

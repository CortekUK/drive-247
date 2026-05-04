-- Drop 'archived' from the enquiries.status CHECK constraint.
-- The portal now offers a hard Delete action instead of archiving.
-- Any existing rows with status='archived' are reassigned to 'resolved' so they
-- still satisfy the new constraint and remain visible in the resolved bucket.

UPDATE public.enquiries
   SET status = 'resolved',
       updated_at = NOW()
 WHERE status = 'archived';

ALTER TABLE public.enquiries
  DROP CONSTRAINT IF EXISTS enquiries_status_chk;

ALTER TABLE public.enquiries
  ADD CONSTRAINT enquiries_status_chk
    CHECK (status IN ('new', 'contacted', 'resolved'));

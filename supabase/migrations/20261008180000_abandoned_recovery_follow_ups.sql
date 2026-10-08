-- Abandoned booking recovery: daily follow-ups.
--
-- Until now each abandoned booking got exactly one email. Super admins now set
-- how many (max_emails, 1–7): the first goes out as before, then one a day
-- until that many have gone — and the sequence stops early the moment the
-- renter acts: books, comes back to the booking (including by clicking the
-- email's link), replies, or unsubscribes. abandoned-recovery-run does the
-- sending; these columns are its state.
ALTER TABLE public.abandoned_recovery_settings
  ADD COLUMN IF NOT EXISTS max_emails integer NOT NULL DEFAULT 1
    CHECK (max_emails BETWEEN 1 AND 7);

ALTER TABLE public.abandoned_bookings
  -- Recovery emails actually sent for this booking (first + follow-ups).
  ADD COLUMN IF NOT EXISTS email_count integer NOT NULL DEFAULT 0,
  -- The most recent one; "did they act?" means activity or a reply after this.
  ADD COLUMN IF NOT EXISTS last_email_at timestamptz,
  -- When the next follow-up is due; NULL = none planned.
  ADD COLUMN IF NOT EXISTS next_email_at timestamptz,
  -- Why the follow-ups ended, for the admin table ("Came back to the booking").
  ADD COLUMN IF NOT EXISTS follow_up_stopped text;

CREATE INDEX IF NOT EXISTS abandoned_bookings_next_email_at_idx
  ON public.abandoned_bookings (next_email_at)
  WHERE next_email_at IS NOT NULL;

-- Bookings already emailed under the one-email rule: count that email, and
-- give the ones still waiting their next follow-up a day after it.
UPDATE public.abandoned_bookings
SET email_count = 1,
    last_email_at = email_sent_at
WHERE email_status = 'sent' AND email_sent_at IS NOT NULL AND email_count = 0;

UPDATE public.abandoned_bookings
SET next_email_at = email_sent_at + interval '1 day'
WHERE status = 'emailed' AND email_sent_at IS NOT NULL AND next_email_at IS NULL
  AND email_sent_at > now() - interval '2 days';

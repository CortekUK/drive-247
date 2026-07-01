-- Optional day-of-week for auto-extension payment reminders (Kristen / RevTek ask:
-- "send reminders on the correct day of the week").
--
-- NULL (the default for every existing rental) preserves today's behaviour exactly:
-- the daily reminder cron keeps using the interval-based cadence
-- (auto_extend_reminder_interval_days). When an operator sets a weekday
-- (0=Sunday .. 6=Saturday, evaluated in the TENANT's local timezone), the cron
-- (send-auto-extension-reminder) only nudges on that weekday, at most once that
-- day, still respecting auto_extend_reminder_max.
--
-- Purely additive & backward-compatible: no existing rental's behaviour changes
-- until someone explicitly picks a weekday.

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_reminder_send_weekday smallint;

DO $$ BEGIN
  ALTER TABLE public.rentals
    ADD CONSTRAINT rentals_ae_reminder_weekday_check
    CHECK (
      auto_extend_reminder_send_weekday IS NULL
      OR auto_extend_reminder_send_weekday BETWEEN 0 AND 6
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.rentals.auto_extend_reminder_send_weekday IS
  'Optional day-of-week (0=Sunday..6=Saturday, tenant-local) to send auto-extension reminders. NULL = use interval-based cadence (auto_extend_reminder_interval_days).';

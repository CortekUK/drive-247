-- Abandoned booking recovery: resume the booking from the email link.
--
-- The recovery email's "Finish your booking" link carries the session's
-- recovery_token; the booking site trades it (abandoned-booking-track, action
-- "resume") for what the renter had entered and reopens the step they left at,
-- on any device. The columns already on the row cover V2 (car, dates, contact).
-- The V1 wizard also needs its location ids, return address, delivery fees and
-- extras, which have no column — they ride in resume_state.
--
-- Written by abandoned-booking-track only, from a fixed allow-list of keys.
-- Never holds date of birth, licence, home address or verification ids: those
-- are re-entered on the Details step.
ALTER TABLE public.abandoned_bookings
  ADD COLUMN IF NOT EXISTS resume_state jsonb;

COMMENT ON COLUMN public.abandoned_bookings.resume_state IS
  'V1 wizard fields with no column of their own (location ids, return address, delivery fees, extras), allow-listed by abandoned-booking-track. Used to resume the booking from the recovery email.';

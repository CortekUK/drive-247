-- Enable btree_gist extension (required for exclusion constraints combining equality + range operators)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Add exclusion constraint to prevent overlapping rentals for the same vehicle.
-- Only enforced for non-terminal statuses (Pending, Active).
-- Cancelled, Rejected, and Closed rentals are excluded from the constraint.
-- COALESCE handles nullable end_date by treating it as "indefinite future".
-- The range is inclusive on both ends: a rental ending Jan 10 and another starting Jan 10 will conflict.
ALTER TABLE rentals
ADD CONSTRAINT no_overlapping_vehicle_rentals
EXCLUDE USING gist (
  vehicle_id WITH =,
  daterange(start_date, COALESCE(end_date, '9999-12-31'::date), '[]') WITH &&
) WHERE (status NOT IN ('Cancelled', 'Rejected', 'Closed'));

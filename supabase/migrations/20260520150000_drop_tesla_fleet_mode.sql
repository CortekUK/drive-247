-- Drop the now-unused tesla_fleet_mode column.
--
-- Tesla does not provide a true sandbox; the test/live toggle was theatre
-- (both modes pointed at the same production URL). The toggle and all its
-- code paths were removed in Round 1; this completes the cleanup by
-- removing the column itself.

ALTER TABLE public.tenants DROP COLUMN IF EXISTS tesla_fleet_mode;

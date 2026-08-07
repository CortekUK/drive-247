-- Vehicle deletion: remove the FK blockers that stranded operators.
--
-- BACKGROUND
-- Deleting a vehicle failed with:
--   update or delete on table "vehicles" violates foreign key constraint
--   "pnl_entries_vehicle_id_fkey" on table "pnl_entries"
-- The portal worked around the NO ACTION FKs by hand-deleting child rows first,
-- in four unchecked, non-transactional calls. Once RLS was enabled on
-- pnl_entries, any row with a missing tenant_id fell outside the operator's
-- RLS scope, so that cleanup silently deleted nothing and the vehicle delete
-- then failed on the FK -- after the other child rows had already been
-- destroyed. Re-adding the vehicle then failed on vehicles_reg_key, because
-- the original row had never actually been removed.
--
-- Fixing the row writers (20260806190000) closed the source of the orphans.
-- This closes the mechanism: children are now removed by the database, beneath
-- RLS, atomically with the vehicle.

-- P&L entries: the portal already deleted these explicitly, so cascading does
-- not change what is destroyed -- only that it now happens reliably and in the
-- same transaction, instead of partially and then failing.
ALTER TABLE public.pnl_entries DROP CONSTRAINT IF EXISTS pnl_entries_vehicle_id_fkey;
ALTER TABLE public.pnl_entries
  ADD CONSTRAINT pnl_entries_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;

-- Reminder events: an operational log of reminders sent about a vehicle.
-- vehicle_id is NOT NULL so it cannot be nulled, and the log has no meaning
-- without its vehicle. This one never surfaced only because no tenant happened
-- to have a reminder on a vehicle they were deleting.
ALTER TABLE public.reminder_events DROP CONSTRAINT IF EXISTS reminder_events_vehicle_id_fkey;
ALTER TABLE public.reminder_events
  ADD CONSTRAINT reminder_events_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;

-- owner_payout_lines is DELIBERATELY left ON DELETE RESTRICT.
--
-- Those rows are financial records of money owed to / paid to a vehicle owner.
-- Cascading them would quietly erase payout history to make a delete
-- convenient, which is the wrong trade. The vehicle is correctly blocked; the
-- portal now explains why and points the operator at Dispose, which retires the
-- vehicle from the fleet and the booking site while leaving the records intact.

COMMENT ON CONSTRAINT owner_payout_lines_vehicle_id_fkey ON public.owner_payout_lines IS
  'Intentionally RESTRICT: payout lines are financial records. A vehicle that appears on an owner payout must not be deletable; use vehicle disposal instead.';

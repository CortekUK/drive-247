-- Function to automatically complete expired rentals and free up vehicles
CREATE OR REPLACE FUNCTION auto_complete_expired_rentals()
RETURNS void AS $$
BEGIN
  -- Update rentals that are still Active but past their end_date
  UPDATE rentals
  SET status = 'Completed',
      updated_at = now()
  WHERE status = 'Active'
    AND end_date < CURRENT_DATE;

  -- Note: The trigger_update_vehicle_status_on_rental will automatically
  -- update vehicle status to 'Available' when rental status changes to 'Completed'
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_complete_expired_rentals() IS 'Automatically completes rentals that have passed their end_date. Run this as a scheduled job (cron/pg_cron).';

-- Example: To set up a daily cron job (requires pg_cron extension):
-- SELECT cron.schedule(
--   'auto-complete-expired-rentals',
--   '0 1 * * *', -- Run daily at 1 AM
--   $$SELECT auto_complete_expired_rentals();$$
-- );

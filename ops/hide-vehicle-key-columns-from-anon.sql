-- Withhold the operator-only car columns from the public (anon) key.   (2026-11-06)
--
-- QA sheet 10, row 10.15. `anon` held table-level SELECT on public.vehicles,
-- so the public key every booking site ships could read each car's key
-- custody, tracker/immobiliser fitment, security notes and lockbox code.
--
-- After: anon may read every vehicles column EXCEPT the nine below. Signed-in
-- users (staff) and service-role callers are unchanged.
--
-- Safe to apply because no public-key query reads these nine by name, and the
-- last public `select('*')` queries on vehicles were replaced first
-- (commit f09e5cdf). The Northwind site and the legacy booking pages already
-- use the vehiclePublicColumns() allowlist.
--
-- !! FROM NOW ON: a NEW vehicles column is invisible to anon until granted —
--    the same rule as `tenants`. If the booking site needs it:
--      GRANT SELECT (new_column) ON public.vehicles TO anon;
--
-- Known remaining exposure, NOT fixed here: a signed-in customer account uses
-- the `authenticated` role, which still reads every column (staff need it).
-- Closing that needs row/column rules that tell staff from customers.

revoke select on public.vehicles from anon;
grant select (
  id, reg, make, model, colour, acquisition_type, purchase_price, acquisition_date, status,
  created_at, color, updated_at, monthly_payment, initial_payment, term_months, balloon,
  finance_start_date, mot_due_date, tax_due_date, last_service_date, last_service_mileage,
  is_disposed, disposal_date, sale_proceeds, disposal_buyer, disposal_notes, photo_url, year,
  warranty_start_date, warranty_end_date, has_service_plan, daily_rent, weekly_rent, monthly_rent,
  description, fuel_type, tenant_id, vin, security_deposit, current_mileage, excess_mileage_rate,
  available_daily, available_weekly, available_monthly, daily_mileage, weekly_mileage,
  monthly_mileage, tesla_fleet_enabled, tesla_fleet_vehicle_id, unlimited_mileage_available,
  unlimited_mileage_price_daily, unlimited_mileage_price_weekly, unlimited_mileage_price_monthly,
  owner_id, ownership_assigned_at, commission_type_override, commission_value_override,
  flat_fee_period_override, category, pickup_location_id, garaging_state, is_paused,
  paused_reason, paused_at, paused_by, show_on_website
) on public.vehicles to anon;
notify pgrst, 'reload schema';

-- Withheld: security_notes, spare_key_notes, spare_key_holder, has_spare_key, has_logbook,
--           has_tracker, has_remote_immobiliser, lockbox_code, lockbox_instructions
--
-- To undo:  grant select on public.vehicles to anon;  notify pgrst, 'reload schema';

-- Optional hard cap on how far an operator will deliver under "area" / tiered
-- delivery pricing. Requested by Open Bay (Jim): the open-ended "Anywhere
-- further" band has no ceiling, so a customer far from the service center can
-- still get a quote. With this set, addresses beyond the cap are not offered.
--
-- NULL = no limit (unchanged behaviour). Stored in kilometres to match
-- pickup_area_radius_km / delivery_distance_tiers.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delivery_max_distance_km numeric;

COMMENT ON COLUMN public.tenants.delivery_max_distance_km IS
  'Optional hard cap (km) on area/tiered delivery distance. NULL = no limit. Beyond this, area delivery is not offered to the customer.';

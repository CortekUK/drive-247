-- Tiered delivery pricing: distance-banded delivery fees for "area" delivery mode.
-- Additive only. When delivery_tiers_enabled = false, the existing flat
-- area_delivery_fee continues to apply (no behaviour change).
--
-- delivery_distance_tiers is an ordered JSONB array of bands, stored canonically
-- in KILOMETRES to match the existing pickup_area_radius_km / return_area_radius_km
-- columns. Example (matching "$50 within 20mi, $75 within 40mi, $90 beyond"):
--   [ { "up_to_km": 32.19, "fee": 50 },
--     { "up_to_km": 64.37, "fee": 75 },
--     { "up_to_km": null,  "fee": 90 } ]   -- up_to_km = null  ->  open-ended top band
-- The resolver picks the first band where distance <= up_to_km; a trailing
-- null band catches anything beyond. If no band matches and there is no open
-- band, the address is out of range.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS delivery_tiers_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_distance_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tenants.delivery_tiers_enabled IS
  'When true, area delivery uses distance-banded fees (delivery_distance_tiers) instead of the flat area_delivery_fee.';
COMMENT ON COLUMN public.tenants.delivery_distance_tiers IS
  'Ordered JSONB array of distance bands for tiered delivery pricing. Each: {up_to_km: number|null, fee: number}. Distances in km; a trailing up_to_km=null band is open-ended.';

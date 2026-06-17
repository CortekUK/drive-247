-- Multiple delivery locations: assign each vehicle to one of the tenant's
-- pickup_locations so the booking flow can show only the cars at the customer's
-- chosen pickup point (e.g. one car in Tri-State, the rest in Hertford).
--
-- Additive + fully backwards-compatible: NULL = "available from any location"
-- (every existing vehicle stays NULL, so booking behaviour is unchanged until an
-- operator explicitly assigns a location). ON DELETE SET NULL so removing a
-- location simply reverts its vehicles to "any location" rather than blocking.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS pickup_location_id uuid
    REFERENCES public.pickup_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_pickup_location_id
  ON public.vehicles(pickup_location_id)
  WHERE pickup_location_id IS NOT NULL;

COMMENT ON COLUMN public.vehicles.pickup_location_id IS
  'Optional FK to pickup_locations. When set, the vehicle is only offered when the customer selects this pickup location. NULL = available from any location.';

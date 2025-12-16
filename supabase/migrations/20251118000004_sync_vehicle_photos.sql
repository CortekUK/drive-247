-- Migrate any remaining photo_url data that wasn't synced to vehicle_photos table
-- This handles cases where photos were added after the initial migration

INSERT INTO public.vehicle_photos (vehicle_id, photo_url, display_order)
SELECT
  v.id,
  v.photo_url,
  0
FROM public.vehicles v
WHERE v.photo_url IS NOT NULL
  AND v.photo_url != ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.vehicle_photos vp
    WHERE vp.vehicle_id = v.id
  )
ON CONFLICT DO NOTHING;
